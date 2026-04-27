import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type View = 'review' | 'upload' | 'settings';

type State = {
  selectedProjectId: string | null;
  view: View;
  select: (id: string) => void;
  setView: (view: View) => void;
  clearSelection: () => void;
};

export const useUi = create<State>()(
  persist(
    (set) => ({
      selectedProjectId: null,
      view: 'review',
      select: (id) => set({ selectedProjectId: id, view: 'review' }),
      setView: (view) => set({ view }),
      clearSelection: () => set({ selectedProjectId: null }),
    }),
    { name: 'khutbah-ui', storage: createJSONStorage(() => localStorage) },
  ),
);
