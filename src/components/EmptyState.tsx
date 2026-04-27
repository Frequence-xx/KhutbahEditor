import { Logo } from './Logo';

export function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 text-center px-8">
      <Logo className="w-24 h-24 opacity-80" />
      <h2 className="font-display text-2xl text-amber-300">No khutbah selected</h2>
      <p className="text-slate-400 max-w-sm">
        Pick a project from the sidebar, or start a new one.
      </p>
      <button
        onClick={onNew}
        className="px-5 py-2 rounded bg-amber-400 text-slate-900 font-semibold hover:bg-amber-300"
      >
        + New khutbah
      </button>
    </div>
  );
}
