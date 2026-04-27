import { useProjects } from '../store/projects';
import { StatusDot } from './StatusDot';

export type SidebarProps = {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
  onDelete?: (id: string) => void;
};

const subtitleFor = (p: ReturnType<typeof useProjects.getState>['projects'][number]): string => {
  switch (p.runState) {
    case 'detecting':
      return p.progress !== undefined ? `Detecting · ${p.progress}%` : 'Detecting…';
    case 'cutting':
      return 'Cutting…';
    case 'uploading':
      return p.progress !== undefined ? `Uploading · ${p.progress}%` : 'Uploading…';
    case 'needs_review':
      return 'Needs review';
    case 'ready':
      return 'Ready to upload';
    case 'uploaded':
      return 'Uploaded';
    case 'error':
      return p.lastError ?? 'Error';
    case 'idle':
    default:
      return 'Idle';
  }
};

export function Sidebar({ selectedId, onSelect, onNew, onSettings, onDelete }: SidebarProps) {
  const projects = useProjects((s) => s.projects);
  const sorted = [...projects].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <aside className="w-60 bg-slate-950 border-r border-slate-800 flex flex-col">
      <div className="px-4 py-4 border-b border-slate-800 text-amber-300 font-display">
        KhutbahEditor
      </div>
      <button
        onClick={onNew}
        className="m-2 px-3 py-2 bg-amber-400 text-slate-900 rounded font-semibold text-sm"
      >
        + New khutbah
      </button>
      <div className="flex-1 overflow-auto px-1.5">
        {sorted.map((p) => {
          const name = p.sourcePath.split('/').pop() ?? p.id;
          const isActive = p.id === selectedId;
          return (
            <div
              key={p.id}
              className={`group relative w-full flex items-center gap-2 px-2 py-2 rounded mb-1 ${isActive ? 'bg-slate-800' : 'hover:bg-slate-900'}`}
            >
              <button
                onClick={() => onSelect(p.id)}
                className="flex-1 flex items-center gap-2 text-left min-w-0"
              >
                <div className="relative w-12 h-8 bg-slate-700 rounded flex-shrink-0">
                  {p.thumbnailPath && (
                    <img src={`file://${p.thumbnailPath}`} alt="" className="w-full h-full object-cover rounded" />
                  )}
                  <span className="absolute -top-0.5 -right-0.5 ring-1 ring-slate-950 rounded-full">
                    <StatusDot runState={p.runState} />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-slate-100 text-xs truncate">{name}</div>
                  <div className="text-slate-500 text-[10px] truncate">{subtitleFor(p)}</div>
                </div>
              </button>
              {onDelete && (
                <button
                  type="button"
                  aria-label={`Delete ${name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(p.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 px-1.5 text-slate-400 hover:text-danger text-sm rounded"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        onClick={onSettings}
        className="m-2 px-3 py-2 bg-transparent text-slate-400 border border-slate-700 rounded text-sm"
      >
        ⚙ Settings
      </button>
    </aside>
  );
}
