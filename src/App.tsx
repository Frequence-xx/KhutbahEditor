import { useState, useEffect } from 'react';
import { TitleBar } from './components/TitleBar';
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

type Screen =
  | { name: 'library' }
  | { name: 'new' }
  | { name: 'processing'; projectId: string }
  | { name: 'editor'; projectId: string }
  | { name: 'upload'; projectId: string }
  | { name: 'settings' };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'library' });
  const [autoPilotProgress, setAutoPilotProgress] = useState<{ stage: string; message: string; progress?: number } | null>(null);
  const addProject = useProjects((s) => s.add);
  const { data } = useIpcOnce<{ ok: boolean; version: string }>('ping');

  useEffect(() => {
    void useSettings.getState().load();
  }, []);

  async function maybeAutoPilot(projectId: string): Promise<void> {
    const settings = useSettings.getState().settings;
    if (!settings || !settings.autoPilot) {
      // Fall through to manual flow: Processing screen
      setScreen({ name: 'processing', projectId });
      return;
    }
    const project = useProjects.getState().projects.find((p) => p.id === projectId);
    if (!project) return;

    setAutoPilotProgress({ stage: 'detect', message: 'Starting auto-pilot…' });
    try {
      const result = await runAutoPilot(project, (p) => setAutoPilotProgress(p));
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
    try {
      // Probe the URL first to populate duration / fail fast on invalid URLs
      const info = await window.khutbah.pipeline.call<{ duration: number; title: string; id: string }>(
        'ingest.youtube_info',
        { url },
      );
      // Reserve an output dir for the download
      const dir = await window.khutbah.paths.defaultOutputDir();
      await window.khutbah.paths.ensureDir(dir);
      const dl = await window.khutbah.pipeline.call<{ path: string }>(
        'ingest.youtube_download',
        { url, output_dir: dir },
      );
      const id = url.replace(/[^a-z0-9]/gi, '_').slice(-32);
      addProject({
        id,
        sourcePath: dl.path,
        duration: info.duration,
        createdAt: Date.now(),
        status: 'draft',
      });
      await maybeAutoPilot(id);
    } catch (e: unknown) {
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
              className="text-text-muted hover:text-text-strong"
              aria-label="Settings"
            >
              ⚙
            </button>
          </div>
        }
      />
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
        <div className="fixed inset-0 bg-bg-0/80 flex items-center justify-center z-50">
          <div className="bg-bg-2 border border-border-strong rounded-lg p-6 max-w-md w-full">
            <h2 className="font-display text-xl tracking-wider text-text-strong mb-2">AUTO-PILOT</h2>
            <p className="text-text-muted text-sm mb-4">{autoPilotProgress.message}</p>
            {autoPilotProgress.progress !== undefined && (
              <div className="h-1 bg-border-strong rounded overflow-hidden">
                <div className="h-full bg-amber transition-all" style={{ width: `${autoPilotProgress.progress}%` }} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
