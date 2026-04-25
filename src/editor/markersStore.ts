import { create } from 'zustand';

export type MarkerKey = 'p1Start' | 'p1End' | 'p2Start' | 'p2End';

type State = {
  markers: Record<MarkerKey, number>;
  duration: number;
  setMarker: (k: MarkerKey, t: number) => void;
  setDuration: (d: number) => void;
  reset: (d: number) => void;
};

/** Clamp `t` to the valid range for marker `k`, given the current state.
 * Enforces ordering: p1Start ≤ p1End ≤ p2Start ≤ p2End. */
function clampMarker(k: MarkerKey, t: number, m: Record<MarkerKey, number>, duration: number): number {
  const min = (() => {
    switch (k) {
      case 'p1Start': return 0;
      case 'p1End':   return m.p1Start;
      case 'p2Start': return m.p1End;
      case 'p2End':   return m.p2Start;
    }
  })();
  const max = (() => {
    switch (k) {
      case 'p1Start': return m.p1End;
      case 'p1End':   return m.p2Start;
      case 'p2Start': return m.p2End;
      case 'p2End':   return duration;
    }
  })();
  return Math.max(min, Math.min(max, t));
}

export const useMarkers = create<State>((set) => ({
  markers: { p1Start: 0, p1End: 0, p2Start: 0, p2End: 0 },
  duration: 0,
  setMarker: (k, t) =>
    set((s) => ({
      markers: { ...s.markers, [k]: clampMarker(k, t, s.markers, s.duration) },
    })),
  setDuration: (d) => set({ duration: d }),
  reset: (d) =>
    set({
      duration: d,
      markers: { p1Start: d * 0.05, p1End: d * 0.45, p2Start: d * 0.5, p2End: d * 0.95 },
    }),
}));
