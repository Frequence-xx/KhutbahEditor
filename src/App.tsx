import { useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { Library } from './screens/Library';
import { NewKhutbah } from './screens/NewKhutbah';
import { Editor } from './screens/Editor';
import { Processing } from './screens/Processing';
import { Settings } from './screens/Settings';
import { Upload } from './screens/Upload';
import { useProjects } from './store/projects';
import { useIpcOnce } from './hooks/useIpc';

type Screen =
  | { name: 'library' }
  | { name: 'new' }
  | { name: 'processing'; projectId: string }
  | { name: 'editor'; projectId: string }
  | { name: 'upload'; projectId: string }
  | { name: 'settings' };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'library' });
  const addProject = useProjects((s) => s.add);
  const { data } = useIpcOnce<{ ok: boolean; version: string }>('ping');

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
      setScreen({ name: 'processing', projectId: id });
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : String(e);
      alert(`Cannot fetch this YouTube URL: ${msg}`);
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
      setScreen({ name: 'processing', projectId: id });
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
    </div>
  );
}
