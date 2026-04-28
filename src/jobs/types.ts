export type JobKind = 'detect' | 'cut' | 'upload';

export type Boundary = 'p1Start' | 'p1End' | 'p2Start' | 'p2End';

export type UploadOpts = {
  channelId: string;
  playlistId?: string;
  title: string;
  thumbnailPath?: string;
};

/**
 * Progress notification from the Python sidecar (forwarded by Electron main).
 * Field names match the Python emitter (rpc.py + detect/*.py): stage,
 * message, progress (0–1.0), plus an opaque _request_id.
 *
 * The sidecar processes one request at a time, so the active JobManager
 * listener attributes incoming events to its currently-tracked project —
 * there is no projectId in the wire payload.
 */
export type ProgressEvent = {
  stage?: string;
  message?: string;
  progress?: number;
  _request_id?: number;
};

export interface Bridge {
  call<T>(method: string, params?: unknown): Promise<T>;
  onProgress(listener: (ev: ProgressEvent) => void): () => void;
  auth: {
    accessToken(channelId: string): Promise<{ accessToken: string }>;
  };
}
