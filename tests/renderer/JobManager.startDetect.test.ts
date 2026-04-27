import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobManager } from '../../src/jobs/JobManager';
import type { Bridge, ProgressEvent } from '../../src/jobs/types';
import { useProjects } from '../../src/store/projects';

const seed = () =>
  useProjects.setState({
    projects: [
      { id: 'p1', sourcePath: '/tmp/src.mp4', duration: 120, createdAt: 1, runState: 'idle' },
    ],
  });

describe('JobManager.startDetect', () => {
  beforeEach(() => {
    seed();
  });

  it('transitions runState idle → detecting → ready when both parts >= 0.9', async () => {
    let resolve!: (v: unknown) => void;
    const callPromise = new Promise((r) => {
      resolve = r;
    });
    const bridge: Bridge = {
      call: vi.fn(() => callPromise),
      onProgress: vi.fn(() => () => {}),
    };
    const jm = new JobManager(bridge);

    jm.startDetect('p1');
    expect(useProjects.getState().projects[0].runState).toBe('detecting');

    resolve({
      part1: { start: 10, end: 100, confidence: 0.95 },
      part2: { start: 110, end: 200, confidence: 0.92 },
    });
    await Promise.resolve();
    await Promise.resolve();

    const p = useProjects.getState().projects[0];
    expect(p.runState).toBe('ready');
    expect(p.part1?.confidence).toBe(0.95);
    expect(p.part2?.confidence).toBe(0.92);
  });

  it('transitions to needs_review when either part < 0.9', async () => {
    const bridge: Bridge = {
      call: vi.fn(() =>
        Promise.resolve({
          part1: { start: 10, end: 100, confidence: 0.95 },
          part2: { start: 110, end: 200, confidence: 0.71 },
        }),
      ),
      onProgress: vi.fn(() => () => {}),
    };
    const jm = new JobManager(bridge);

    jm.startDetect('p1');
    await new Promise((r) => setTimeout(r, 0));

    expect(useProjects.getState().projects[0].runState).toBe('needs_review');
  });

  it('transitions to error and stores lastError when call rejects', async () => {
    const bridge: Bridge = {
      call: vi.fn(() => Promise.reject(new Error('sidecar crash'))),
      onProgress: vi.fn(() => () => {}),
    };
    const jm = new JobManager(bridge);

    jm.startDetect('p1');
    await new Promise((r) => setTimeout(r, 0));

    const p = useProjects.getState().projects[0];
    expect(p.runState).toBe('error');
    expect(p.lastError).toBe('sidecar crash');
  });

  it('forwards progress events for the same projectId to setProgress', async () => {
    let listener!: (ev: ProgressEvent) => void;
    const bridge: Bridge = {
      call: vi.fn(() => new Promise(() => {})),
      onProgress: vi.fn((l) => {
        listener = l;
        return () => {};
      }),
    };
    const jm = new JobManager(bridge);
    jm.startDetect('p1');

    listener({ projectId: 'p1', stage: 'transcribe', pct: 42 });
    expect(useProjects.getState().projects[0].progress).toBe(42);

    listener({ projectId: 'other', stage: 'transcribe', pct: 99 });
    expect(useProjects.getState().projects[0].progress).toBe(42);
  });
});
