import { JobManager } from './JobManager';
import type { Bridge, ProgressEvent } from './types';

let _instance: JobManager | null = null;

/**
 * Module-level singleton. Returns the same JobManager across the whole
 * renderer (Shell mounts, StrictMode double-mounts, route changes, etc.)
 * so per-project debounce timers and inFlight maps are never duplicated.
 *
 * The bridge accesses `window.khutbah` lazily inside each closure so this
 * module can be imported before the preload script has populated it
 * (e.g. in test setup that mocks window.khutbah in beforeEach).
 */
export function getJobManager(): JobManager {
  if (_instance) return _instance;
  const bridge: Bridge = {
    call: <T,>(method: string, params?: unknown) =>
      window.khutbah!.pipeline.call<T>(method, params as object | undefined),
    onProgress: (l: (ev: ProgressEvent) => void) =>
      window.khutbah!.pipeline.onProgress((ev) => l(ev as unknown as ProgressEvent)),
    auth: {
      accessToken: (channelId: string) =>
        window.khutbah!.auth.accessToken(channelId) as Promise<{ accessToken: string }>,
    },
  };
  _instance = new JobManager(bridge);
  return _instance;
}

/** Test-only: forget the singleton so each test can construct a fresh one. */
export function _resetJobManagerForTests(): void {
  _instance = null;
}
