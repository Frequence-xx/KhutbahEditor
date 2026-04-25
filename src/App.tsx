import { useState, useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
import { Welcome } from './screens/Welcome';
import { Library } from './screens/Library';
import { NewKhutbah } from './screens/NewKhutbah';
import { Editor } from './screens/Editor';
import { Processing } from './screens/Processing';
import { Settings } from './screens/Settings';
import { Upload } from './screens/Upload';
import { useProjects } from './store/projects';
import { useSettings } from './store/settings';
import { useIpcOnce } from './hooks/useIpc';
import { runAutoPilot } from './lib/autopilot';
import { withETA, formatETA, type EnrichedProgress } from './lib/eta';

type Screen =
  | { name: 'welcome' }
  | { name: 'library' }
  | { name: 'new' }
  | { name: 'processing'; projectId: string }
  | { name: 'editor'; projectId: string }
  | { name: 'upload'; projectId: string }
  | { name: 'settings' };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'library' });
  const [autoPilotProgress, setAutoPilotProgress] = useState<EnrichedProgress | null>(null);
  const addProject = useProjects((s) => s.add);
  const { data } = useIpcOnce<{ ok: boolean; version: string }>('ping');

  useEffect(() => {
    void useSettings.getState().load();
  }, []);

  useEffect(() => {
    if (!window.khutbah) return;
    (async () => {
      const accounts = await window.khutbah!.auth.listAccounts();
      const projectsCount = useProjects.getState().projects.length;
      if (accounts.length === 0 && projectsCount === 0) {
        setScreen({ name: 'welcome' });
      }
    })();
  }, []);

  async function maybeAutoPilot(projectId: string): Promise<void> {
    // Ensure settings are loaded BEFORE checking autoPilot flag — fixes cold-start race.
    // If load() rejects (e.g., IPC failure), fall back to manual processing
    // rather than letting the rejection escape into the calling start flow.
    let settings = useSettings.getState().settings;
    if (!settings) {
      try {
        await useSettings.getState().load();
        settings = useSettings.getState().settings;
      } catch (e) {
        console.warn('[autopilot] settings load failed; falling back to manual processing', e);
        setScreen({ name: 'processing', projectId });
        return;
      }
    }
    if (!settings || !settings.autoPilot) {
      // Fall through to manual flow: Processing screen
      setScreen({ name: 'processing', projectId });
      return;
    }
    const project = useProjects.getState().projects.find((p) => p.id === projectId);
    if (!project) return;

    setAutoPilotProgress({ stage: 'detect', message: 'Starting auto-pilot…' });
    try {
      const result = await runAutoPilot(project, (p) => setAutoPilotProgress((prev) => withETA(prev, p)));
      setAutoPilotProgress(null);
      if (result.mode === 'manual_review') {
        setScreen({ name: 'editor', projectId });
      } else if (result.mode === 'auto_complete' || result.mode === 'partial_failure') {
        const channelIds = Object.keys(result.uploads ?? {});
        const firstVideo = result.uploads?.[channelIds[0]]?.p1;
        const errors = Object.values(result.uploads ?? {}).flatMap((u) => u.errors);
        const isPartial = result.mode === 'partial_failure';
        const title = isPartial
          ? 'KhutbahEditor — partial failure'
          : 'KhutbahEditor — both parts uploaded';
        const body = errors.length > 0
          ? `${errors.length} error(s); open Library for details.`
          : `Uploaded to ${channelIds.length} account(s).`;
        if (window.khutbah) {
          window.khutbah.notify({
            title,
            body,
            clickUrl: firstVideo ? `https://youtube.com/watch?v=${firstVideo}` : undefined,
          });
        }
        setScreen({ name: 'library' });
      }
    } catch (e: unknown) {
      setAutoPilotProgress(null);
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e);
      alert(`Auto-pilot failed: ${msg}`);
      setScreen({ name: 'editor', projectId });
    }
  }

  async function startFromYoutube(url: string): Promise<void> {
    if (!window.khutbah) return;
    setAutoPilotProgress({ stage: 'detect', message: 'Probing YouTube URL…' });
    let unsubscribe: (() => void) | null = null;
    try {
      // Probe the URL first to populate duration / fail fast on invalid URLs.
      // First call also triggers yt-dlp to fetch the EJS solver lib + solve
      // YouTube's n-challenge — can take 10-30s on first run.
      const info = await window.khutbah.pipeline.call<{ duration: number; title: string; id: string }>(
        'ingest.youtube_info',
        { url },
      );
      setAutoPilotProgress({
        stage: 'detect',
        message: `Downloading "${info.title.slice(0, 60)}"…`,
        progress: 0,
      });
      // Subscribe to the sidecar's progress notifications during the download.
      unsubscribe = window.khutbah.pipeline.onProgress((params) => {
        if (params.stage === 'download' && typeof params.progress === 'number') {
          setAutoPilotProgress((prev) => withETA(prev, {
            stage: 'detect',
            message: typeof params.message === 'string'
              ? params.message
              : `Downloading "${info.title.slice(0, 60)}"…`,
            progress: Math.round(params.progress * 100),
          }));
        }
      });
      // Reserve an output dir for the download
      const dir = await window.khutbah.paths.defaultOutputDir();
      await window.khutbah.paths.ensureDir(dir);
      const dl = await window.khutbah.pipeline.call<{ path: string }>(
        'ingest.youtube_download',
        { url, output_dir: dir },
      );
      unsubscribe?.();
      unsubscribe = null;
      setAutoPilotProgress({ stage: 'detect', message: 'Probing downloaded file…' });
      const id = url.replace(/[^a-z0-9]/gi, '_').slice(-32);
      addProject({
        id,
        sourcePath: dl.path,
        duration: info.duration,
        createdAt: Date.now(),
        status: 'draft',
      });
      setAutoPilotProgress(null);
      await maybeAutoPilot(id);
    } catch (e: unknown) {
      unsubscribe?.();
      setAutoPilotProgress(null);
      const msg = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : String(e);
      alert(`Cannot fetch this YouTube URL: ${msg}`);
    }
  }

  async function pickDualFileAndStart(): Promise<void> {
    if (!window.khutbah) return;
    try {
      const videoPath = await window.khutbah.dialog.openVideo();
      if (!videoPath) return;
      const audioPath = await window.khutbah.dialog.openAudio();
      if (!audioPath) return;

      const dir = await window.khutbah.paths.defaultOutputDir();
      await window.khutbah.paths.ensureDir(dir);

      setAutoPilotProgress({ stage: 'detect', message: 'Aligning audio to video…' });
      const align = await window.khutbah.pipeline.call<{ offset_seconds: number; confidence: number }>(
        'align.dual_file',
        { video_path: videoPath, audio_path: audioPath },
      );

      if (align.confidence < 5) {
        const proceed = confirm(
          `Alignment confidence is low (${align.confidence.toFixed(1)}). ` +
          `KhutbahEditor will use offset ${align.offset_seconds.toFixed(2)}s but you may want to ` +
          `manually verify in the editor. Continue?`,
        );
        if (!proceed) {
          setAutoPilotProgress(null);
          return;
        }
      }

      setAutoPilotProgress({ stage: 'detect', message: 'Muxing aligned video…' });
      const aligned = `${dir}/aligned-${Date.now()}.mp4`;
      await window.khutbah.pipeline.call('edit.apply_offset_mux', {
        video_path: videoPath,
        audio_path: audioPath,
        offset_seconds: align.offset_seconds,
        dst: aligned,
      });

      const probe = await window.khutbah.pipeline.call<{ duration: number }>(
        'ingest.probe_local',
        { path: aligned },
      );
      setAutoPilotProgress(null);

      const id = aligned.replace(/[^a-z0-9]/gi, '_').slice(-32);
      addProject({
        id,
        sourcePath: aligned,
        duration: probe.duration,
        createdAt: Date.now(),
        status: 'draft',
      });
      await maybeAutoPilot(id);
    } catch (e: unknown) {
      setAutoPilotProgress(null);
      const msg = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : String(e);
      alert(`Dual-file processing failed: ${msg}`);
    }
  }

  async function pickAndCreate() {
    if (!window.khutbah) return;
    const path = await window.khutbah.dialog.openVideo();
    if (!path) return;
    try {
      const probe = await window.khutbah.pipeline.call<{ duration: number }>('ingest.probe_local', { path });
      const id = path.replace(/[^a-z0-9]/gi, '_');
      addProject({ id, sourcePath: path, duration: probe.duration, createdAt: Date.now(), status: 'draft' });
      await maybeAutoPilot(id);
    } catch (e: unknown) {
      // JSON-RPC errors come through with a `message` field
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e);
      alert(`Cannot import this file: ${msg}`);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg-1 text-text">
      <TitleBar
        right={
          <div className="flex items-center gap-3">
            <span className={data?.ok ? 'text-green' : 'text-text-muted'} role="status" aria-live="polite">
              {data?.ok ? '● Pipeline ready' : '… connecting'}
            </span>
            <button
              onClick={() => setScreen({ name: 'settings' })}
              className="text-text-muted hover:text-text-strong text-2xl leading-none p-1"
              aria-label="Settings"
            >
              ⚙
            </button>
          </div>
        }
      />
      {screen.name === 'welcome' && (
        <Welcome
          onSignIn={async () => {
            if (!window.khutbah) return;
            try {
              await window.khutbah.auth.signIn();
              setScreen({ name: 'library' });
            } catch (e: unknown) {
              const msg = e && typeof e === 'object' && 'message' in e
                ? String((e as { message: unknown }).message)
                : String(e);
              alert(`Sign-in failed: ${msg}`);
            }
          }}
          onSkip={() => setScreen({ name: 'library' })}
        />
      )}
      {screen.name === 'library' && (
        <Library
          onNewProject={() => setScreen({ name: 'new' })}
          onOpen={(id) => setScreen({ name: 'editor', projectId: id })}
        />
      )}
      {screen.name === 'new' && (
        <NewKhutbah
          onPickFile={pickAndCreate}
          onYoutubeUrl={startFromYoutube}
          onPickDualFile={pickDualFileAndStart}
          onCancel={() => setScreen({ name: 'library' })}
        />
      )}
      {screen.name === 'processing' && (
        <Processing
          projectId={screen.projectId}
          onDone={() => setScreen({ name: 'editor', projectId: screen.projectId })}
          onError={(msg) => {
            alert(msg);
            // On detection failure, fall through to manual editor — boundaries unset
            setScreen({ name: 'editor', projectId: screen.projectId });
          }}
        />
      )}
      {screen.name === 'editor' && (
        <Editor
          projectId={screen.projectId}
          onBack={() => setScreen({ name: 'library' })}
          onUpload={() => setScreen({ name: 'upload', projectId: screen.projectId })}
        />
      )}
      {screen.name === 'upload' && (
        <Upload
          projectId={screen.projectId}
          onBack={() => setScreen({ name: 'editor', projectId: screen.projectId })}
        />
      )}
      {screen.name === 'settings' && <Settings onBack={() => setScreen({ name: 'library' })} />}
      {autoPilotProgress && (
        <div className="fixed inset-0 bg-bg-0/80 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-bg-2 border border-border-strong rounded-lg p-6 max-w-lg w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-2 h-2 rounded-full bg-amber animate-pulse" aria-hidden />
              <h2 className="font-display text-xl tracking-wider text-text-strong">
                {autoPilotProgress.stage === 'detect' && 'PROCESSING'}
                {autoPilotProgress.stage === 'export' && 'EXPORTING'}
                {autoPilotProgress.stage === 'upload' && 'UPLOADING'}
                {autoPilotProgress.stage !== 'detect' && autoPilotProgress.stage !== 'export' && autoPilotProgress.stage !== 'upload' && 'WORKING'}
              </h2>
              {autoPilotProgress.progress !== undefined && (
                <span className="ml-auto text-text-muted text-sm font-mono">
                  {Math.round(autoPilotProgress.progress)}%
                  {autoPilotProgress.etaSeconds !== undefined && autoPilotProgress.etaSeconds > 0 && (
                    <span className="ml-2 text-text-dim">· ~{formatETA(autoPilotProgress.etaSeconds)} left</span>
                  )}
                </span>
              )}
            </div>
            <p className="text-text-dim text-sm mb-4 break-words">{autoPilotProgress.message}</p>
            <div className="h-1.5 bg-border-strong rounded overflow-hidden">
              {autoPilotProgress.progress !== undefined ? (
                <div
                  className="h-full bg-gradient-to-r from-amber to-amber-dark transition-all duration-300"
                  style={{ width: `${Math.max(0, Math.min(100, autoPilotProgress.progress))}%` }}
                />
              ) : (
                <div className="h-full bg-gradient-to-r from-transparent via-amber to-transparent animate-pulse" style={{ width: '40%' }} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
