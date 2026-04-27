import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type RunState =
  | 'idle'
  | 'detecting'
  | 'cutting'
  | 'needs_review'
  | 'ready'
  | 'uploading'
  | 'uploaded'
  | 'error';

export type PartUploadResult = {
  videoId?: string;
  status: 'pending' | 'uploading' | 'done' | 'failed';
  error?: string;
};

export type Part = {
  start: number;
  end: number;
  confidence?: number;
  transcript?: string;
  outputPath?: string;
  uploads?: Record<string, PartUploadResult>;
  videoId?: string;
};

// Duplicated from src/jobs/types.ts to avoid a circular import (the JobManager
// imports the store; if the store imported from jobs/types.ts the dependency
// graph would close on itself). Shape MUST match UploadOpts there exactly.
export type LastUploadOpts = {
  channelId: string;
  playlistId?: string;
  title: string;
  thumbnailPath?: string;
};

export type Project = {
  id: string;
  sourcePath: string;
  proxyPath?: string;
  proxySkipped?: boolean;
  duration: number;
  createdAt: number;
  runState: RunState;
  progress?: number;
  lastError?: string;
  lastFailedKind?: 'detect' | 'cut' | 'upload';
  lastFailedCutPart?: 'p1' | 'p2';
  lastUploadOpts?: LastUploadOpts;
  thumbnailPath?: string;
  part1?: Part;
  part2?: Part;
};

type State = {
  projects: Project[];
  add: (p: Project) => void;
  update: (id: string, patch: Partial<Project>) => void;
  remove: (id: string) => void;
  setRunState: (id: string, runState: RunState) => void;
  setProgress: (id: string, progress: number) => void;
  setError: (id: string, message: string, kind?: 'detect' | 'cut' | 'upload') => void;
};

const STATUS_TO_RUN_STATE: Record<string, RunState> = {
  draft: 'idle',
  processed: 'ready',
  uploaded: 'uploaded',
  failed: 'error',
};

export const useProjects = create<State>()(
  persist(
    (set) => ({
      projects: [],
      add: (p) => set((s) => ({ projects: [p, ...s.projects] })),
      update: (id, patch) =>
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      remove: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
      setRunState: (id, runState) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? { ...p, runState, progress: undefined } : p,
          ),
        })),
      setProgress: (id, progress) =>
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...p, progress } : p)),
        })),
      setError: (id, message, kind) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id
              ? {
                  ...p,
                  runState: 'error' as const,
                  lastError: message,
                  lastFailedKind: kind,
                  progress: undefined,
                }
              : p,
          ),
        })),
    }),
    {
      name: 'khutbah-projects',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState, version) => {
        if (version === 0) {
          const old = persistedState as { projects?: Array<Record<string, unknown>> };
          const projects = (old.projects ?? []).map((p) => {
            const status = typeof p.status === 'string' ? p.status : undefined;
            const { status: _drop, ...rest } = p;
            void _drop;
            return { ...rest, runState: STATUS_TO_RUN_STATE[status ?? 'draft'] ?? 'idle' };
          });
          return { projects };
        }
        return persistedState;
      },
    },
  ),
);
