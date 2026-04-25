import { useEffect, useRef, useState } from 'react';
import { useProjects } from '../store/projects';
import { VideoPreview, VideoHandle } from '../editor/VideoPreview';
import { Button } from '../components/ui/Button';
import { Timeline } from '../editor/Timeline';
import { useMarkers } from '../editor/markersStore';

type Props = { projectId: string; onBack: () => void };

export function Editor({ projectId, onBack }: Props) {
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId));
  const updateProject = useProjects((s) => s.update);
  const [proxyReady, setProxyReady] = useState<boolean>(!!project?.proxyPath);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<VideoHandle>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const reset = useMarkers((s) => s.reset);

  useEffect(() => {
    if (project) reset(project.duration);
    // intentional: only re-init markers when the project ID or duration changes
  }, [project?.id, project?.duration, reset]);

  useEffect(() => {
    if (!project || project.proxyPath || !window.khutbah) return;
    let cancelled = false;
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
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project?.id, project?.proxyPath, project?.sourcePath, updateProject]);

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
          {!proxyReady && !error && <div className="text-text-muted text-sm">Generating preview proxy…</div>}
          {proxyReady && project.proxyPath && (
            <VideoPreview
              ref={videoRef}
              src={`file://${project.proxyPath}`}
              onTimeUpdate={setCurrentTime}
            />
          )}
          <div className="mt-3 text-text-muted text-xs font-mono">Time: {currentTime.toFixed(2)} s</div>
        </div>
        <div className="bg-bg-2 p-4 rounded-r-lg border-y border-r border-border-strong">
          <div className="text-text-muted uppercase text-xs tracking-wider mb-3">Markers</div>
        </div>
      </div>
      <Timeline
        currentTime={currentTime}
        onSeek={(t) => videoRef.current?.seek(t)}
      />
    </div>
  );
}
