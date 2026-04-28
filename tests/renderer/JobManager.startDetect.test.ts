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

const makeBridge = (
  call: Bridge['call'],
  onProgress: Bridge['onProgress'] = vi.fn(() => () => {}),
): Bridge => ({
  call,
  onProgress,
  auth: { accessToken: vi.fn(() => Promise.resolve({ accessToken: 'mock-token' })) },
});

describe('JobManager.startDetect', () => {
  beforeEach(() => {
    seed();
  });

  it('transitions runState idle → detecting → ready when overall_confidence >= 0.9', async () => {
    let resolve!: (v: unknown) => void;
    const callPromise = new Promise((r) => {
      resolve = r;
    });
    const call = vi.fn(() => callPromise);
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startDetect('p1');
    expect(useProjects.getState().projects[0].runState).toBe('detecting');

    resolve({
      duration: 200,
      part1: { start: 10, end: 100, confidence: 0.95 },
      part2: { start: 110, end: 200, confidence: 0.92 },
      lang_dominant: 'ar',
      overall_confidence: 0.93,
    });
    await Promise.resolve();
    await Promise.resolve();

    const p = useProjects.getState().projects[0];
    expect(p.runState).toBe('ready');
    expect(p.part1?.confidence).toBe(0.95);
    expect(p.part2?.confidence).toBe(0.92);
  });

  it('transitions to needs_review when overall_confidence < 0.9', async () => {
    const call = vi.fn(() =>
      Promise.resolve({
        duration: 200,
        part1: { start: 10, end: 100, confidence: 0.95 },
        part2: { start: 110, end: 200, confidence: 0.71 },
        lang_dominant: 'ar',
        overall_confidence: 0.71,
      }),
    );
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startDetect('p1');
    await new Promise((r) => setTimeout(r, 0));

    expect(useProjects.getState().projects[0].runState).toBe('needs_review');
  });

  it('transitions to error and stores lastError when call rejects', async () => {
    const call = vi.fn(() => Promise.reject(new Error('sidecar crash')));
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startDetect('p1');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const p = useProjects.getState().projects[0];
    expect(p.runState).toBe('error');
    expect(p.lastError).toBe('sidecar crash');
  });

  it('converts sidecar progress (0–1) to pct (0–100) and persists stage/message', async () => {
    let listener!: (ev: ProgressEvent) => void;
    const call = vi.fn(() => new Promise(() => {}));
    const onProgress = vi.fn((l: (ev: ProgressEvent) => void) => {
      listener = l;
      return () => {};
    });
    const jm = new JobManager(makeBridge(call as Bridge['call'], onProgress));
    jm.startDetect('p1');

    // Sidecar payload: {stage, message, progress: 0..1, _request_id}
    listener({ stage: 'transcribe', message: 'Decoding chunk 3/8', progress: 0.42 });
    const p = useProjects.getState().projects[0];
    expect(p.progress).toBe(42);
    expect(p.progressStage).toBe('transcribe');
    expect(p.progressMessage).toBe('Decoding chunk 3/8');
  });

  it('does nothing when projectId is unknown — no bridge call, no listener leak', () => {
    const call = vi.fn();
    const onProgress = vi.fn(() => () => {});
    const bridge = makeBridge(call as Bridge['call'], onProgress);
    const jm = new JobManager(bridge);
    jm.startDetect('does-not-exist');
    expect(call).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    expect(jm.isRunning('does-not-exist')).toBe(false);
  });

  it('handles { error } response from sidecar by setting runState=error', async () => {
    const call = vi.fn(() => Promise.resolve({ error: 'opening_not_found' }));
    const jm = new JobManager(makeBridge(call as Bridge['call']));
    jm.startDetect('p1');
    await new Promise((r) => setTimeout(r, 0));
    const p = useProjects.getState().projects[0];
    expect(p.runState).toBe('error');
    expect(p.lastError).toBe('opening_not_found');
  });

  it('cancel() during detection prevents the late resolve from clobbering state', async () => {
    let resolve!: (v: unknown) => void;
    const call = vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const jm = new JobManager(makeBridge(call as Bridge['call']));
    jm.startDetect('p1');
    expect(useProjects.getState().projects[0].runState).toBe('detecting');
    jm.cancel('p1');
    expect(jm.isRunning('p1')).toBe(false);
    resolve({
      duration: 200,
      part1: { start: 10, end: 100, confidence: 0.99 },
      part2: { start: 110, end: 200, confidence: 0.99 },
      lang_dominant: 'ar',
      overall_confidence: 0.99,
    });
    await new Promise((r) => setTimeout(r, 0));
    // runState should NOT have transitioned to 'ready' — late resolve was guarded
    expect(useProjects.getState().projects[0].runState).toBe('detecting');
  });
});
