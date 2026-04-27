import type { RunState } from '../store/projects';

const COLOR_BY_STATE: Record<RunState, string> = {
  idle: 'bg-border-slate',
  detecting: 'bg-amber animate-pulse',
  cutting: 'bg-amber animate-pulse',
  needs_review: 'bg-amber-dark',
  ready: 'bg-green',
  uploading: 'bg-amber animate-pulse',
  uploaded: 'bg-green',
  error: 'bg-danger',
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
