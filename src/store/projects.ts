import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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
  /** Multi-account upload results keyed by channelId. */
  uploads?: Record<string, PartUploadResult>;
  /** Legacy single-account fields (Phase 1-3 pre-multi-account). Kept for back-compat
      until the Upload screen reads from `uploads` map. */
  videoId?: string;
};

export type Project = {
  id: string;
  sourcePath: string;
  proxyPath?: string;
  /** True when the source was already scrub-friendly and proxy generation was skipped. */
  proxySkipped?: boolean;
  duration: number;
  createdAt: number;
  status: 'draft' | 'processed' | 'uploaded' | 'failed';
  part1?: Part;
  part2?: Part;
};

type State = {
  projects: Project[];
  add: (p: Project) => void;
  update: (id: string, patch: Partial<Project>) => void;
  remove: (id: string) => void;
};

// Persisted to localStorage so projects survive HMR / page reload during dev,
// AND survive app restarts in production. (Project records are metadata only —
// the actual video files live on disk under the user's output dir.)
export const useProjects = create<State>()(
  persist(
    (set) => ({
      projects: [],
      add: (p) => set((s) => ({ projects: [p, ...s.projects] })),
      update: (id, patch) =>
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      remove: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
    }),
    { name: 'khutbah-projects', storage: createJSONStorage(() => localStorage) },
  ),
);
