import { useRef, MouseEvent } from 'react';
import { useMarkers, MarkerKey } from './markersStore';

type Props = { currentTime: number; onSeek: (t: number) => void };

const COLORS: Record<MarkerKey, string> = {
  p1Start: 'bg-amber',
  p1End: 'bg-amber',
  p2Start: 'bg-green',
  p2End: 'bg-green',
};

export function Timeline({ currentTime, onSeek }: Props) {
  const { markers, duration, setMarker } = useMarkers();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<MarkerKey | null>(null);

  function pctOf(t: number): number {
    return duration > 0 ? (t / duration) * 100 : 0;
  }

  function onTrackClick(e: MouseEvent<HTMLDivElement>): void {
    if (dragging.current) return;
    const rect = trackRef.current!.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * duration;
    onSeek(t);
  }

  function onMarkerMouseDown(e: MouseEvent, key: MarkerKey): void {
    e.stopPropagation();
    dragging.current = key;
    const onMove = (ev: globalThis.MouseEvent) => {
      const rect = trackRef.current!.getBoundingClientRect();
      const t = ((ev.clientX - rect.left) / rect.width) * duration;
      setMarker(key, t);
    };
    const onUp = () => {
      dragging.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const part1Width = pctOf(markers.p1End - markers.p1Start);
  const part2Width = pctOf(markers.p2End - markers.p2Start);

  return (
    <div className="bg-bg-0 border-y border-border-strong p-3 select-none">
      <div className="flex items-center gap-3 mb-2 text-text-muted text-xs">
        <span className="uppercase tracking-wider font-bold">Timeline</span>
        <span className="ml-auto font-mono">
          {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
        </span>
      </div>
      <div
        ref={trackRef}
        onClick={onTrackClick}
        className="relative h-14 bg-bg-1 border border-border-strong rounded-md cursor-pointer overflow-visible"
      >
        {/* Part 1 segment */}
        <div
          className="absolute top-0 h-full bg-amber/40 border border-amber rounded"
          style={{ left: `${pctOf(markers.p1Start)}%`, width: `${part1Width}%` }}
        >
          <span className="absolute top-1/2 -translate-y-1/2 left-2 text-bg-3 text-xs font-bold">Part 1</span>
        </div>
        {/* Part 2 segment */}
        <div
          className="absolute top-0 h-full bg-green/40 border border-green rounded"
          style={{ left: `${pctOf(markers.p2Start)}%`, width: `${part2Width}%` }}
        >
          <span className="absolute top-1/2 -translate-y-1/2 left-2 text-bg-3 text-xs font-bold">Part 2</span>
        </div>
        {/* Markers */}
        {(['p1Start', 'p1End', 'p2Start', 'p2End'] as MarkerKey[]).map((key) => (
          <div
            key={key}
            onMouseDown={(e) => onMarkerMouseDown(e, key)}
            className="absolute -top-1 -bottom-1 w-1 cursor-ew-resize"
            style={{ left: `${pctOf(markers[key])}%` }}
          >
            <div className={`absolute -left-1.5 -top-0.5 w-3 h-3 rounded-sm border-2 border-bg-3 ${COLORS[key]}`} />
          </div>
        ))}
        {/* Playhead */}
        <div
          className="absolute -top-2 -bottom-2 w-px bg-amber pointer-events-none"
          style={{ left: `${pctOf(currentTime)}%` }}
        />
      </div>
    </div>
  );
}
