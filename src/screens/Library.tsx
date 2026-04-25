import { useProjects } from '../store/projects';

type Props = { onNewProject: () => void; onOpen: (id: string) => void };
export function Library({ onNewProject, onOpen }: Props) {
  const projects = useProjects((s) => s.projects);
  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <h2 className="font-display text-2xl tracking-wider text-text-strong mb-1">LIBRARY</h2>
        <p className="text-text-muted text-sm mb-6">Your khutbah projects</p>

        <button onClick={onNewProject}
          className="w-full bg-gradient-to-br from-amber/10 to-green/5 border border-dashed border-amber text-amber p-6 rounded-lg font-display tracking-wider uppercase hover:bg-amber/15 transition">
          + New Khutbah
        </button>

        {projects.length === 0 ? (
          <p className="text-text-muted text-sm text-center mt-12">No khutbahs yet. Add your first.</p>
        ) : (
          <div className="mt-8 space-y-2">
            {projects.map((p) => (
              <button key={p.id} onClick={() => onOpen(p.id)}
                className="w-full bg-bg-3 border border-border-strong rounded-md p-3 flex gap-3 text-left hover:border-amber/50 transition">
                <div className="w-16 h-10 bg-bg-0 rounded flex items-center justify-center text-text-muted">▶</div>
                <div className="flex-1">
                  <div className="text-text-strong font-semibold text-sm">{p.sourcePath.split('/').pop()}</div>
                  <div className="text-text-muted text-xs">{Math.round(p.duration)}s · {p.status}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
