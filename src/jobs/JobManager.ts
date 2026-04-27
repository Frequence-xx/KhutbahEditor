import type { Boundary, Bridge, JobKind, ProgressEvent, UploadOpts } from './types';
import { useProjects } from '../store/projects';

type InFlight = {
  kind: JobKind;
  abort: AbortController;
  unsubscribe: () => void;
};

type DetectionPart = {
  start: number;
  end: number;
  confidence: number;
  transcript_at_start?: string;
  transcript_at_end?: string;
};

type DetectionResult =
  | {
      duration: number;
      part1: DetectionPart;
      part2: DetectionPart;
      lang_dominant: string;
      overall_confidence: number;
    }
  | { error: string; duration?: number };

const REVIEW_THRESHOLD = 0.9;

export class JobManager {
  private inFlight = new Map<string, InFlight>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly NUDGE_DEBOUNCE_MS = 250;
  constructor(private bridge: Bridge) {}

  private static cutDst(sourcePath: string, partKey: 'p1' | 'p2'): string {
    return `${sourcePath}.cut-${partKey}.mp4`;
  }

  startDetect(projectId: string): void {
    this.cancel(projectId);

    const project = useProjects.getState().projects.find((p) => p.id === projectId);
    if (!project) return;

    const abort = new AbortController();
    const unsubscribe = this.bridge.onProgress((ev: ProgressEvent) => {
      if (ev.projectId === projectId) {
        useProjects.getState().setProgress(projectId, ev.pct);
      }
    });
    this.inFlight.set(projectId, { kind: 'detect', abort, unsubscribe });

    useProjects.getState().setRunState(projectId, 'detecting');

    // Best-effort thumbnail extraction (spec §6). Failure must not block detection.
    this.bridge
      .call<{ paths: string[] }>('edit.thumbnails', {
        src: project.sourcePath,
        output_dir: project.sourcePath + '.thumbs',
        count: 1,
      })
      .then((res) => {
        if (abort.signal.aborted) return;
        const path = res.paths[0];
        if (path) {
          useProjects.getState().update(projectId, { thumbnailPath: path });
        }
      })
      .catch(() => {
        /* ignore thumbnail failures */
      });

    this.bridge
      .call<DetectionResult>('detect.run', { audio_path: project.sourcePath })
      .then((res) => {
        if (abort.signal.aborted) return;
        if ('error' in res) {
          useProjects.getState().setError(projectId, res.error);
          return;
        }
        useProjects.getState().update(projectId, { part1: res.part1, part2: res.part2 });
        useProjects
          .getState()
          .setRunState(projectId, res.overall_confidence < REVIEW_THRESHOLD ? 'needs_review' : 'ready');
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

  startCut(projectId: string, boundary: Boundary, deltaSec: number): void {
    const project = useProjects.getState().projects.find((p) => p.id === projectId);
    if (!project) return;

    // Apply the boundary mutation eagerly so successive nudges accumulate
    // even before the debounce fires.
    const part1 = project.part1 ? { ...project.part1 } : undefined;
    const part2 = project.part2 ? { ...project.part2 } : undefined;
    if (part1 && boundary === 'p1Start') part1.start += deltaSec;
    if (part1 && boundary === 'p1End') part1.end += deltaSec;
    if (part2 && boundary === 'p2Start') part2.start += deltaSec;
    if (part2 && boundary === 'p2End') part2.end += deltaSec;
    useProjects.getState().update(projectId, { part1, part2 });

    // Reset debounce.
    const existing = this.debounceTimers.get(projectId);
    if (existing) clearTimeout(existing);

    const partKey: 'p1' | 'p2' = boundary === 'p1Start' || boundary === 'p1End' ? 'p1' : 'p2';
    const timer = setTimeout(() => {
      this.debounceTimers.delete(projectId);
      this.fireCut(projectId, partKey);
    }, JobManager.NUDGE_DEBOUNCE_MS);
    this.debounceTimers.set(projectId, timer);
  }

  private fireCut(projectId: string, partKey: 'p1' | 'p2'): void {
    this.cancel(projectId);

    const project = useProjects.getState().projects.find((p) => p.id === projectId);
    if (!project) return;

    const part = partKey === 'p1' ? project.part1 : project.part2;
    if (!part) return;

    const abort = new AbortController();
    const unsubscribe = this.bridge.onProgress((ev: ProgressEvent) => {
      if (ev.projectId === projectId) {
        useProjects.getState().setProgress(projectId, ev.pct);
      }
    });
    this.inFlight.set(projectId, { kind: 'cut', abort, unsubscribe });

    useProjects.getState().setRunState(projectId, 'cutting');

    const dst = JobManager.cutDst(project.sourcePath, partKey);
    this.bridge
      .call<{ output: string }>('edit.smart_cut', {
        src: project.sourcePath,
        dst,
        start: part.start,
        end: part.end,
      })
      .then((res) => {
        if (abort.signal.aborted) return;
        const updated = { ...part, outputPath: res.output };
        useProjects
          .getState()
          .update(projectId, partKey === 'p1' ? { part1: updated } : { part2: updated });
        useProjects.getState().setRunState(projectId, 'ready');
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
  startUpload(_projectId: string, _opts: UploadOpts): void {
    throw new Error('not implemented');
  }
  retry(_projectId: string): void {
    throw new Error('not implemented');
  }
  cancel(projectId: string): void {
    const t = this.debounceTimers.get(projectId);
    if (t) {
      clearTimeout(t);
      this.debounceTimers.delete(projectId);
    }
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
