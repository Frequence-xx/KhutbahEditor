export type ProgressUpdate = { stage: string; message: string; progress?: number };
export type EnrichedProgress = ProgressUpdate & { startedAt?: number; etaSeconds?: number };

/**
 * Enriches a progress update with startedAt timestamp and ETA.
 *
 * Expects progress in 0-100 (renderer convention after sidecar-side conversion).
 * Resets startedAt whenever the stage changes.
 * Suppresses ETA below 5% (too noisy) and at 100% (done).
 */
export function withETA(prev: EnrichedProgress | null, next: ProgressUpdate): EnrichedProgress {
  const startedAt =
    prev && prev.stage === next.stage && prev.startedAt ? prev.startedAt : Date.now();
  let etaSeconds: number | undefined;
  if (next.progress !== undefined && next.progress > 5 && next.progress < 100) {
    const elapsed = (Date.now() - startedAt) / 1000;
    const total = elapsed / (next.progress / 100);
    etaSeconds = Math.max(0, total - elapsed);
  }
  return { ...next, startedAt, etaSeconds };
}

export function formatETA(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
