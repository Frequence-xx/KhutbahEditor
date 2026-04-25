import { useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { Library } from './screens/Library';
import { NewKhutbah } from './screens/NewKhutbah';
import { Editor } from './screens/Editor';
import { Settings } from './screens/Settings';
import { useProjects } from './store/projects';
import { useIpcOnce } from './hooks/useIpc';

type Screen =
  | { name: 'library' }
  | { name: 'new' }
  | { name: 'editor'; projectId: string }
  | { name: 'settings' };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'library' });
  const addProject = useProjects((s) => s.add);
  const { data } = useIpcOnce<{ ok: boolean; version: string }>('ping');

  async function pickAndCreate() {
    if (!window.khutbah) return;
    const path = await window.khutbah.dialog.openVideo();
    if (!path) return;
    const probe = await window.khutbah.pipeline.call<{ duration: number }>('ingest.probe_local', { path });
    const id = path.replace(/[^a-z0-9]/gi, '_');
    addProject({ id, sourcePath: path, duration: probe.duration, createdAt: Date.now(), status: 'draft' });
    setScreen({ name: 'editor', projectId: id });
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
        <NewKhutbah onPickFile={pickAndCreate} onCancel={() => setScreen({ name: 'library' })} />
      )}
      {screen.name === 'editor' && (
        <Editor
          projectId={screen.projectId}
          onBack={() => setScreen({ name: 'library' })}
        />
      )}
      {screen.name === 'settings' && <Settings onBack={() => setScreen({ name: 'library' })} />}
    </div>
  );
}
