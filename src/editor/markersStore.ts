import { create } from 'zustand';

export type MarkerKey = 'p1Start' | 'p1End' | 'p2Start' | 'p2End';

type State = {
  markers: Record<MarkerKey, number>;
  duration: number;
  setMarker: (k: MarkerKey, t: number) => void;
  setDuration: (d: number) => void;
  reset: (d: number) => void;
};

export const useMarkers = create<State>((set) => ({
  markers: { p1Start: 0, p1End: 0, p2Start: 0, p2End: 0 },
  duration: 0,
  setMarker: (k, t) =>
    set((s) => ({
      markers: { ...s.markers, [k]: Math.max(0, Math.min(s.duration, t)) },
    })),
  setDuration: (d) => set({ duration: d }),
  reset: (d) =>
    set({
      duration: d,
      markers: { p1Start: d * 0.05, p1End: d * 0.45, p2Start: d * 0.5, p2End: d * 0.95 },
    }),
}));
