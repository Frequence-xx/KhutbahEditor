import type { RunState } from '../store/projects';

const COLOR_BY_STATE: Record<RunState, string> = {
  idle: 'bg-slate-500',
  detecting: 'bg-amber-400 animate-pulse',
  cutting: 'bg-amber-400 animate-pulse',
  needs_review: 'bg-amber-500',
  ready: 'bg-emerald-500',
  uploading: 'bg-amber-400 animate-pulse',
  uploaded: 'bg-blue-500',
  error: 'bg-red-500',
};

const LABEL_BY_STATE: Record<RunState, string> = {
  idle: 'idle',
  detecting: 'detecting',
  cutting: 'cutting',
  needs_review: 'needs review',
  ready: 'ready',
  uploading: 'uploading',
  uploaded: 'uploaded',
  error: 'error',
};

export function StatusDot({ runState }: { runState: RunState }) {
  return (
    <span
      role="img"
      aria-label={`Status: ${LABEL_BY_STATE[runState]}`}
      className={`inline-block w-2 h-2 rounded-full ${COLOR_BY_STATE[runState]}`}
    />
  );
}
