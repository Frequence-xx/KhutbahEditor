import type { Boundary, Bridge, JobKind, UploadOpts } from './types';

type InFlight = {
  kind: JobKind;
  abort: AbortController;
};

export class JobManager {
  private inFlight = new Map<string, InFlight>();
  constructor(private bridge: Bridge) {}

  startDetect(_projectId: string): void {
    throw new Error('not implemented');
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
      this.inFlight.delete(projectId);
    }
  }
  isRunning(projectId: string): boolean {
    return this.inFlight.has(projectId);
  }
}
