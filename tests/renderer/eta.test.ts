import { describe, it, expect, vi, afterEach } from 'vitest';
import { withETA, formatETA } from '../../src/lib/eta';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withETA', () => {
  it('preserves startedAt across same-stage updates', () => {
    const baseTime = 1_000_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(baseTime);
    const first = withETA(null, { stage: 'transcribe', message: 'a', progress: 10 });
    expect(first.startedAt).toBe(baseTime);

    vi.spyOn(Date, 'now').mockReturnValue(baseTime + 5000);
    const second = withETA(first, { stage: 'transcribe', message: 'b', progress: 20 });
    expect(second.startedAt).toBe(baseTime); // same startedAt
    // 5s elapsed at 20% ⇒ 25s total ⇒ 20s remaining
    expect(second.etaSeconds).toBeGreaterThan(15);
    expect(second.etaSeconds).toBeLessThan(25);
  });

  it('resets startedAt on stage change', () => {
    const baseTime = 1_000_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(baseTime);
    const first = withETA(null, { stage: 'transcribe', message: '', progress: 50 });

    vi.spyOn(Date, 'now').mockReturnValue(baseTime + 10_000);
    const second = withETA(first, { stage: 'export', message: '', progress: 10 });
    expect(second.startedAt).toBe(baseTime + 10_000);
  });

  it('omits ETA on the very first tick — sub-second elapsed produces garbage', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000_000_000);
    const first = withETA(null, { stage: 'x', message: '', progress: 10 });
    expect(first.etaSeconds).toBeUndefined();
  });

  it('omits ETA below 2% (too noisy)', () => {
    const baseTime = 1_000_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(baseTime);
    const first = withETA(null, { stage: 'x', message: '', progress: 1 });
    vi.spyOn(Date, 'now').mockReturnValue(baseTime + 5000);
    const second = withETA(first, { stage: 'x', message: '', progress: 1 });
    expect(second.etaSeconds).toBeUndefined();
  });

  it('omits ETA when progress is 100% (done)', () => {
    const baseTime = 1_000_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(baseTime);
    const first = withETA(null, { stage: 'x', message: '', progress: 50 });
    vi.spyOn(Date, 'now').mockReturnValue(baseTime + 5000);
    const second = withETA(first, { stage: 'x', message: '', progress: 100 });
    expect(second.etaSeconds).toBeUndefined();
  });

  it('omits ETA when progress is undefined', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000_000_000);
    const first = withETA(null, { stage: 'x', message: 'loading' });
    expect(first.etaSeconds).toBeUndefined();
  });
});

describe('formatETA', () => {
  it('< 1 minute', () => expect(formatETA(45)).toBe('45s'));
  it('1-60 minutes', () => expect(formatETA(125)).toBe('2m 5s'));
  it('hours', () => expect(formatETA(7261)).toBe('2h 1m'));
  it('exactly 60s collapses to 1m', () => expect(formatETA(60)).toBe('1m'));
  it('whole minutes drop trailing 0s', () => expect(formatETA(120)).toBe('2m'));
  it('whole hours drop trailing 0m', () => expect(formatETA(7200)).toBe('2h'));
  it('rounds fractional seconds', () => expect(formatETA(64.6)).toBe('1m 5s'));
  it('clamps negative input', () => expect(formatETA(-5)).toBe('0s'));
});
