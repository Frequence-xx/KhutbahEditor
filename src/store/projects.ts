import { create } from 'zustand';

export type Project = {
  id: string;            // path-derived hash
  sourcePath: string;
  proxyPath?: string;
  duration: number;
  createdAt: number;
  status: 'draft' | 'processed' | 'uploaded' | 'failed';
  part1?: {
    start: number;
    end: number;
    confidence?: number;
    transcript?: string;
    outputPath?: string;
    videoId?: string;
  };
  part2?: {
    start: number;
    end: number;
    confidence?: number;
    transcript?: string;
    outputPath?: string;
    videoId?: string;
  };
};

type State = {
  projects: Project[];
  add: (p: Project) => void;
  update: (id: string, patch: Partial<Project>) => void;
  remove: (id: string) => void;
};

export const useProjects = create<State>((set) => ({
  projects: [],
  add: (p) => set((s) => ({ projects: [p, ...s.projects] })),
  update: (id, patch) => set((s) => ({ projects: s.projects.map((p) => p.id === id ? { ...p, ...patch } : p) })),
  remove: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
}));
