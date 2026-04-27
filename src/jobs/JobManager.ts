import type { Boundary, Bridge, JobKind, ProgressEvent, UploadOpts } from './types';
import { useProjects } from '../store/projects';
import { useUi } from '../store/ui';
import { useToasts } from '../store/toasts';

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

  private toast(
    projectId: string,
    kind: 'success' | 'error',
    message: string,
    alwaysShow = false,
  ): void {
    const ui = useUi.getState();
    const isCurrentlyVisible = ui.selectedProjectId === projectId && ui.view === 'review';
    if (kind === 'error' || alwaysShow || !isCurrentlyVisible) {
      useToasts.getState().push({
        id: `${projectId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind,
        message,
      });
    }
  }

  /**
   * Dual-file path: caller has a separate video + lapel-mic audio.
   * Chains align (recover offset) → apply_offset_mux (write a single muxed mp4
   * with the audio time-corrected) → updates the project's sourcePath to the
   * muxed file → kicks off the regular single-file detect.
   *
   * If align or mux fails, the project enters error state with lastFailedKind:
   * 'detect' so retry reuses the dual-file inputs are NOT re-runnable here —
   * the caller must invoke startDetectDual again with the same paths.
   */
  startDetectDual(projectId: string, videoPath: string, audioPath: string): void {
    this.cancel(projectId);

    const project = useProjects.getState().projects.find((p) => p.id === projectId);
    if (!project) return;

    // Failure fields belong to the previous run; the new run shouldn't carry them.
    useProjects.getState().update(projectId, {
      lastError: undefined,
      lastFailedKind: undefined,
      lastFailedCutPart: undefined,
    });
    useProjects.getState().setRunState(projectId, 'detecting');

    const dst = `${videoPath}.muxed.mp4`;
    void (async () => {
      try {
        const align = await this.bridge.call<{ offset_seconds: number; confidence: number }>(
          'align.dual_file',
          { video_path: videoPath, audio_path: audioPath },
        );
        await this.bridge.call<{ path: string }>('edit.apply_offset_mux', {
          video_path: videoPath,
          audio_path: audioPath,
          offset_seconds: align.offset_seconds,
          dst,
        });
        useProjects.getState().update(projectId, { sourcePath: dst });
        this.startDetect(projectId);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        useProjects.getState().setError(projectId, msg, 'detect');
        this.toast(projectId, 'error', msg);
      }
    })();
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

    // Failure fields belong to the previous run; the new run shouldn't carry them.
    useProjects.getState().update(projectId, {
      lastError: undefined,
      lastFailedKind: undefined,
      lastFailedCutPart: undefined,
    });
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
          useProjects.getState().setError(projectId, res.error, 'detect');
          this.toast(projectId, 'error', res.error);
          return;
        }
        useProjects.getState().update(projectId, { part1: res.part1, part2: res.part2 });
        useProjects
          .getState()
          .setRunState(projectId, res.overall_confidence < REVIEW_THRESHOLD ? 'needs_review' : 'ready');
        const basename = project.sourcePath.split('/').pop() ?? project.sourcePath;
        this.toast(projectId, 'success', `Detection complete: ${basename}`);
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        useProjects.getState().setError(projectId, msg, 'detect');
        this.toast(projectId, 'error', msg);
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

    // Failure fields belong to the previous run; the new run shouldn't carry them.
    useProjects.getState().update(projectId, {
      lastError: undefined,
      lastFailedKind: undefined,
      lastFailedCutPart: undefined,
    });
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
        // Record which part failed BEFORE setError so retry can target it.
        // setError clears progress in the same write; doing this first keeps
        // the two writes ordered cleanly.
        useProjects.getState().update(projectId, { lastFailedCutPart: partKey });
        useProjects.getState().setError(projectId, msg, 'cut');
        this.toast(projectId, 'error', msg);
      })
      .finally(() => {
        unsubscribe();
        if (this.inFlight.get(projectId)?.abort === abort) this.inFlight.delete(projectId);
      });
  }
  startUpload(projectId: string, opts: UploadOpts): void {
    this.cancel(projectId);

    const project = useProjects.getState().projects.find((p) => p.id === projectId);
    if (!project) return;

    // Persist opts BEFORE any await so retry can replay even if auth itself
    // rejects (which happens before runUpload's pre-uploading update would fire).
    useProjects.getState().update(projectId, { lastUploadOpts: opts });
    // Failure fields belong to the previous run; the new run shouldn't carry them.
    useProjects.getState().update(projectId, {
      lastError: undefined,
      lastFailedKind: undefined,
      lastFailedCutPart: undefined,
    });

    const abort = new AbortController();
    const unsubscribe = this.bridge.onProgress((ev: ProgressEvent) => {
      if (ev.projectId === projectId) {
        useProjects.getState().setProgress(projectId, ev.pct);
      }
    });
    this.inFlight.set(projectId, { kind: 'upload', abort, unsubscribe });

    // Run the async sequence.
    this.runUpload(projectId, opts, abort).finally(() => {
      unsubscribe();
      if (this.inFlight.get(projectId)?.abort === abort) this.inFlight.delete(projectId);
    });
  }

  private async runUpload(
    projectId: string,
    opts: UploadOpts,
    abort: AbortController,
  ): Promise<void> {
    try {
      const { accessToken } = await this.bridge.auth.accessToken(opts.channelId);
      if (abort.signal.aborted) return;

      // (lastUploadOpts and stale-failure clears were persisted in startUpload
      // BEFORE this await, so an auth rejection still leaves opts available
      // for retry.)
      useProjects.getState().setRunState(projectId, 'uploading');

      // Part 1 — skip if already uploaded for this channel
      const project1 = useProjects.getState().projects.find((p) => p.id === projectId);
      if (!project1) return;
      const part1Already = project1.part1?.uploads?.[opts.channelId]?.status === 'done';

      if (!part1Already) {
        await this.uploadPart(projectId, accessToken, opts, 1, abort);
        if (abort.signal.aborted) return;
      }

      // Part 2 — skip if already uploaded for this channel
      const project2 = useProjects.getState().projects.find((p) => p.id === projectId);
      if (!project2) return;
      const part2Already = project2.part2?.uploads?.[opts.channelId]?.status === 'done';

      if (!part2Already) {
        await this.uploadPart(projectId, accessToken, opts, 2, abort);
        if (abort.signal.aborted) return;
      }

      // Clear retry payload on success — stale opts must not survive a
      // completed run, otherwise a later double-click on Retry would re-fire.
      useProjects.getState().update(projectId, { lastUploadOpts: undefined });
      useProjects.getState().setRunState(projectId, 'uploaded');
      this.toast(projectId, 'success', `Upload complete: ${opts.title}`, /* alwaysShow */ true);
    } catch (err: unknown) {
      if (abort.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      useProjects.getState().setError(projectId, msg, 'upload');
      this.toast(projectId, 'error', msg);
    }
  }

  private async uploadPart(
    projectId: string,
    accessToken: string,
    opts: UploadOpts,
    partNum: 1 | 2,
    abort: AbortController,
  ): Promise<void> {
    const project = useProjects.getState().projects.find((p) => p.id === projectId);
    if (!project) return;
    const part = partNum === 1 ? project.part1 : project.part2;
    if (!part?.outputPath) {
      throw new Error(`Part ${partNum} has no outputPath`);
    }

    const partTitle = `${opts.title} — Part ${partNum}`;

    try {
      const res = await this.bridge.call<{ video_id: string }>('upload.video', {
        access_token: accessToken,
        file_path: part.outputPath,
        title: partTitle,
        description: '',
        tags: [],
      });

      // Persist videoId BEFORE the abort check — if cancel fires between server
      // success and our abort check, we'd otherwise lose the videoId and re-upload
      // on retry, creating a duplicate video on the channel.
      this.recordUpload(projectId, partNum, opts.channelId, {
        videoId: res.video_id,
        status: 'done',
      });
      if (abort.signal.aborted) return;

      // Best-effort thumbnail upload. Failure must not break the sequence.
      if (opts.thumbnailPath) {
        try {
          await this.bridge.call('upload.thumbnail', {
            access_token: accessToken,
            video_id: res.video_id,
            thumbnail_path: opts.thumbnailPath,
          });
        } catch {
          /* swallow — thumbnail is non-fatal */
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.recordUpload(projectId, partNum, opts.channelId, { status: 'failed', error: msg });
      throw err;
    }
  }

  private recordUpload(
    projectId: string,
    partNum: 1 | 2,
    channelId: string,
    result: {
      videoId?: string;
      status: 'pending' | 'uploading' | 'done' | 'failed';
      error?: string;
    },
  ): void {
    const project = useProjects.getState().projects.find((p) => p.id === projectId);
    if (!project) return;
    const partKey = partNum === 1 ? 'part1' : 'part2';
    const part = project[partKey];
    if (!part) return;
    const uploads = { ...(part.uploads ?? {}), [channelId]: result };
    useProjects.getState().update(projectId, { [partKey]: { ...part, uploads } });
  }
  retry(projectId: string): void {
    const project = useProjects.getState().projects.find((p) => p.id === projectId);
    if (!project) return;
    // Guard against double-clicks after a successful retry: lastFailedKind
    // can linger across a successful run if the next start* hasn't fired yet.
    // Only an actual error state should re-trigger work.
    if (project.runState !== 'error') return;
    if (!project.lastFailedKind) return;

    switch (project.lastFailedKind) {
      case 'detect':
        this.startDetect(projectId);
        return;
      case 'cut':
        if (project.lastFailedCutPart) {
          this.fireCut(projectId, project.lastFailedCutPart);
        }
        return;
      case 'upload':
        if (project.lastUploadOpts) {
          this.startUpload(projectId, project.lastUploadOpts);
        }
        return;
    }
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
