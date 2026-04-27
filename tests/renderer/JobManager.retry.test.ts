import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobManager } from '../../src/jobs/JobManager';
import type { Bridge } from '../../src/jobs/types';
import { useProjects } from '../../src/store/projects';

const detectOk = {
  duration: 200,
  part1: { start: 0, end: 1, confidence: 0.95 },
  part2: { start: 1, end: 2, confidence: 0.95 },
  lang_dominant: 'ar',
  overall_confidence: 0.95,
};

const makeBridge = (call: Bridge['call']): Bridge => ({
  call,
  onProgress: vi.fn(() => () => {}),
  auth: { accessToken: vi.fn(() => Promise.resolve({ accessToken: 'tok' })) },
});

describe('JobManager.retry', () => {
  beforeEach(() => {
    useProjects.setState({ projects: [] });
  });

  it('after failed detect: retry calls detect.run again', async () => {
    useProjects.setState({
      projects: [
        {
          id: 'p1',
          sourcePath: '/x.mp4',
          duration: 1,
          createdAt: 1,
          runState: 'error',
          lastError: 'crash',
          lastFailedKind: 'detect',
        },
      ],
    });
    const call = vi.fn((method: string) => {
      if (method === 'edit.thumbnails') return Promise.resolve({ paths: [] });
      if (method === 'detect.run') return Promise.resolve(detectOk);
      return Promise.reject(new Error('unexpected ' + method));
    });
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.retry('p1');
    await new Promise((r) => setTimeout(r, 5));

    expect(call).toHaveBeenCalledWith(
      'detect.run',
      expect.objectContaining({ audio_path: '/x.mp4' }),
    );
  });

  it('after failed cut: retry calls edit.smart_cut for the failed part only', async () => {
    useProjects.setState({
      projects: [
        {
          id: 'p1',
          sourcePath: '/x.mp4',
          duration: 200,
          createdAt: 1,
          runState: 'error',
          lastError: 'ffmpeg fail',
          lastFailedKind: 'cut',
          lastFailedCutPart: 'p2',
          part1: { start: 0, end: 100, confidence: 0.95, outputPath: '/x.mp4.cut-p1.mp4' },
          part2: { start: 110, end: 195, confidence: 0.95, outputPath: '/x.mp4.cut-p2.mp4' },
        },
      ],
    });
    const call = vi.fn(() => new Promise(() => {}));
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.retry('p1');
    await new Promise((r) => setTimeout(r, 0));

    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      'edit.smart_cut',
      expect.objectContaining({
        src: '/x.mp4',
        dst: '/x.mp4.cut-p2.mp4',
        start: 110,
        end: 195,
      }),
    );
  });

  it('after failed upload: retry calls upload.video again with stored opts', async () => {
    useProjects.setState({
      projects: [
        {
          id: 'p1',
          sourcePath: '/x.mp4',
          duration: 200,
          createdAt: 1,
          runState: 'error',
          lastError: 'net',
          lastFailedKind: 'upload',
          lastUploadOpts: { channelId: 'c1', title: 'K' },
          part1: { start: 0, end: 100, confidence: 0.95, outputPath: '/x.mp4.cut-p1.mp4' },
          part2: { start: 110, end: 195, confidence: 0.95, outputPath: '/x.mp4.cut-p2.mp4' },
        },
      ],
    });
    const call = vi.fn(() => Promise.resolve({ video_id: 'v1' }));
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.retry('p1');
    await new Promise((r) => setTimeout(r, 5));

    expect(call).toHaveBeenCalledWith(
      'upload.video',
      expect.objectContaining({
        access_token: 'tok',
        file_path: '/x.mp4.cut-p1.mp4',
        title: 'K — Part 1',
      }),
    );
  });

  it('without lastFailedKind: noop', () => {
    useProjects.setState({
      projects: [
        {
          id: 'p1',
          sourcePath: '/x',
          duration: 1,
          createdAt: 1,
          runState: 'error',
          lastError: '?',
        },
      ],
    });
    const call = vi.fn();
    const bridge = makeBridge(call as Bridge['call']);
    const jm = new JobManager(bridge);

    jm.retry('p1');

    expect(call).not.toHaveBeenCalled();
    expect(bridge.auth.accessToken).not.toHaveBeenCalled();
  });

  it('cut retry without lastFailedCutPart: noop', () => {
    useProjects.setState({
      projects: [
        {
          id: 'p1',
          sourcePath: '/x',
          duration: 1,
          createdAt: 1,
          runState: 'error',
          lastError: 'fail',
          lastFailedKind: 'cut',
          // missing lastFailedCutPart
        },
      ],
    });
    const call = vi.fn();
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.retry('p1');

    expect(call).not.toHaveBeenCalled();
  });

  it('upload retry without lastUploadOpts: noop', () => {
    useProjects.setState({
      projects: [
        {
          id: 'p1',
          sourcePath: '/x',
          duration: 1,
          createdAt: 1,
          runState: 'error',
          lastError: 'fail',
          lastFailedKind: 'upload',
          // missing lastUploadOpts
        },
      ],
    });
    const call = vi.fn();
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.retry('p1');

    expect(call).not.toHaveBeenCalled();
  });

  it('does nothing for unknown projectId', () => {
    const call = vi.fn();
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.retry('does-not-exist');

    expect(call).not.toHaveBeenCalled();
  });
});
