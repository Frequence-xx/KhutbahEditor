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
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return rs === 0 ? `${m}m` : `${m}m ${rs}s`;
  }
  const h = Math.floor(s / 3600);
  const rm = Math.floor((s % 3600) / 60);
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
}
