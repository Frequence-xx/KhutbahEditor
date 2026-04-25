import { useEffect, useRef, useState } from 'react';
import { useProjects } from '../store/projects';
import { VideoPreview, VideoHandle } from '../editor/VideoPreview';
import { Button } from '../components/ui/Button';
import { Timeline } from '../editor/Timeline';
import { useMarkers } from '../editor/markersStore';
import { ProgressBar } from '../components/ui/ProgressBar';
import { useSettings } from '../store/settings';
import { PartInspector } from '../editor/PartInspector';
import { withETA, formatETA, type EnrichedProgress } from '../lib/eta';
import { toKhutbahFileUrl } from '../lib/fileUrl';

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
  const [exporting, setExporting] = useState<{ p1: number; p2: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState<EnrichedProgress | null>(null);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [waveform, setWaveform] = useState<number[] | null>(null);
  const settings = useSettings((s) => s.settings);
  const loadSettings = useSettings((s) => s.load);

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
    if (!project || project.proxyPath || !window.khutbah) return;
    let cancelled = false;
    setProxyProgress({ message: 'Starting preview proxy…' });
    const unsubscribe = window.khutbah.pipeline.onProgress((params) => {
      if (cancelled || params.stage !== 'proxy') return;
      setProxyProgress({
        message: typeof params.message === 'string' ? params.message : 'Generating preview proxy…',
        progress: typeof params.progress === 'number' ? Math.round(params.progress * 100) : undefined,
      });
    });
    (async () => {
      try {
        const proxyPath = project.sourcePath + '.proxy.mp4';
        await window.khutbah!.pipeline.call('edit.generate_proxy', {
          src: project.sourcePath,
          dst: proxyPath,
        });
        if (cancelled) return;
        updateProject(project.id, { proxyPath });
        setProxyReady(true);
        setProxyProgress(null);
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : String(e);
        setError(msg);
        setProxyProgress(null);
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [project?.id, project?.proxyPath, project?.sourcePath, updateProject]);

  async function runDetection(): Promise<void> {
    if (!project || !window.khutbah) return;
    setDetectionError(null);
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
      const result = await window.khutbah.pipeline.call<DetectionResult>(
        'detect.run',
        { audio_path: project.sourcePath },
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
    }
  }

  // Lazy-fetch the waveform once the source is known. Background task; if it
  // fails we silently fall back to the marker-only timeline. We pull from the
  // ORIGINAL source (not proxy) because audio quality is irrelevant here —
  // we just need amplitude over time. ~0.8s/5min on this machine.
  useEffect(() => {
    if (!project || !window.khutbah || waveform) return;
    let cancelled = false;
    (async () => {
      try {
        const w = await window.khutbah!.pipeline.call<{ peaks: number[] }>(
          'edit.waveform',
          { src: project.sourcePath, peaks_count: 1500 },
        );
        if (!cancelled) setWaveform(w.peaks);
      } catch {
        // Non-fatal: timeline works without waveform.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project?.sourcePath, waveform]);

  function regenerateProxy(): void {
    if (!project) return;
    setError(null);
    setProxyReady(false);
    setProxyProgress({ message: 'Restarting preview proxy…' });
    // Clearing proxyPath retriggers the proxy-generation useEffect.
    updateProject(project.id, { proxyPath: undefined });
  }

  async function exportBoth(): Promise<void> {
    if (!project || !window.khutbah || !settings) return;
    setExportError(null);
    setExporting({ p1: 0, p2: 0 });
    try {
      // Use user-configured output dir if set, else default
      const dir = settings.outputDir ?? (await window.khutbah.paths.defaultOutputDir());
      await window.khutbah.paths.ensureDir(dir);
      const base = `${project.id}-${Date.now()}`;
      const p1Out = `${dir}/${base}-part-1.mp4`;
      const p2Out = `${dir}/${base}-part-2.mp4`;

      const audioParams = {
        target_lufs: settings.audioTargetLufs,
        target_tp: settings.audioTargetTp,
        target_lra: settings.audioTargetLra,
      };

      await window.khutbah.pipeline.call('edit.smart_cut', {
        src: project.sourcePath,
        dst: p1Out,
        start: markers.p1Start,
        end: markers.p1End,
        normalize_audio: true,
        ...audioParams,
      });
      setExporting({ p1: 100, p2: 0 });

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
      {detecting && (
        <div className="px-6 py-2 bg-bg-2 border-b border-border-strong">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-amber animate-pulse" aria-hidden />
            <span className="text-text-strong text-sm">{detecting.message}</span>
            {detecting.progress !== undefined && (
              <span className="ml-auto text-text-muted text-xs font-mono">
                {Math.round(detecting.progress)}%
                {detecting.etaSeconds !== undefined && detecting.etaSeconds > 0 && (
                  <span className="ml-2 text-text-dim">· ~{formatETA(detecting.etaSeconds)} left</span>
                )}
              </span>
            )}
          </div>
          <div className="h-1 mt-1 bg-border-strong rounded overflow-hidden">
            {detecting.progress !== undefined ? (
              <div
                className="h-full bg-gradient-to-r from-amber to-amber-dark transition-all duration-300"
                style={{ width: `${Math.max(0, Math.min(100, detecting.progress))}%` }}
              />
            ) : (
              <div className="h-full bg-gradient-to-r from-transparent via-amber to-transparent animate-pulse" style={{ width: '40%' }} />
            )}
          </div>
        </div>
      )}
      {detectionError && !detecting && (
        <div className="px-6 py-2 bg-danger/10 border-b border-danger/40 text-danger text-sm">
          {detectionError}
        </div>
      )}
      <div className="flex-1 p-6 grid grid-cols-[1fr_280px] gap-0">
        <div className="bg-bg-0 p-4 rounded-l-lg border border-border-strong">
          {error && (
            <div className="space-y-2 py-12 px-4">
              <div className="text-danger text-sm">Preview proxy failed: {error}</div>
              <Button variant="ghost" onClick={regenerateProxy}>↻ Try again</Button>
            </div>
          )}
          {!proxyReady && !error && (
            <div className="space-y-2 py-12 px-4">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-amber animate-pulse" aria-hidden />
                <span className="text-text-strong text-sm">
                  {proxyProgress?.message ?? 'Generating preview proxy…'}
                </span>
                {proxyProgress?.progress !== undefined && (
                  <span className="ml-auto text-text-muted text-xs font-mono">
                    {proxyProgress.progress}%
                  </span>
                )}
              </div>
              <div className="h-1.5 bg-border-strong rounded overflow-hidden">
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
          {proxyReady && project.proxyPath && (
            <VideoPreview
              ref={videoRef}
              src={toKhutbahFileUrl(project.proxyPath)}
              onTimeUpdate={setCurrentTime}
              onPlayingChange={setIsPlaying}
            />
          )}
          <div className="mt-3 text-text-muted text-xs font-mono">Time: {currentTime.toFixed(2)} s</div>
        </div>
        <div className="bg-bg-2 p-4 rounded-r-lg border-y border-r border-border-strong overflow-y-auto">
          <PartInspector p1={project.part1} p2={project.part2} />
        </div>
      </div>
      <Timeline
        currentTime={currentTime}
        onSeek={(t) => videoRef.current?.seek(t)}
        onPlayPause={() => {
          if (isPlaying) videoRef.current?.pause();
          else videoRef.current?.play();
        }}
        isPlaying={isPlaying}
        videoReady={proxyReady}
        waveform={waveform}
      />
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
            disabled={!proxyReady || !!exporting || !settings}
          >
            Export 2 files
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
