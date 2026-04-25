type Part = { start: number; end: number; confidence?: number; transcript?: string };

type Props = { p1?: Part; p2?: Part };

export function PartInspector({ p1, p2 }: Props) {
  return (
    <div className="space-y-3">
      <PartCard color="amber" label="Khutbah Part 1" data={p1} />
      <PartCard color="green" label="Khutbah Part 2" data={p2} />
    </div>
  );
}

function PartCard({ color, label, data }: { color: 'amber' | 'green'; label: string; data?: Part }) {
  const dur = data ? data.end - data.start : 0;
  const colorClass = color === 'amber' ? 'border-l-amber' : 'border-l-green';
  return (
    <div className={`bg-bg-3 border border-border-strong border-l-4 ${colorClass} rounded p-3`}>
      <div className="flex items-baseline gap-2">
        <span className="font-arabic text-text-strong text-base" dir="rtl" lang="ar">{label}</span>
        <span className="ml-auto text-text-muted text-xs font-mono">
          {Math.floor(dur / 60)}:{String(Math.floor(dur % 60)).padStart(2, '0')}
        </span>
      </div>
      {data?.confidence !== undefined && (
        <div className="flex items-center gap-2 mt-2">
          <span className="text-green text-xs">{Math.round(data.confidence * 100)}%</span>
          <div className="flex-1 h-1 bg-border-strong rounded overflow-hidden">
            <div className="h-full bg-green" style={{ width: `${data.confidence * 100}%` }} />
          </div>
        </div>
      )}
      {data?.transcript && (
        <div
          className="mt-2 bg-bg-0 border border-border-strong rounded p-2 font-arabic text-xs text-text-dim leading-relaxed"
          dir="rtl"
          lang="ar"
        >
          {data.transcript}
        </div>
      )}
    </div>
  );
}
