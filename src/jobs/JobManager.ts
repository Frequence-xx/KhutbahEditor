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
  constructor(private bridge: Bridge) {}

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
