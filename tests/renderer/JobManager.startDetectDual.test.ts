import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobManager } from '../../src/jobs/JobManager';
import type { Bridge } from '../../src/jobs/types';
import { useProjects } from '../../src/store/projects';

const seed = () =>
  useProjects.setState({
    projects: [
      { id: 'p1', sourcePath: '/tmp/v.mp4', duration: 0, createdAt: 1, runState: 'idle' },
    ],
  });

const makeBridge = (call: Bridge['call']): Bridge => ({
  call,
  onProgress: vi.fn(() => () => {}),
  auth: { accessToken: vi.fn(() => Promise.resolve({ accessToken: 'tok' })) },
});

describe('JobManager.startDetectDual', () => {
  beforeEach(() => {
    seed();
  });

  it('chains align → apply_offset_mux → detect, and updates sourcePath to the muxed file', async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const call = vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params });
      if (method === 'align.dual_file') return { offset_seconds: 0.42, confidence: 8.0 };
      if (method === 'edit.apply_offset_mux') return { path: '/tmp/v.mp4.muxed.mp4' };
      if (method === 'edit.thumbnails') return { paths: [] };
      if (method === 'detect.run')
        return {
          duration: 200,
          part1: { start: 10, end: 100, confidence: 0.95 },
          part2: { start: 110, end: 200, confidence: 0.95 },
          lang_dominant: 'ar',
          overall_confidence: 0.95,
        };
      return undefined;
    });
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startDetectDual('p1', '/tmp/v.mp4', '/tmp/a.wav');
    // Run all queued microtasks until detect resolves.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const align = calls.find((c) => c.method === 'align.dual_file');
    expect(align?.params).toEqual({ video_path: '/tmp/v.mp4', audio_path: '/tmp/a.wav' });

    const mux = calls.find((c) => c.method === 'edit.apply_offset_mux');
    expect(mux?.params).toEqual({
      video_path: '/tmp/v.mp4',
      audio_path: '/tmp/a.wav',
      offset_seconds: 0.42,
      dst: '/tmp/v.mp4.muxed.mp4',
    });

    const detect = calls.find((c) => c.method === 'detect.run');
    expect(detect?.params).toEqual({ audio_path: '/tmp/v.mp4.muxed.mp4' });

    const p = useProjects.getState().projects[0];
    expect(p.sourcePath).toBe('/tmp/v.mp4.muxed.mp4');
    expect(p.runState).toBe('ready');
  });

  it('sets error and skips detect if align rejects', async () => {
    const call = vi.fn(async (method: string) => {
      if (method === 'align.dual_file') throw new Error('align failed');
      if (method === 'edit.thumbnails') return { paths: [] };
      return undefined;
    });
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startDetectDual('p1', '/tmp/v.mp4', '/tmp/a.wav');
    await new Promise((r) => setTimeout(r, 10));

    const p = useProjects.getState().projects[0];
    expect(p.runState).toBe('error');
    expect(p.lastError).toContain('align');
    expect(p.lastFailedKind).toBe('detect');
    // detect should not have been called
    expect(call.mock.calls.find((c) => c[0] === 'detect.run')).toBeUndefined();
  });

  it('sets error and skips detect if mux rejects', async () => {
    const call = vi.fn(async (method: string) => {
      if (method === 'align.dual_file') return { offset_seconds: 0.0, confidence: 5.0 };
      if (method === 'edit.apply_offset_mux') throw new Error('mux failed');
      if (method === 'edit.thumbnails') return { paths: [] };
      return undefined;
    });
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startDetectDual('p1', '/tmp/v.mp4', '/tmp/a.wav');
    await new Promise((r) => setTimeout(r, 10));

    const p = useProjects.getState().projects[0];
    expect(p.runState).toBe('error');
    expect(p.lastError).toContain('mux');
    expect(call.mock.calls.find((c) => c[0] === 'detect.run')).toBeUndefined();
  });
});
