import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobManager } from '../../src/jobs/JobManager';
import type { Bridge } from '../../src/jobs/types';
import { useProjects } from '../../src/store/projects';

const detectOk = {
  duration: 200,
  part1: { start: 10, end: 100, confidence: 0.95 },
  part2: { start: 110, end: 195, confidence: 0.95 },
  lang_dominant: 'ar',
  overall_confidence: 0.95,
};

describe('JobManager.startDetect — thumbnail', () => {
  beforeEach(() => {
    useProjects.setState({
      projects: [
        { id: 'p1', sourcePath: '/tmp/src.mp4', duration: 1, createdAt: 1, runState: 'idle' },
      ],
    });
  });

  it('calls edit.thumbnails for the source before detect.run resolves and writes thumbnailPath', async () => {
    const calls: string[] = [];
    const call = vi.fn((method: string, params?: unknown) => {
      calls.push(method);
      if (method === 'edit.thumbnails') {
        // Verify the contract while we're here
        expect(params).toMatchObject({ src: '/tmp/src.mp4', count: 1 });
        return Promise.resolve({ paths: ['/tmp/src.mp4.thumbs/0.jpg'] });
      }
      if (method === 'detect.run') return Promise.resolve(detectOk);
      return Promise.reject(new Error('unexpected method ' + method));
    });
    const bridge: Bridge = { call: call as Bridge['call'], onProgress: vi.fn(() => () => {}) };
    const jm = new JobManager(bridge);

    jm.startDetect('p1');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.indexOf('edit.thumbnails')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('edit.thumbnails')).toBeLessThan(calls.indexOf('detect.run'));
    expect(useProjects.getState().projects[0].thumbnailPath).toBe('/tmp/src.mp4.thumbs/0.jpg');
  });

  it('a thumbnail failure does not block detection', async () => {
    const call = vi.fn((method: string) => {
      if (method === 'edit.thumbnails') return Promise.reject(new Error('ffmpeg fail'));
      if (method === 'detect.run') return Promise.resolve(detectOk);
      return Promise.reject(new Error('unexpected ' + method));
    });
    const bridge: Bridge = { call: call as Bridge['call'], onProgress: vi.fn(() => () => {}) };
    const jm = new JobManager(bridge);

    jm.startDetect('p1');
    await new Promise((r) => setTimeout(r, 5));

    expect(useProjects.getState().projects[0].runState).toBe('ready');
    expect(useProjects.getState().projects[0].thumbnailPath).toBeUndefined();
  });

  it('an empty paths array does not write a thumbnailPath', async () => {
    const call = vi.fn((method: string) => {
      if (method === 'edit.thumbnails') return Promise.resolve({ paths: [] });
      if (method === 'detect.run') return Promise.resolve(detectOk);
      return Promise.reject(new Error('unexpected ' + method));
    });
    const bridge: Bridge = { call: call as Bridge['call'], onProgress: vi.fn(() => () => {}) };
    const jm = new JobManager(bridge);

    jm.startDetect('p1');
    await new Promise((r) => setTimeout(r, 5));

    expect(useProjects.getState().projects[0].thumbnailPath).toBeUndefined();
  });
});
