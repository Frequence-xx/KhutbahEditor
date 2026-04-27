import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  auth: { accessToken: vi.fn(() => Promise.resolve({ accessToken: 'tok-1' })) },
});

describe('JobManager.startUpload', () => {
  beforeEach(() => {
    seed();
  });

  it('uploads part1 then part2 in sequence; transitions to uploaded on full success', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({ video_id: 'vid-1' })
      .mockResolvedValueOnce({ video_id: 'vid-2' });
    const bridge = makeBridge(call as Bridge['call']);
    const jm = new JobManager(bridge);

    jm.startUpload('p1', { channelId: 'ch1', title: 'Khutbah' });

    await vi.waitFor(() => {
      expect(useProjects.getState().projects[0].runState).toBe('uploaded');
    });

    expect(call).toHaveBeenNthCalledWith(
      1,
      'upload.video',
      expect.objectContaining({
        access_token: 'tok-1',
        file_path: '/tmp/src.mp4.cut-p1.mp4',
        title: 'Khutbah — Part 1',
      }),
    );
    expect(call).toHaveBeenNthCalledWith(
      2,
      'upload.video',
      expect.objectContaining({
        access_token: 'tok-1',
        file_path: '/tmp/src.mp4.cut-p2.mp4',
        title: 'Khutbah — Part 2',
      }),
    );

    const p = useProjects.getState().projects[0];
    expect(p.part1?.uploads?.['ch1']?.videoId).toBe('vid-1');
    expect(p.part1?.uploads?.['ch1']?.status).toBe('done');
    expect(p.part2?.uploads?.['ch1']?.videoId).toBe('vid-2');
    expect(p.part2?.uploads?.['ch1']?.status).toBe('done');
  });

  it('flips runState to uploading immediately after auth resolves', async () => {
    let resolveUpload!: (v: unknown) => void;
    const call = vi.fn(
      () =>
        new Promise((r) => {
          resolveUpload = r;
        }),
    );
    const bridge = makeBridge(call as Bridge['call']);
    const jm = new JobManager(bridge);

    jm.startUpload('p1', { channelId: 'ch1', title: 'Khutbah' });
    // Wait one microtask flush for the auth promise + upload kickoff
    await new Promise((r) => setTimeout(r, 0));
    expect(useProjects.getState().projects[0].runState).toBe('uploading');

    // Drain so the test doesn't leave a hanging promise
    resolveUpload({ video_id: 'vid-1' });
  });

  it('Part 1 failure: does not attempt Part 2; runState=error with Part 1 message', async () => {
    const call = vi.fn().mockRejectedValueOnce(new Error('quota exceeded'));
    const bridge = makeBridge(call as Bridge['call']);
    const jm = new JobManager(bridge);

    jm.startUpload('p1', { channelId: 'ch1', title: 'Khutbah' });

    await vi.waitFor(() => {
      expect(useProjects.getState().projects[0].runState).toBe('error');
    });

    expect(call).toHaveBeenCalledTimes(1);
    expect(useProjects.getState().projects[0].lastError).toBe('quota exceeded');
    expect(useProjects.getState().projects[0].part1?.uploads?.['ch1']?.status).toBe('failed');
  });

  it('Part 2 failure after Part 1 success: preserves part1.uploads videoId for retry', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({ video_id: 'vid-1' })
      .mockRejectedValueOnce(new Error('network down'));
    const bridge = makeBridge(call as Bridge['call']);
    const jm = new JobManager(bridge);

    jm.startUpload('p1', { channelId: 'ch1', title: 'Khutbah' });

    await vi.waitFor(() => {
      expect(useProjects.getState().projects[0].runState).toBe('error');
    });

    const p = useProjects.getState().projects[0];
    expect(p.lastError).toBe('network down');
    expect(p.part1?.uploads?.['ch1']?.videoId).toBe('vid-1');
    expect(p.part1?.uploads?.['ch1']?.status).toBe('done');
    expect(p.part2?.uploads?.['ch1']?.status).toBe('failed');
  });

  it('skips Part 1 upload if part1.uploads[channelId].status === "done" (resume after Part 2 failure)', async () => {
    // Pre-seed: Part 1 already uploaded successfully (resume scenario)
    useProjects.setState({
      projects: [
        {
          id: 'p1',
          sourcePath: '/tmp/src.mp4',
          duration: 200,
          createdAt: 1,
          runState: 'error',
          lastError: 'network down',
          part1: {
            start: 10,
            end: 100,
            confidence: 0.95,
            outputPath: '/tmp/src.mp4.cut-p1.mp4',
            uploads: { ch1: { videoId: 'vid-1', status: 'done' } },
          },
          part2: {
            start: 110,
            end: 195,
            confidence: 0.92,
            outputPath: '/tmp/src.mp4.cut-p2.mp4',
            uploads: { ch1: { status: 'failed', error: 'network down' } },
          },
        },
      ],
    });

    const call = vi.fn().mockResolvedValueOnce({ video_id: 'vid-2' });
    const bridge = makeBridge(call as Bridge['call']);
    const jm = new JobManager(bridge);

    jm.startUpload('p1', { channelId: 'ch1', title: 'Khutbah' });

    await vi.waitFor(() => {
      expect(useProjects.getState().projects[0].runState).toBe('uploaded');
    });

    // Only ONE call (Part 2), not two
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      'upload.video',
      expect.objectContaining({
        file_path: '/tmp/src.mp4.cut-p2.mp4',
        title: 'Khutbah — Part 2',
      }),
    );
    // Part 1 videoId still preserved
    expect(useProjects.getState().projects[0].part1?.uploads?.['ch1']?.videoId).toBe('vid-1');
  });

  it('best-effort thumbnail upload — failure does not break the upload sequence', async () => {
    const call = vi.fn().mockImplementation((method: string) => {
      if (method === 'upload.video') {
        const videoCount = call.mock.calls.filter(
          (c: unknown[]) => c[0] === 'upload.video',
        ).length;
        return Promise.resolve({ video_id: `vid-${videoCount}` });
      }
      if (method === 'upload.thumbnail') return Promise.reject(new Error('thumbnail too large'));
      return Promise.reject(new Error('unexpected'));
    });
    const bridge = makeBridge(call as Bridge['call']);
    const jm = new JobManager(bridge);

    jm.startUpload('p1', {
      channelId: 'ch1',
      title: 'Khutbah',
      thumbnailPath: '/tmp/src.mp4.thumbs/thumb-01.jpg',
    });

    await vi.waitFor(() => {
      expect(useProjects.getState().projects[0].runState).toBe('uploaded');
    });

    // Both videos uploaded successfully despite thumbnail failures
    const p = useProjects.getState().projects[0];
    expect(p.part1?.uploads?.['ch1']?.status).toBe('done');
    expect(p.part2?.uploads?.['ch1']?.status).toBe('done');
  });

  it('does nothing for unknown projectId', async () => {
    const call = vi.fn();
    const bridge = makeBridge(call as Bridge['call']);
    const jm = new JobManager(bridge);

    jm.startUpload('does-not-exist', { channelId: 'ch1', title: 'Khutbah' });
    await new Promise((r) => setTimeout(r, 5));

    expect(call).not.toHaveBeenCalled();
    expect(bridge.auth.accessToken).not.toHaveBeenCalled();
  });
});
