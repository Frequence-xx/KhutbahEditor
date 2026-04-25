import { describe, it, expect, beforeEach } from 'vitest';
import { useMarkers } from '../../src/editor/markersStore';

describe('useMarkers', () => {
  beforeEach(() => {
    useMarkers.getState().reset(100);
  });

  it('reset places markers at sensible defaults', () => {
    const m = useMarkers.getState().markers;
    expect(m.p1Start).toBe(5);
    expect(m.p1End).toBe(45);
    expect(m.p2Start).toBe(50);
    expect(m.p2End).toBe(95);
  });

  it('setMarker clamps to ordering constraints (cannot cross neighbor)', () => {
    const { setMarker } = useMarkers.getState();
    // Try to drag p1Start past p1End (which is at 45)
    setMarker('p1Start', 60);
    expect(useMarkers.getState().markers.p1Start).toBe(45);
    // Try to drag p2End past duration
    setMarker('p2End', 200);
    expect(useMarkers.getState().markers.p2End).toBe(100);
    // Try to drag p2Start before p1End (which is at 45)
    setMarker('p2Start', 10);
    expect(useMarkers.getState().markers.p2Start).toBe(45);
  });

  it('setMarker clamps to [0, duration]', () => {
    const { setMarker } = useMarkers.getState();
    setMarker('p1Start', -5);
    expect(useMarkers.getState().markers.p1Start).toBe(0);
  });
});
