export type DetectingPaneProps = {
  projectName: string;
  progress?: number;
  stage: string;
};

export function DetectingPane({ projectName, progress, stage }: DetectingPaneProps) {
  const pct = progress ?? 0;
  return (
    <div className="h-full flex flex-col items-center justify-center px-12">
      <h2 className="font-display text-xl text-amber-300 mb-2">{projectName}</h2>
      <p className="text-slate-400 mb-6">{stage}</p>
      <div className="w-full max-w-md h-2 bg-slate-800 rounded overflow-hidden">
        <div
          role="progressbar"
          aria-valuenow={progress ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-full bg-amber-400 transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      {progress !== undefined && (
        <p className="text-slate-300 text-sm mt-3">{progress}%</p>
      )}
    </div>
  );
}
