import { useEffect, useRef, useState } from 'react';
import { useProjects } from '../store/projects';
import { VideoPreview, VideoHandle } from '../editor/VideoPreview';
import { Button } from '../components/ui/Button';
import { Timeline } from '../editor/Timeline';
import { useMarkers } from '../editor/markersStore';
import { ProgressBar } from '../components/ui/ProgressBar';
import { useSettings } from '../store/settings';
import { PartInspector } from '../editor/PartInspector';

type Props = { projectId: string; onBack: () => void; onUpload: () => void };

export function Editor({ projectId, onBack, onUpload }: Props) {
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId));
  const updateProject = useProjects((s) => s.update);
  const [proxyReady, setProxyReady] = useState<boolean>(!!project?.proxyPath);
  const [proxyProgress, setProxyProgress] = useState<{ message: string; progress?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<VideoHandle>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const reset = useMarkers((s) => s.reset);
  const setMarker = useMarkers((s) => s.setMarker);
  const setDuration = useMarkers((s) => s.setDuration);
  const markers = useMarkers((s) => s.markers);
  const [exporting, setExporting] = useState<{ p1: number; p2: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
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

  async function exportBoth(): Promise<void> {
    if (!project || !window.khutbah || !settings) return;
    setExportError(null);
    setExporting({ p1: 0, p2: 0 });
    try {
      // Use user-configured output dir if set, else default
      const dir = settings.outputDir ?? (await window.khutbah.paths.defaultOutputDir());
      await window.khutbah.paths.ensureDir(dir);
      const base = `${project.id}-${Date.now()}`;
      const p1Out = `${dir}/${base}-deel-1.mp4`;
      const p2Out = `${dir}/${base}-deel-2.mp4`;

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
      <div className="px-6 py-3 border-b border-border-strong flex items-center gap-3">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <span className="text-text-muted text-sm">{project.sourcePath.split('/').pop()}</span>
      </div>
      <div className="flex-1 p-6 grid grid-cols-[1fr_280px] gap-0">
        <div className="bg-bg-0 p-4 rounded-l-lg border border-border-strong">
          {error && <div className="text-danger text-sm">Proxy generation failed: {error}</div>}
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
              src={`khutbah-file://${project.proxyPath}`}
              onTimeUpdate={setCurrentTime}
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
