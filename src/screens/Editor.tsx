import { useEffect, useRef, useState, MouseEvent as ReactMouseEvent } from 'react';
import { useProjects } from '../store/projects';
import { VideoPreview, VideoHandle } from '../editor/VideoPreview';
import { Button } from '../components/ui/Button';
import { Timeline } from '../editor/Timeline';
import { useMarkers, MarkerKey } from '../editor/markersStore';
import { useEditorShortcuts } from '../editor/useShortcuts';
import { ProgressBar } from '../components/ui/ProgressBar';
import { useSettings } from '../store/settings';
import { PartInspector } from '../editor/PartInspector';
import { withETA, formatETA, type EnrichedProgress } from '../lib/eta';
import { toKhutbahFileUrl } from '../lib/fileUrl';

const MARKER_LABELS: Record<MarkerKey, string> = {
  p1Start: 'P1 IN',
  p1End: 'P1 OUT',
  p2Start: 'P2 IN',
  p2End: 'P2 OUT',
};

function fmtTime(t: number): string {
  const s = Math.max(0, t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
  return `${m}:${sec.toFixed(2).padStart(5, '0')}`;
}

type Props = { projectId: string; onBack: () => void; onUpload: () => void };

type DetectionResult =
  | {
      duration: number;
      part1: { start: number; end: number; confidence: number; transcript_at_start: string };
      part2: { start: number; end: number; confidence: number; transcript_at_end: string };
      lang_dominant: string;
      overall_confidence: number;
    }
  | { error: string; duration?: number };

export function Editor({ projectId, onBack, onUpload }: Props) {
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId));
  const updateProject = useProjects((s) => s.update);
  const [proxyReady, setProxyReady] = useState<boolean>(!!project?.proxyPath);
  const [proxyProgress, setProxyProgress] = useState<{ message: string; progress?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<VideoHandle>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const reset = useMarkers((s) => s.reset);
  const setMarker = useMarkers((s) => s.setMarker);
  const setDuration = useMarkers((s) => s.setDuration);
  const markers = useMarkers((s) => s.markers);
  const duration = useMarkers((s) => s.duration);
  const [exporting, setExporting] = useState<{ p1: number; p2: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState<EnrichedProgress | null>(null);
  const [detectStartedAt, setDetectStartedAt] = useState<number | null>(null);
  const [detectTick, setDetectTick] = useState<number>(0);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [waveform, setWaveform] = useState<number[] | null>(null);
  const [waveformStatus, setWaveformStatus] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [thumbs, setThumbs] = useState<{ index: number; time: number; path: string }[]>([]);
  const settings = useSettings((s) => s.settings);
  const loadSettings = useSettings((s) => s.load);

  // 3-column layout: player (resizable) | inspector | parts. Player defaults
  // to 1/3 of the viewport so the user gets a roomy preview without it
  // crowding out the inspector and parts panels. Drag the divider to grow
  // the player when needed (and the inspector shrinks correspondingly).
  const [playerPx, setPlayerPx] = useState<number>(() =>
    Math.max(320, Math.floor(window.innerWidth / 3)),
  );

  // When the proxy file is broken (decode error / unsupported codec — happens
  const [videoError, setVideoError] = useState<string | null>(null);
  function startResize(e: ReactMouseEvent): void {
    e.preventDefault();
    const startX = e.clientX;
    const startW = playerPx;
    const onMove = (ev: globalThis.MouseEvent) => {
      const next = startW + (ev.clientX - startX);
      // Clamp: 320px min so the video has some room; leave at least 480px
      // for the inspector + parts so the right side stays usable.
      setPlayerPx(Math.max(320, Math.min(window.innerWidth - 480, next)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function splitAtPlayhead(): void {
    setMarker('p1End', currentTime);
    setMarker('p2Start', currentTime);
  }
  // Split is meaningful only when the playhead sits inside the union of
  // the two parts — otherwise the operation either no-ops or violates
  // marker ordering (p1End must be ≥ p1Start, p2Start ≤ p2End).
  const canSplit = currentTime > markers.p1Start && currentTime < markers.p2End;

  // Keyboard shortcut handlers — rebuilt each render so closures always
  // capture the latest state. The hook re-registers the listener on each
  // render cycle (cheap — just remove + re-add one DOM listener).
  useEditorShortcuts({
    onPlayPause: () => {
      if (isPlaying) videoRef.current?.pause();
      else videoRef.current?.play();
    },
    onStepBack: () => {
      const next = Math.max(0, currentTime - 1);
      setCurrentTime(next);
      videoRef.current?.seek(next);
    },
    onStepForward: () => {
      const next = Math.min(duration, currentTime + 1);
      setCurrentTime(next);
      videoRef.current?.seek(next);
    },
    onStepBackFrame: () => {
      const next = Math.max(0, currentTime - 1 / 24);
      setCurrentTime(next);
      videoRef.current?.seek(next);
    },
    onStepForwardFrame: () => {
      const next = Math.min(duration, currentTime + 1 / 24);
      setCurrentTime(next);
      videoRef.current?.seek(next);
    },
    onSetIn: () => {
      // Playhead before p2Start → adjust P1 IN; otherwise adjust P2 IN.
      if (currentTime < markers.p2Start) setMarker('p1Start', currentTime);
      else setMarker('p2Start', currentTime);
    },
    onSetOut: () => {
      // Playhead before p2Start → adjust P1 OUT; otherwise adjust P2 OUT.
      if (currentTime < markers.p2Start) setMarker('p1End', currentTime);
      else setMarker('p2End', currentTime);
    },
    onSplit: () => {
      if (canSplit) splitAtPlayhead();
    },
  });

  useEffect(() => { loadSettings(); }, [loadSettings]);

  useEffect(() => {
    if (!project) return;
    if (project.part1 && project.part2) {
      // Markers were pre-filled by detection (Processing) or a prior export.
      // Set in reverse order to avoid clamping (each marker's max is the next
      // marker's current value; setting largest first keeps constraints valid).
      setDuration(project.duration);
      setMarker('p2End', project.part2.end);
      setMarker('p2Start', project.part2.start);
      setMarker('p1End', project.part1.end);
      setMarker('p1Start', project.part1.start);
    } else {
      reset(project.duration);
    }
  }, [
    project?.id,
    project?.duration,
    project?.part1?.start,
    project?.part1?.end,
    project?.part2?.start,
    project?.part2?.end,
    reset,
    setMarker,
    setDuration,
  ]);

  useEffect(() => {
    if (!project || !window.khutbah) return;
    let cancelled = false;
    (async () => {
      // Validate any existing proxyPath: if the file's missing or not
      // Chromium-friendly (e.g. 10-bit yuv420p10le from before the
      // Phase 2.1 ffmpeg fix), invalidate it and regenerate. Without
      // this, a stale proxy path persists across app restarts and the
      // editor renders an undecodable file forever.
      if (project.proxyPath) {
        let valid = false;
        try {
          valid = await window.khutbah!.pipeline.call<boolean>(
            'paths.is_chromium_friendly', { path: project.proxyPath }
          );
        } catch {
          valid = false;
        }
        if (cancelled) return;
        if (valid) {
          setProxyReady(true);
          return;
        }
        console.warn('[editor] stored proxy is stale or unfriendly, regenerating', {
          proxyPath: project.proxyPath,
        });
        updateProject(project.id, { proxyPath: undefined, proxySkipped: false });
        return;
      }
      // Probe source: if already scrub-friendly, skip proxy gen entirely.
      let friendly = false;
      try {
        friendly = await window.khutbah!.pipeline.call<boolean>(
          'paths.is_chromium_friendly', { path: project.sourcePath }
        );
      } catch {
        friendly = false;
      }
      if (cancelled) return;
      if (friendly) {
        updateProject(project.id, { proxyPath: project.sourcePath, proxySkipped: true });
        setProxyReady(true);
        return;
      }
      setProxyProgress({ message: 'Starting preview proxy…' });
      const unsubscribe = window.khutbah!.pipeline.onProgress((params) => {
        if (cancelled || params.stage !== 'proxy') return;
        setProxyProgress({
          message: typeof params.message === 'string' ? params.message : 'Generating preview proxy…',
          progress: typeof params.progress === 'number' ? Math.round(params.progress * 100) : undefined,
        });
      });
      try {
        const proxyPath = project.sourcePath + '.proxy.mp4';
        await window.khutbah!.pipeline.call('edit.generate_proxy', {
          src: project.sourcePath,
          dst: proxyPath,
        });
        if (cancelled) { unsubscribe(); return; }
        updateProject(project.id, { proxyPath });
        setProxyReady(true);
        setProxyProgress(null);
      } catch (e: unknown) {
        if (cancelled) { unsubscribe(); return; }
        const msg = e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : String(e);
        setError(msg);
        setProxyProgress(null);
      }
      unsubscribe();
    })();
    return () => { cancelled = true; };
  }, [project?.id, project?.proxyPath, project?.sourcePath, updateProject]);

  async function runDetection(): Promise<void> {
    if (!project || !window.khutbah) return;
    setDetectionError(null);
    setDetectStartedAt(Date.now());
    setDetectTick(0);
    setDetecting({ stage: 'detect', message: 'Detecting boundaries…' });
    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = window.khutbah.pipeline.onProgress((params) => {
        if (params.stage === 'proxy') return;
        const stage = typeof params.stage === 'string' ? params.stage : 'detect';
        const message = typeof params.message === 'string' ? params.message : 'Detecting…';
        const progress = typeof params.progress === 'number' ? Math.round(params.progress * 100) : undefined;
        setDetecting((prev) => withETA(prev, { stage, message, progress }));
      });
      // Pass the current computeDevice setting per-call so the user's
      // Settings change takes effect without needing a sidecar restart.
      // The sidecar's KHUTBAH_COMPUTE_DEVICE env was captured at spawn
      // time and would otherwise stay stale.
      const result = await window.khutbah.pipeline.call<DetectionResult>(
        'detect.run',
        {
          audio_path: project.sourcePath,
          device: settings?.computeDevice ?? 'auto',
        },
      );
      if ('error' in result) {
        setDetectionError(
          result.error === 'opening_not_found'
            ? 'Could not find the opening phrase. Mark Part 1 manually.'
            : result.error === 'sitting_silence_not_found'
              ? 'Could not detect a clear sitting silence. Mark boundaries manually.'
              : `Detection failed: ${result.error}`,
        );
        return;
      }
      setDuration(result.duration);
      setMarker('p2End', result.part2.end);
      setMarker('p2Start', result.part2.start);
      setMarker('p1End', result.part1.end);
      setMarker('p1Start', result.part1.start);
      updateProject(project.id, {
        status: 'processed',
        part1: {
          start: result.part1.start,
          end: result.part1.end,
          confidence: result.part1.confidence,
          transcript: result.part1.transcript_at_start,
        },
        part2: {
          start: result.part2.start,
          end: result.part2.end,
          confidence: result.part2.confidence,
          transcript: result.part2.transcript_at_end,
        },
      });
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : String(e);
      setDetectionError(msg);
    } finally {
      unsubscribe?.();
      setDetecting(null);
      setDetectStartedAt(null);
    }
  }

  // 1Hz tick that drives the elapsed-time readout while detection runs.
  // Without this the strip would only re-render when a Python progress event
  // arrives, leaving long quiet stretches (e.g. Whisper model load) with a
  // frozen clock — exactly the "no ETA / nothing visible" symptom the user
  // hit on long runs.
  useEffect(() => {
    if (detectStartedAt === null) return;
    const id = window.setInterval(() => setDetectTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [detectStartedAt]);

  // Stream-decode the waveform AND the video filmstrip in parallel. Both
  // emit progress events with partial payloads so the timeline fills in
  // left-to-right while decoding continues — Premiere/DaVinci-style instant
  // visual feedback instead of a blank lane during the 5-15s decode.
  useEffect(() => {
    if (!project || !window.khutbah) return;
    let cancelled = false;

    const unsubscribe = window.khutbah.pipeline.onProgress((params) => {
      if (cancelled) return;
      if (params.stage === 'waveform') {
        const peaks = (params as { peaks?: number[] }).peaks;
        if (Array.isArray(peaks) && peaks.length > 0) setWaveform(peaks);
      } else if (params.stage === 'filmstrip') {
        const t = (params as { thumbs?: { index: number; time: number; path: string }[] }).thumbs;
        if (Array.isArray(t)) setThumbs(t);
      }
    });

    if (!waveform) {
      setWaveformStatus('loading');
      (async () => {
        // Two-pass waveform: a coarse 200-bucket pass lands in ~1-2s
        // (tiny JSON, decode bottlenecked but bucketing is cheap), so the
        // user sees a recognisable rough waveform almost immediately —
        // Premiere/DaVinci-style "show me what I have, fill in detail
        // later". Then the 1500-bucket pass replaces it with the high-res
        // version.
        try {
          const coarse = await window.khutbah!.pipeline.call<{ peaks: number[] }>(
            'edit.waveform',
            { src: project.sourcePath, peaks_count: 200 },
          );
          if (cancelled) return;
          if (coarse.peaks.length > 0) setWaveform(coarse.peaks);
        } catch (e) {
          console.warn('[editor] coarse waveform failed:', e);
        }
        try {
          const fine = await window.khutbah!.pipeline.call<{ peaks: number[] }>(
            'edit.waveform',
            { src: project.sourcePath, peaks_count: 1500 },
          );
          if (cancelled) return;
          setWaveform(fine.peaks);
          setWaveformStatus('idle');
        } catch (e: unknown) {
          if (cancelled) return;
          console.warn('[editor] fine waveform failed:', e);
          setWaveformStatus('failed');
        }
      })();
    }

    if (thumbs.length === 0) {
      (async () => {
        try {
          const cacheDir = await window.khutbah!.paths.projectCacheDir(project.id);
          const result = await window.khutbah!.pipeline.call<{
            thumbs: { index: number; time: number; path: string }[];
          }>('edit.filmstrip', {
            src: project.sourcePath,
            output_dir: `${cacheDir}/thumbs`,
            count: 30,
            width: 160,
          });
          if (cancelled) return;
          setThumbs(result.thumbs);
        } catch (e: unknown) {
          if (cancelled) return;
          console.warn('[editor] filmstrip extract failed:', e);
        }
      })();
    }

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // We intentionally only re-run on sourcePath change; waveform/thumbs in
    // the deps would cause the effect to re-subscribe on every progress tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.sourcePath, project?.id]);

  function regenerateProxy(): void {
    if (!project) return;
    setError(null);
    setVideoError(null);
    setProxyReady(false);
    setProxyProgress({ message: 'Restarting preview proxy…' });
    // Clearing proxyPath retriggers the proxy-generation useEffect.
    updateProject(project.id, { proxyPath: undefined });
  }

  async function exportBoth(): Promise<void> {
    if (!project || !window.khutbah) return;
    setExportError(null);
    setExporting({ p1: 0, p2: 0 });
    let unsubscribe: (() => void) | null = null;
    try {
      // Settings might still be loading — fall back to spec defaults so the
      // export button works the moment the user lands on this screen.
      const dir = settings?.outputDir ?? (await window.khutbah.paths.defaultOutputDir());
      await window.khutbah.paths.ensureDir(dir);
      const base = `${project.id}-${Date.now()}`;
      const p1Out = `${dir}/${base}-part-1.mp4`;
      const p2Out = `${dir}/${base}-part-2.mp4`;
      const audioParams = {
        target_lufs: settings?.audioTargetLufs ?? -14.0,
        target_tp: settings?.audioTargetTp ?? -1.0,
        target_lra: settings?.audioTargetLra ?? 11.0,
      };

      // Live progress: smart_cut emits {stage: 'export', progress: 0..1}
      // while ffmpeg encodes. Without this the user clicks Export and sees
      // a static "Exporting…" label for 5+ minutes — exactly the "still in
      // mock mode" feeling they reported.
      let activePart: 'p1' | 'p2' = 'p1';
      unsubscribe = window.khutbah.pipeline.onProgress((params) => {
        if (params.stage !== 'export') return;
        const p = typeof params.progress === 'number'
          ? Math.max(0, Math.min(100, Math.round(params.progress * 100)))
          : undefined;
        if (p === undefined) return;
        setExporting((prev) => ({
          p1: activePart === 'p1' ? p : prev?.p1 ?? 0,
          p2: activePart === 'p2' ? p : prev?.p2 ?? 0,
        }));
      });

      activePart = 'p1';
      await window.khutbah.pipeline.call('edit.smart_cut', {
        src: project.sourcePath,
        dst: p1Out,
        start: markers.p1Start,
        end: markers.p1End,
        normalize_audio: true,
        ...audioParams,
      });
      setExporting({ p1: 100, p2: 0 });

      activePart = 'p2';
      await window.khutbah.pipeline.call('edit.smart_cut', {
        src: project.sourcePath,
        dst: p2Out,
        start: markers.p2Start,
        end: markers.p2End,
        normalize_audio: true,
        ...audioParams,
      });
      setExporting({ p1: 100, p2: 100 });
      updateProject(project.id, {
        status: 'processed',
        part1: { start: markers.p1Start, end: markers.p1End, outputPath: p1Out },
        part2: { start: markers.p2Start, end: markers.p2End, outputPath: p2Out },
      });
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e);
      setExportError(msg);
      setExporting(null);
    } finally {
      unsubscribe?.();
    }
  }

  if (!project) return <div className="p-8">Project not found</div>;

  return (
    <div className="flex-1 flex flex-col">
      <div className="px-6 py-3 border-b border-border-strong flex items-center gap-3 flex-wrap">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <span className="text-text-muted text-sm truncate max-w-md">
          {project.sourcePath.split('/').pop()}
        </span>
        {project.part1 && project.part2 ? (
          <span className="text-green text-xs flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green" aria-hidden /> Boundaries detected
            {typeof project.part1.confidence === 'number' && (
              <span className="text-text-muted ml-1">
                ({Math.round(project.part1.confidence * 100)}% / {Math.round((project.part2.confidence ?? 0) * 100)}%)
              </span>
            )}
          </span>
        ) : (
          <span className="text-amber text-xs flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber" aria-hidden /> Boundaries not detected — markers are placeholders
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={runDetection}
            disabled={!!detecting}
          >
            {detecting ? '⟳ Detecting…' : project.part1 && project.part2 ? '↻ Re-run detection' : '⟳ Run detection'}
          </Button>
          {(error || (proxyReady && project.proxyPath)) && (
            <Button variant="ghost" onClick={regenerateProxy} disabled={!!proxyProgress}>
              ↻ Rebuild preview
            </Button>
          )}
        </div>
      </div>
      {detecting && (() => {
        // detectTick is in dep array of this IIFE only via re-render — see the
        // useEffect above that bumps it once per second to keep elapsed live.
        void detectTick;
        const elapsedSec =
          detectStartedAt === null ? 0 : Math.max(0, (Date.now() - detectStartedAt) / 1000);
        const hasPercent = detecting.progress !== undefined && detecting.progress > 0;
        return (
          <div className="px-6 py-2 bg-bg-2 border-b border-border-strong">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-amber animate-pulse" aria-hidden />
              <span className="text-text-strong text-sm">{detecting.message}</span>
              <span className="ml-auto text-text-muted text-xs font-mono flex items-center gap-3">
                <span>{formatETA(elapsedSec)} elapsed</span>
                {hasPercent && (
                  <span>{Math.round(detecting.progress as number)}%</span>
                )}
                {detecting.etaSeconds !== undefined && detecting.etaSeconds > 0 && (
                  <span className="text-text-dim">~{formatETA(detecting.etaSeconds)} left</span>
                )}
              </span>
            </div>
            <div className="h-1 mt-1 bg-border-strong rounded overflow-hidden">
              {hasPercent ? (
                <div
                  className="h-full bg-gradient-to-r from-amber to-amber-dark transition-all duration-300"
                  style={{ width: `${Math.max(0, Math.min(100, detecting.progress as number))}%` }}
                />
              ) : (
                <div className="h-full bg-gradient-to-r from-transparent via-amber to-transparent animate-pulse" style={{ width: '40%' }} />
              )}
            </div>
          </div>
        );
      })()}
      {detectionError && !detecting && (
        <div className="px-6 py-2 bg-danger/10 border-b border-danger/40 text-danger text-sm">
          {detectionError}
        </div>
      )}
      <div
        className="flex-1 grid"
        style={{ gridTemplateColumns: `${playerPx}px 6px 1fr 320px`, minHeight: 0 }}
      >
        {/* Player column — resizable via the divider on its right. */}
        <div className="bg-bg-0 p-4 border-y border-l border-border-strong rounded-l-lg overflow-y-auto khutbah-scrollbar">
          <VideoPreview
            ref={videoRef}
            src={toKhutbahFileUrl(project.proxyPath ?? project.sourcePath)}
            onTimeUpdate={setCurrentTime}
            onPlayingChange={setIsPlaying}
            onLoadedMetadata={(d) => {
              // Ground-truth duration from the actual <video> element. Without
              // this, click-to-seek silently returns 0 whenever the project's
              // stored duration is missing/stale (older projects, partial
              // ingest, etc.) — the click-math multiplies by 0.
              if (d && d > 0) setDuration(d);
            }}
            onMediaError={(code) => {
              console.error('[editor] video decode error', { code, src: project.proxyPath ?? project.sourcePath });
              // Don't silently switch to source — that's how we ended up in regen loops
              // when the source was ALSO unfriendly. Surface the error; the user can
              // hit "Rebuild proxy" if they want to retry. We do auto-trigger one
              // rebuild attempt if no rebuild is currently in progress, since the
              // common case is "proxy gen got interrupted, file is truncated".
              if (code === 3 || code === 4) {
                setVideoError(`Preview failed to decode (code=${code}). Click Rebuild Proxy to regenerate.`);
                if (!proxyProgress) {
                  regenerateProxy();
                }
              }
            }}
          />
          {/* Non-blocking proxy banner — source plays right away; once the
              proxy completes the src above swaps and this banner clears. */}
          {!proxyReady && !error && (
            <div className="mt-2 px-3 py-2 bg-bg-2 border border-border-strong rounded text-xs">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-amber animate-pulse" aria-hidden />
                <span className="text-text-muted">
                  {proxyProgress?.message ?? 'Building scrub-friendly preview proxy in the background…'}
                </span>
                {proxyProgress?.progress !== undefined && (
                  <span className="ml-auto text-text-muted font-mono">
                    {proxyProgress.progress}%
                  </span>
                )}
              </div>
              <div className="h-0.5 mt-1 bg-border-strong rounded overflow-hidden">
                {proxyProgress?.progress !== undefined ? (
                  <div
                    className="h-full bg-gradient-to-r from-amber to-amber-dark transition-all duration-300"
                    style={{ width: `${Math.max(0, Math.min(100, proxyProgress.progress))}%` }}
                  />
                ) : (
                  <div
                    className="h-full bg-gradient-to-r from-transparent via-amber to-transparent animate-pulse"
                    style={{ width: '40%' }}
                  />
                )}
              </div>
            </div>
          )}
          {error && (
            <div className="mt-2 px-3 py-2 bg-danger/10 border border-danger/40 rounded text-xs text-danger flex items-center gap-2">
              <span>Preview proxy failed: {error}</span>
              <Button variant="ghost" onClick={regenerateProxy}>↻ Try again</Button>
            </div>
          )}
          {videoError && (
            <div className="mt-2 px-3 py-2 bg-danger/10 border border-danger/40 rounded text-sm">
              <span className="text-danger font-medium">{videoError}</span>{' '}
              <Button variant="ghost" onClick={regenerateProxy} disabled={!!proxyProgress}>
                ↻ Rebuild proxy
              </Button>
            </div>
          )}
          <div className="mt-3 text-text-muted text-xs font-mono">Time: {currentTime.toFixed(2)} s</div>
        </div>
        {/* Drag handle — 6px wide vertical strip; cursor changes on hover so
            it reads as resizable without needing extra chrome. */}
        <div
          onMouseDown={startResize}
          className="border-y border-border-strong bg-bg-1 hover:bg-amber/40 cursor-ew-resize"
          title="Drag to resize player"
        />
        {/* Inspector column — markers + split-at-playhead + detection summary. */}
        <div className="bg-bg-2 px-4 py-3 border-y border-border-strong overflow-y-auto khutbah-scrollbar">
          <h3 className="text-text-strong font-bold text-xs mb-2 uppercase tracking-wider">
            Markers
          </h3>
          <div className="space-y-1.5 mb-4">
            {(['p1Start', 'p1End', 'p2Start', 'p2End'] as MarkerKey[]).map((k) => {
              const isP1 = k.startsWith('p1');
              return (
                <div
                  key={k}
                  className="flex items-center gap-2 px-2 py-1.5 bg-bg-3 border border-border-strong rounded"
                >
                  <span
                    className={`w-2 h-2 rounded-full ${isP1 ? 'bg-amber' : 'bg-green'}`}
                    aria-hidden
                  />
                  <span
                    className={`font-bold text-[10px] uppercase tracking-wider ${
                      isP1 ? 'text-amber' : 'text-green'
                    }`}
                  >
                    {MARKER_LABELS[k]}
                  </span>
                  <span className="ml-auto font-mono text-text-strong text-xs">
                    {fmtTime(markers[k])}
                  </span>
                  <button
                    onClick={() => setMarker(k, currentTime)}
                    title="Set to playhead"
                    className="px-1.5 h-6 rounded border border-border-strong text-text-muted hover:text-text-strong hover:bg-bg-2 text-[11px]"
                  >
                    ⤓ here
                  </button>
                  <button
                    onClick={() => videoRef.current?.seek(markers[k])}
                    title="Jump to marker"
                    className="px-1.5 h-6 rounded border border-border-strong text-text-muted hover:text-text-strong hover:bg-bg-2 text-[11px]"
                  >
                    ⏵ jump
                  </button>
                </div>
              );
            })}
          </div>

          <h3 className="text-text-strong font-bold text-xs mb-2 uppercase tracking-wider">
            Cut / Split
          </h3>
          <button
            onClick={splitAtPlayhead}
            disabled={!canSplit}
            title={
              canSplit
                ? `Set P1 OUT and P2 IN to ${fmtTime(currentTime)}`
                : 'Move the playhead inside the editing range first'
            }
            className="w-full px-3 py-2 bg-amber/15 border border-amber/60 text-amber rounded hover:bg-amber/25 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold"
          >
            ✂ Split Part 1 → Part 2 here
            <span className="block text-[10px] font-mono text-amber/80 mt-0.5">
              {fmtTime(currentTime)}
            </span>
          </button>
          <p className="mt-1 text-text-dim text-[11px] leading-snug">
            Sets <span className="text-amber">P1 OUT</span> and{' '}
            <span className="text-green">P2 IN</span> to the playhead — use this
            to fix a missed sitting silence.
          </p>

          {project.part1 && project.part2 && (
            <div className="mt-4 pt-3 border-t border-border-strong">
              <h3 className="text-text-strong font-bold text-xs mb-2 uppercase tracking-wider">
                Detection
              </h3>
              <div className="flex items-center gap-2 text-[11px] flex-wrap">
                <span className="text-text-muted">P1 confidence</span>
                <span
                  className={`font-mono ${
                    (project.part1.confidence ?? 0) >= 0.9 ? 'text-green' : 'text-amber'
                  }`}
                >
                  {Math.round((project.part1.confidence ?? 0) * 100)}%
                </span>
                <span className="text-text-muted ml-2">P2 confidence</span>
                <span
                  className={`font-mono ${
                    (project.part2.confidence ?? 0) >= 0.9 ? 'text-green' : 'text-amber'
                  }`}
                >
                  {Math.round((project.part2.confidence ?? 0) * 100)}%
                </span>
              </div>
            </div>
          )}
        </div>
        {/* Parts column — original PartInspector with full transcripts. */}
        <div className="bg-bg-2 p-4 border-y border-r border-border-strong rounded-r-lg overflow-y-auto khutbah-scrollbar">
          <PartInspector p1={project.part1} p2={project.part2} />
        </div>
      </div>
      <Timeline
        currentTime={currentTime}
        onSeek={(t) => {
          // Update the playhead state synchronously so the cursor jumps the
          // instant the click is processed. Without this we'd wait for the
          // video element's next timeupdate (max ~250ms later) before the
          // cursor moves — the click feels broken even when seek worked.
          setCurrentTime(t);
          videoRef.current?.seek(t);
        }}
        onPlayPause={() => {
          if (isPlaying) videoRef.current?.pause();
          else videoRef.current?.play();
        }}
        isPlaying={isPlaying}
        videoReady={!!project.sourcePath}
        waveform={waveform}
        waveformStatus={waveformStatus}
        onRetryWaveform={() => {
          setWaveform(null);
          setWaveformStatus('idle');
        }}
        thumbs={thumbs}
      />
      <div className="mt-2 px-6 text-xs text-text-secondary flex gap-3">
        <span><kbd className="px-1 border border-border rounded">Space</kbd> play/pause</span>
        <span><kbd className="px-1 border border-border rounded">J</kbd>/<kbd className="px-1 border border-border rounded">L</kbd> rew/fwd 1s</span>
        <span><kbd className="px-1 border border-border rounded">⇧←</kbd>/<kbd className="px-1 border border-border rounded">⇧→</kbd> 1 frame</span>
        <span><kbd className="px-1 border border-border rounded">I</kbd>/<kbd className="px-1 border border-border rounded">O</kbd> in/out</span>
        <span><kbd className="px-1 border border-border rounded">S</kbd> split</span>
      </div>
      <div className="px-6 py-3 border-t border-border-strong flex items-center gap-3">
        {exportError && <span className="text-danger text-xs">{exportError}</span>}
        {exporting && (
          <span className="text-text-muted text-xs flex items-center gap-2">
            Exporting…
            <span className="w-32">
              <ProgressBar value={(exporting.p1 + exporting.p2) / 2} />
            </span>
          </span>
        )}
        {!exporting && !exportError && <span className="text-text-muted text-xs">Ready to export</span>}
        <div className="ml-auto flex gap-2">
          <Button
            variant="primary"
            onClick={exportBoth}
            disabled={!!exporting || markers.p1End <= markers.p1Start || markers.p2End <= markers.p2Start}
            title={
              markers.p1End <= markers.p1Start || markers.p2End <= markers.p2Start
                ? 'Markers must form valid Part 1 and Part 2 ranges first'
                : exporting
                  ? 'Export in progress…'
                  : 'Encode P1 and P2 to MP4 with EBU R128 loudness normalisation'
            }
          >
            {exporting ? 'Exporting…' : 'Export 2 files'}
          </Button>
          {project.part1?.outputPath && project.part2?.outputPath && (
            <Button variant="upload" onClick={onUpload}>
              ↑ Upload to YouTube
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
