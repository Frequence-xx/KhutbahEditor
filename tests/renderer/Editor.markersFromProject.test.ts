import { describe, it, expect, beforeEach } from 'vitest';
import { useMarkers } from '../../src/editor/markersStore';

// We can't easily render Editor here without a DOM env. But we CAN
// verify the markersStore state machine matches what we expect after
// the Processing → Editor transition.

describe('markers from project (Processing → Editor)', () => {
  beforeEach(() => {
    useMarkers.getState().reset(0);
  });

  it('setDuration + setMarker in reverse order preserves detected boundaries', () => {
    // Must set in reverse order (p2End → p2Start → p1End → p1Start) to avoid
    // clamping: each marker's max is the next marker's current value.
    const { setDuration, setMarker } = useMarkers.getState();
    setDuration(1500);
    setMarker('p2End', 1004);
    setMarker('p2Start', 960);
    setMarker('p1End', 950);
    setMarker('p1Start', 5);

    const m = useMarkers.getState().markers;
    expect(m.p1Start).toBe(5);
    expect(m.p1End).toBe(950);
    expect(m.p2Start).toBe(960);
    expect(m.p2End).toBe(1004);
  });

  it('reset() with default percentages does NOT match detection-derived markers', () => {
    // This is what the bug looked like: reset overwrites detection
    const { setDuration, setMarker, reset } = useMarkers.getState();
    setDuration(1500);
    setMarker('p1Start', 5);
    setMarker('p1End', 950);
    setMarker('p2Start', 960);
    setMarker('p2End', 1004);
    reset(1500);
    // After reset, markers are at default percentages, NOT the detection values
    const m = useMarkers.getState().markers;
    expect(m.p1Start).toBe(75);    // 1500 * 0.05
    expect(m.p1End).toBe(675);     // 1500 * 0.45
    // (Editor.tsx must NOT call reset() when project.part1/part2 are populated.)
  });
});
