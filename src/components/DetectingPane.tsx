export type DetectingPaneProps = {
  projectName: string;
  progress?: number;
  stage: string;
};

export function DetectingPane({ projectName, progress, stage }: DetectingPaneProps) {
  const pct = progress ?? 0;
  return (
    <div className="h-full flex flex-col items-center justify-center px-12">
      <h2 className="font-display text-xl text-amber-glow mb-2">{projectName}</h2>
      <p className="text-text-dim mb-6">{stage}</p>
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
      {progress !== undefined && (
        <p className="text-text text-sm mt-3">{progress}%</p>
      )}
    </div>
  );
}
