import { formatETA } from '../lib/eta';

export type DetectingPaneProps = {
  projectName: string;
  progress?: number;
  stage: string;
  message?: string;
  etaSeconds?: number;
};

export function DetectingPane({
  projectName,
  progress,
  stage,
  message,
  etaSeconds,
}: DetectingPaneProps) {
  const pct = progress ?? 0;
  return (
    <div className="h-full flex flex-col items-center justify-center px-12">
      <h2 className="font-display text-xl text-amber-glow mb-2">{projectName}</h2>
      <p className="text-text-dim mb-1">{stage}</p>
      {message && <p className="text-text-muted text-xs mb-5">{message}</p>}
      {!message && <div className="mb-5" />}
      <div className="w-full max-w-md h-2 bg-bg-3 rounded overflow-hidden">
        <div
          role="progressbar"
          aria-valuenow={progress ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-full bg-amber transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex gap-3 mt-3 text-sm">
        {progress !== undefined && <span className="text-text">{progress}%</span>}
        {etaSeconds !== undefined && etaSeconds > 0 && (
          <span className="text-text-dim">· ETA {formatETA(etaSeconds)}</span>
        )}
      </div>
    </div>
  );
}
