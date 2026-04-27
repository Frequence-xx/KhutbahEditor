import type { Boundary, Bridge, JobKind, ProgressEvent, UploadOpts } from './types';
import { useProjects } from '../store/projects';
import { useSettings } from '../store/settings';

type InFlight = {
  kind: JobKind;
  abort: AbortController;
  unsubscribe: () => void;
};

const REVIEW_THRESHOLD = 0.9;

export class JobManager {
  private inFlight = new Map<string, InFlight>();
  constructor(private bridge: Bridge) {}

  startDetect(projectId: string): void {
    this.cancel(projectId);
    const abort = new AbortController();
    const unsubscribe = this.bridge.onProgress((ev: ProgressEvent) => {
      if (ev.projectId === projectId) {
        useProjects.getState().setProgress(projectId, ev.pct);
      }
    });
    this.inFlight.set(projectId, { kind: 'detect', abort, unsubscribe });

    const project = useProjects.getState().projects.find((p) => p.id === projectId);
    if (!project) return;

    useProjects.getState().setRunState(projectId, 'detecting');

    const device = useSettings.getState().settings?.computeDevice ?? 'auto';
    this.bridge
      .call<{
        part1: { start: number; end: number; confidence: number };
        part2: { start: number; end: number; confidence: number };
      }>('detect.run', { projectId, sourcePath: project.sourcePath, device })
      .then((res) => {
        if (abort.signal.aborted) return;
        useProjects.getState().update(projectId, { part1: res.part1, part2: res.part2 });
        const lo = Math.min(res.part1.confidence, res.part2.confidence);
        useProjects
          .getState()
          .setRunState(projectId, lo < REVIEW_THRESHOLD ? 'needs_review' : 'ready');
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        useProjects.getState().setError(projectId, msg);
      })
      .finally(() => {
        unsubscribe();
        if (this.inFlight.get(projectId)?.abort === abort) this.inFlight.delete(projectId);
      });
  }

  startCut(_projectId: string, _boundary: Boundary, _deltaSec: number): void {
    throw new Error('not implemented');
  }
  startUpload(_projectId: string, _opts: UploadOpts): void {
    throw new Error('not implemented');
  }
  retry(_projectId: string): void {
    throw new Error('not implemented');
  }
  cancel(projectId: string): void {
    const job = this.inFlight.get(projectId);
    if (job) {
      job.abort.abort();
      job.unsubscribe();
      this.inFlight.delete(projectId);
    }
  }
  isRunning(projectId: string): boolean {
    return this.inFlight.has(projectId);
  }
}
