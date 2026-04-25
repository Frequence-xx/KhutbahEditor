import { useRef, useEffect, useState, MouseEvent } from 'react';
import { useMarkers, MarkerKey } from './markersStore';

type Props = {
  currentTime: number;
  onSeek: (t: number) => void;
  onPlayPause: () => void;
  isPlaying: boolean;
  videoReady: boolean;
  waveform?: number[] | null;
  waveformStatus?: 'idle' | 'loading' | 'failed';
  onRetryWaveform?: () => void;
};

const COLORS: Record<MarkerKey, string> = {
  p1Start: 'bg-amber',
  p1End: 'bg-amber',
  p2Start: 'bg-green',
  p2End: 'bg-green',
};

const MARKER_LABELS: Record<MarkerKey, string> = {
  p1Start: 'P1 in',
  p1End: 'P1 out',
  p2Start: 'P2 in',
  p2End: 'P2 out',
};

function fmtTime(t: number): string {
  const s = Math.max(0, t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
  return `${m}:${sec.toFixed(2).padStart(5, '0')}`;
}

export function Timeline({
  currentTime,
  onSeek,
  onPlayPause,
  isPlaying,
  videoReady,
  waveform,
  waveformStatus = 'idle',
  onRetryWaveform,
}: Props) {
  const { markers, duration, setMarker } = useMarkers();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<MarkerKey | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [vZoom, setVZoom] = useState<number>(1);

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

  // Keyboard shortcuts: space = play/pause, J/L = seek ±5s, ←/→ = ±0.1s,
  // I/O = set Part 1 in/out from playhead, K/, = set Part 2 in/out.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      switch (e.key) {
        case ' ':
          if (!videoReady) return;
          e.preventDefault();
          onPlayPause();
          break;
        case 'j':
          if (!videoReady) return;
          e.preventDefault();
          onSeek(Math.max(0, currentTime - 5));
          break;
        case 'l':
          if (!videoReady) return;
          e.preventDefault();
          onSeek(Math.min(duration, currentTime + 5));
          break;
        case 'ArrowLeft':
          if (!videoReady) return;
          e.preventDefault();
          onSeek(Math.max(0, currentTime - 0.1));
          break;
        case 'ArrowRight':
          if (!videoReady) return;
          e.preventDefault();
          onSeek(Math.min(duration, currentTime + 0.1));
          break;
        case 'i':
          e.preventDefault();
          setMarker('p1Start', currentTime);
          break;
        case 'o':
          e.preventDefault();
          setMarker('p1End', currentTime);
          break;
        case 'k':
          e.preventDefault();
          setMarker('p2Start', currentTime);
          break;
        case ',':
          e.preventDefault();
          setMarker('p2End', currentTime);
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentTime, duration, onSeek, onPlayPause, setMarker, videoReady]);

  const part1Width = pctOf(markers.p1End - markers.p1Start);
  const part2Width = pctOf(markers.p2End - markers.p2Start);
  const trackWidth = `${100 * zoom}%`;

  // Tick marks scaled by zoom so a comfortable count stays on screen.
  const tickStep = duration > 0 ? Math.max(1, Math.round(duration / (40 * zoom))) : 1;
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += tickStep) ticks.push(t);

  return (
    <div className="bg-bg-0 border-y border-border-strong px-3 py-2 select-none">
      {/* Transport row */}
      <div className="flex items-center gap-3 mb-2">
        <button
          onClick={onPlayPause}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          disabled={!videoReady}
          title={videoReady ? '' : 'Preview proxy not ready'}
          className="w-9 h-9 rounded-md bg-bg-2 border border-border-strong text-text-strong hover:bg-bg-3 flex items-center justify-center text-base disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          onClick={() => onSeek(Math.max(0, currentTime - 5))}
          aria-label="Back 5 seconds"
          disabled={!videoReady}
          className="px-2 h-9 rounded-md bg-bg-2 border border-border-strong text-text-muted hover:text-text-strong text-xs font-mono disabled:opacity-40 disabled:cursor-not-allowed"
        >
          −5s
        </button>
        <button
          onClick={() => onSeek(Math.min(duration, currentTime + 5))}
          aria-label="Forward 5 seconds"
          disabled={!videoReady}
          className="px-2 h-9 rounded-md bg-bg-2 border border-border-strong text-text-muted hover:text-text-strong text-xs font-mono disabled:opacity-40 disabled:cursor-not-allowed"
        >
          +5s
        </button>
        <span className="font-mono text-text-strong text-sm">{fmtTime(currentTime)}</span>
        <span className="text-text-muted text-xs">/ {fmtTime(duration)}</span>
        {!videoReady && (
          <span className="text-amber text-xs">· video preview not ready</span>
        )}

        <div className="ml-auto flex items-center gap-2 text-text-muted text-xs">
          <span>Set marker from playhead:</span>
          {(['p1Start', 'p1End', 'p2Start', 'p2End'] as MarkerKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setMarker(k, currentTime)}
              className={`px-2 h-7 rounded border text-[10px] font-mono uppercase tracking-wider hover:bg-bg-3 ${
                k.startsWith('p1')
                  ? 'border-amber/60 text-amber'
                  : 'border-green/60 text-green'
              }`}
            >
              {MARKER_LABELS[k]}
            </button>
          ))}
        </div>
      </div>

      {/* Zoom + shortcuts row */}
      <div className="flex items-center gap-3 mb-2 text-text-muted text-[11px]">
        <span className="uppercase tracking-wider font-bold">Timeline</span>
        <label className="flex items-center gap-2">
          <span>Zoom</span>
          <input
            type="range"
            min={1}
            max={10}
            step={0.5}
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="w-32 accent-amber"
          />
          <span className="font-mono">{zoom.toFixed(1)}×</span>
        </label>
        <label className="flex items-center gap-2">
          <span>Track</span>
          <input
            type="range"
            min={1}
            max={6}
            step={0.5}
            value={vZoom}
            onChange={(e) => setVZoom(parseFloat(e.target.value))}
            className="w-24 accent-amber"
          />
          <span className="font-mono">{vZoom.toFixed(1)}×</span>
        </label>
        {waveformStatus === 'loading' && !waveform && (
          <span className="text-text-dim flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber animate-pulse" aria-hidden />
            Loading audio track…
          </span>
        )}
        {waveformStatus === 'failed' && !waveform && (
          <span className="text-danger flex items-center gap-1">
            Audio track unavailable
            {onRetryWaveform && (
              <button onClick={onRetryWaveform} className="underline hover:text-text-strong ml-1">
                retry
              </button>
            )}
          </span>
        )}
        <span className="ml-auto text-text-dim">
          Space play/pause · J/L ±5s · ←/→ ±0.1s · I/O Part 1 · K/, Part 2
        </span>
      </div>

      <div className="overflow-auto khutbah-scrollbar pb-2 max-h-80">
        <div
          ref={trackRef}
          onClick={onTrackClick}
          style={{ width: trackWidth, height: `${80 * vZoom}px` }}
          className="relative bg-bg-1 border border-border-strong rounded-md cursor-pointer"
        >
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute top-0 bottom-0 border-l border-border-strong/40"
              style={{ left: `${pctOf(t)}%` }}
            >
              <span className="absolute top-0.5 left-1 text-text-dim text-[9px] font-mono">
                {fmtTime(t)}
              </span>
            </div>
          ))}
          {waveform && waveform.length > 0 && (
            <svg
              viewBox={`0 0 ${waveform.length} 100`}
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full pointer-events-none"
              aria-hidden
            >
              {waveform.map((p, i) => {
                // Normalised 0..100 — the SVG stretches to fill the (now
                // taller) track via preserveAspectRatio=none, so the bars
                // get bigger as the user raises the Track zoom slider.
                const h = Math.min(100, p * 100);
                return (
                  <line
                    key={i}
                    x1={i + 0.5}
                    x2={i + 0.5}
                    y1={50 - h / 2}
                    y2={50 + h / 2}
                    stroke="rgb(245 233 200 / 0.5)"
                    strokeWidth={1}
                  />
                );
              })}
            </svg>
          )}
          <div
            className="absolute top-0 h-full bg-amber/40 border border-amber rounded"
            style={{ left: `${pctOf(markers.p1Start)}%`, width: `${part1Width}%` }}
          >
            <span className="absolute top-1/2 -translate-y-1/2 left-2 text-bg-3 text-xs font-bold">Part 1</span>
          </div>
          <div
            className="absolute top-0 h-full bg-green/40 border border-green rounded"
            style={{ left: `${pctOf(markers.p2Start)}%`, width: `${part2Width}%` }}
          >
            <span className="absolute top-1/2 -translate-y-1/2 left-2 text-bg-3 text-xs font-bold">Part 2</span>
          </div>
          {(['p1Start', 'p1End', 'p2Start', 'p2End'] as MarkerKey[]).map((key) => (
            <div
              key={key}
              onMouseDown={(e) => onMarkerMouseDown(e, key)}
              className="absolute -top-1 -bottom-1 w-1 cursor-ew-resize"
              style={{ left: `${pctOf(markers[key])}%` }}
              title={`${MARKER_LABELS[key]} — ${fmtTime(markers[key])}`}
            >
              <div className={`absolute -left-1.5 -top-0.5 w-3 h-3 rounded-sm border-2 border-bg-3 ${COLORS[key]}`} />
            </div>
          ))}
          <div
            className="absolute -top-2 -bottom-2 w-px bg-amber pointer-events-none"
            style={{ left: `${pctOf(currentTime)}%` }}
          >
            <div className="absolute -top-2 -left-1.5 w-3 h-3 rotate-45 bg-amber" />
          </div>
        </div>
      </div>
    </div>
  );
}
