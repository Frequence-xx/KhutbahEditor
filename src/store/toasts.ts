import { create } from 'zustand';

export type Toast = { id: string; kind: 'success' | 'error'; message: string };

type State = {
  toasts: Toast[];
  push: (t: Toast) => void;
  dismiss: (id: string) => void;
};

export const useToasts = create<State>((set) => ({
  toasts: [],
  push: (t) => set((s) => ({ toasts: [...s.toasts, t] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
