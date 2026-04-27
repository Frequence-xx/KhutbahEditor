import { useState } from 'react';
import type { Project, Part } from '../store/projects';
import type { Boundary } from '../jobs/types';

const REVIEW_THRESHOLD = 0.9;

const fileUrl = (path?: string) => (path ? `file://${path}` : undefined);

export type ReviewPaneProps = {
  project: Project;
  onAccept: () => void;
  onNudge: (boundary: Boundary, deltaSec: number) => void;
};

export function ReviewPane({ project, onAccept, onNudge }: ReviewPaneProps) {
  const part1Conf = project.part1?.confidence ?? 1;
  const part2Conf = project.part2?.confidence ?? 1;
  const lowerIsPart2 = part2Conf < part1Conf && part2Conf < REVIEW_THRESHOLD;
  const [active, setActive] = useState<'part1' | 'part2'>(lowerIsPart2 ? 'part2' : 'part1');
  const part: Part | undefined = active === 'part1' ? project.part1 : project.part2;
  const src = fileUrl(part?.outputPath);

  return (
    <div className="h-full p-4 flex flex-col gap-4">
      <div className="aspect-video bg-black rounded overflow-hidden">
        {src && (
          <video data-testid="preview" key={src} src={src} controls className="w-full h-full" />
        )}
      </div>
      <div role="tablist" className="flex gap-2">
        <button
          role="tab"
          aria-selected={active === 'part1'}
          onClick={() => setActive('part1')}
          className={`flex-1 py-2 rounded ${active === 'part1' ? 'bg-amber text-bg-1 font-semibold' : 'bg-bg-3 text-text'}`}
        >
          Part 1
        </button>
        <button
          role="tab"
          aria-selected={active === 'part2'}
          onClick={() => setActive('part2')}
          className={`flex-1 py-2 rounded ${active === 'part2' ? 'bg-amber text-bg-1 font-semibold' : 'bg-bg-3 text-text'}`}
        >
          Part 2
        </button>
      </div>
      <ReviewDetailCard
        partLabel={active === 'part1' ? 'Part 1' : 'Part 2'}
        part={part}
        boundaryPrefix={active}
        onNudge={onNudge}
      />
      <div className="flex justify-end">
        <button onClick={onAccept} className="px-4 py-2 bg-green text-bg-1 rounded font-semibold">
          Accept &amp; upload
        </button>
      </div>
    </div>
  );
}

function ReviewDetailCard({
  partLabel,
  part,
  boundaryPrefix,
  onNudge,
}: {
  partLabel: string;
  part?: Part;
  boundaryPrefix: 'part1' | 'part2';
  onNudge: (boundary: Boundary, deltaSec: number) => void;
}) {
  if (!part) return null;
  const conf = (part.confidence ?? 0) * 100;
  const review = (part.confidence ?? 0) < REVIEW_THRESHOLD;
  const fmt = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };
  const startKey: Boundary = boundaryPrefix === 'part1' ? 'p1Start' : 'p2Start';
  const endKey: Boundary = boundaryPrefix === 'part1' ? 'p1End' : 'p2End';

  return (
    <div className="bg-bg-3 rounded p-3 space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-text-dim">{partLabel}</span>
        <span className={review ? 'text-amber' : 'text-green'}>
          {Math.round(conf)}% {review ? 'review' : '✓'}
        </span>
      </div>
      <div className="font-mono text-xs text-text">{fmt(part.start)} → {fmt(part.end)}</div>
      <div className="flex gap-2 text-xs">
        <button onClick={() => onNudge(startKey, -5)} className="flex-1 py-1.5 bg-bg-1 border border-border-strong rounded text-text">Start −5s</button>
        <button onClick={() => onNudge(startKey, +5)} className="flex-1 py-1.5 bg-bg-1 border border-border-strong rounded text-text">Start +5s</button>
        <button onClick={() => onNudge(endKey, -5)} className="flex-1 py-1.5 bg-bg-1 border border-border-strong rounded text-text">End −5s</button>
        <button onClick={() => onNudge(endKey, +5)} className="flex-1 py-1.5 bg-bg-1 border border-border-strong rounded text-text">End +5s</button>
      </div>
    </div>
  );
}
