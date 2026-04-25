import { create } from 'zustand';
import type { AppSettings } from '../../electron/store';

type State = {
  settings: AppSettings | null;
  load: () => Promise<void>;
  patch: (p: Partial<AppSettings>) => Promise<void>;
};

export const useSettings = create<State>((set) => ({
  settings: null,
  load: async () => {
    if (!window.khutbah) return;
    set({ settings: await window.khutbah.settings.get() });
  },
  patch: async (p) => {
    if (!window.khutbah) return;
    set({ settings: await window.khutbah.settings.set(p) });
  },
}));
