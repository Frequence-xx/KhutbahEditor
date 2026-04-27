export type JobKind = 'detect' | 'cut' | 'upload';

export type Boundary = 'p1Start' | 'p1End' | 'p2Start' | 'p2End';

export type UploadOpts = {
  channelId: string;
  playlistId?: string;
  title: string;
  thumbnailPath?: string;
};

export type ProgressEvent = {
  projectId: string;
  stage: string;
  pct: number;
};

export interface Bridge {
  call<T>(method: string, params?: unknown): Promise<T>;
  onProgress(listener: (ev: ProgressEvent) => void): () => void;
}
