import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getJobManager, _resetJobManagerForTests } from '../../src/jobs/instance';

describe('getJobManager (I5 singleton)', () => {
  beforeEach(() => {
    _resetJobManagerForTests();
    Object.assign(globalThis, {
      window: {
        khutbah: {
          pipeline: { call: vi.fn(), onProgress: vi.fn(() => () => {}) },
          auth: { accessToken: vi.fn(() => Promise.resolve({ accessToken: 't' })) },
        },
      },
    });
  });

  it('returns the same instance on every call', () => {
    const a = getJobManager();
    const b = getJobManager();
    const c = getJobManager();
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('does not eagerly read window.khutbah at import time', () => {
    // If the module had eagerly read window.khutbah on load, deleting it now
    // would not crash a subsequent getJobManager() — the instance would
    // already exist. This sanity-check verifies the lazy pattern.
    delete (globalThis as Record<string, unknown>).window;
    expect(() => getJobManager()).not.toThrow();
  });
});
