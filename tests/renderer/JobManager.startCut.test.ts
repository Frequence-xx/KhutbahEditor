import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { JobManager } from '../../src/jobs/JobManager';
import type { Bridge } from '../../src/jobs/types';
import { useProjects } from '../../src/store/projects';

const seed = () =>
  useProjects.setState({
    projects: [
      {
        id: 'p1',
        sourcePath: '/tmp/src.mp4',
        duration: 200,
        createdAt: 1,
        runState: 'ready',
        part1: { start: 10, end: 100, confidence: 0.95, outputPath: '/tmp/src.mp4.cut-p1.mp4' },
        part2: { start: 110, end: 195, confidence: 0.92, outputPath: '/tmp/src.mp4.cut-p2.mp4' },
      },
    ],
  });

const makeBridge = (call: Bridge['call']): Bridge => ({
  call,
  onProgress: vi.fn(() => () => {}),
  auth: { accessToken: vi.fn(() => Promise.resolve({ accessToken: 'mock-token' })) },
});

describe('JobManager.startCut', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    seed();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces rapid clicks — only one cut fires after 250ms settle', () => {
    const call = vi.fn(() => new Promise(() => {}));
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startCut('p1', 'p1Start', +5);
    jm.startCut('p1', 'p1Start', +5);
    jm.startCut('p1', 'p1Start', +5);

    vi.advanceTimersByTime(249);
    expect(call).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('boundary mutations accumulate across rapid clicks before the cut fires', () => {
    const call = vi.fn(() => new Promise(() => {}));
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startCut('p1', 'p1Start', +5);
    jm.startCut('p1', 'p1Start', +5);
    jm.startCut('p1', 'p1Start', +5);
    vi.advanceTimersByTime(260);

    expect(call).toHaveBeenCalledWith(
      'edit.smart_cut',
      expect.objectContaining({
        src: '/tmp/src.mp4',
        dst: '/tmp/src.mp4.cut-p1.mp4',
        start: 25,
        end: 100,
      }),
    );
  });

  it('p1Start +5 cuts Part 1 only, leaves Part 2 untouched', () => {
    const call = vi.fn(() => new Promise(() => {}));
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startCut('p1', 'p1Start', +5);
    vi.advanceTimersByTime(260);

    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      'edit.smart_cut',
      expect.objectContaining({
        src: '/tmp/src.mp4',
        dst: '/tmp/src.mp4.cut-p1.mp4',
        start: 15,
        end: 100,
      }),
    );
  });

  it('p2End -3 cuts Part 2 only, leaves Part 1 untouched', () => {
    const call = vi.fn(() => new Promise(() => {}));
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startCut('p1', 'p2End', -3);
    vi.advanceTimersByTime(260);

    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      'edit.smart_cut',
      expect.objectContaining({
        src: '/tmp/src.mp4',
        dst: '/tmp/src.mp4.cut-p2.mp4',
        start: 110,
        end: 192,
      }),
    );
  });

  it('updates runState to cutting while in flight', () => {
    const call = vi.fn(() => new Promise(() => {}));
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startCut('p1', 'p2End', -3);
    vi.advanceTimersByTime(260);

    expect(useProjects.getState().projects[0].runState).toBe('cutting');
  });

  it('on success applies new boundary + outputPath; returns to ready; other part unchanged', async () => {
    let resolve!: (v: unknown) => void;
    const call = vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startCut('p1', 'p2End', -3);
    vi.advanceTimersByTime(260);
    resolve({ output: '/tmp/src.mp4.cut-p2.mp4' });

    await vi.waitFor(() => {
      expect(useProjects.getState().projects[0].runState).toBe('ready');
    });

    const p = useProjects.getState().projects[0];
    expect(p.part2?.end).toBe(192);
    expect(p.part2?.outputPath).toBe('/tmp/src.mp4.cut-p2.mp4');
    // Part 1 untouched
    expect(p.part1?.start).toBe(10);
    expect(p.part1?.end).toBe(100);
    expect(p.part1?.outputPath).toBe('/tmp/src.mp4.cut-p1.mp4');
  });

  it('on rejection: setError with message; runState=error', async () => {
    const call = vi.fn(() => Promise.reject(new Error('ffmpeg crashed')));
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startCut('p1', 'p1Start', +5);
    vi.advanceTimersByTime(260);

    await vi.waitFor(() => {
      expect(useProjects.getState().projects[0].runState).toBe('error');
    });
    expect(useProjects.getState().projects[0].lastError).toBe('ffmpeg crashed');
  });

  it('does nothing for unknown projectId', () => {
    const call = vi.fn();
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startCut('does-not-exist', 'p1Start', +5);
    vi.advanceTimersByTime(260);

    expect(call).not.toHaveBeenCalled();
  });

  it('cancel(projectId) clears the debounce timer — pending nudge does not ghost-fire', () => {
    const call = vi.fn();
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startCut('p1', 'p1Start', +5);
    jm.cancel('p1');
    vi.advanceTimersByTime(500);

    expect(call).not.toHaveBeenCalled();
  });
});
