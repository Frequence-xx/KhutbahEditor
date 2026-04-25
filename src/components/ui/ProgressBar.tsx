type Props = { value: number; label?: string };

export function ProgressBar({ value, label }: Props) {
  return (
    <div className="space-y-1">
      {label && <div className="text-text-muted text-xs">{label}</div>}
      <div className="h-1 bg-border-strong rounded overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-amber to-amber-dark transition-all"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}
