import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobManager } from '../../src/jobs/JobManager';
import type { Bridge } from '../../src/jobs/types';
import { useProjects } from '../../src/store/projects';
import { useToasts } from '../../src/store/toasts';
import { useUi } from '../../src/store/ui';

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

describe('JobManager — toast emission', () => {
  beforeEach(() => {
    useProjects.setState({
      projects: [{ id: 'p1', sourcePath: '/x.mp4', duration: 1, createdAt: 1, runState: 'idle' }],
    });
    useToasts.setState({ toasts: [] });
    useUi.setState({ selectedProjectId: null, view: 'review' });
  });

  it('on background detection success: pushes a success toast', async () => {
    const call = vi.fn((method: string) => {
      if (method === 'edit.thumbnails') return Promise.resolve({ paths: [] });
      if (method === 'detect.run') return Promise.resolve(detectOk);
      return Promise.reject(new Error('unexpected ' + method));
    });
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startDetect('p1');
    await new Promise((r) => setTimeout(r, 5));

    const toasts = useToasts.getState().toasts;
    expect(toasts.some((t) => t.kind === 'success' && /detection/i.test(t.message))).toBe(true);
  });

  it('on detection success when project IS selected and viewing review: no toast', async () => {
    useUi.setState({ selectedProjectId: 'p1', view: 'review' });
    const call = vi.fn((method: string) => {
      if (method === 'edit.thumbnails') return Promise.resolve({ paths: [] });
      if (method === 'detect.run') return Promise.resolve(detectOk);
      return Promise.reject(new Error('unexpected ' + method));
    });
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startDetect('p1');
    await new Promise((r) => setTimeout(r, 5));

    expect(useToasts.getState().toasts.length).toBe(0);
  });

  it('on detection failure when project IS selected: still pushes an error toast', async () => {
    useUi.setState({ selectedProjectId: 'p1', view: 'review' });
    const call = vi.fn((method: string) => {
      if (method === 'edit.thumbnails') return Promise.resolve({ paths: [] });
      if (method === 'detect.run') return Promise.reject(new Error('boom'));
      return Promise.reject(new Error('unexpected ' + method));
    });
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startDetect('p1');
    await new Promise((r) => setTimeout(r, 5));

    const toasts = useToasts.getState().toasts;
    expect(toasts.some((t) => t.kind === 'error' && /boom/.test(t.message))).toBe(true);
  });

  it('on upload success: always toasts even when project IS selected and viewing upload', async () => {
    useUi.setState({ selectedProjectId: 'p1', view: 'upload' });
    useProjects.setState({
      projects: [{
        id: 'p1', sourcePath: '/x.mp4', duration: 1, createdAt: 1, runState: 'ready',
        part1: { start: 0, end: 1, confidence: 0.95, outputPath: '/p1.mp4' },
        part2: { start: 1, end: 2, confidence: 0.95, outputPath: '/p2.mp4' },
      }],
    });
    const call = vi
      .fn()
      .mockResolvedValueOnce({ video_id: 'v1' })
      .mockResolvedValueOnce({ video_id: 'v2' });
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startUpload('p1', { channelId: 'c', title: 'K' });
    await new Promise((r) => setTimeout(r, 20));

    const toasts = useToasts.getState().toasts;
    expect(toasts.some((t) => t.kind === 'success' && /upload/i.test(t.message))).toBe(true);
  });

  it('on detection sidecar { error } response: pushes an error toast', async () => {
    const call = vi.fn((method: string) => {
      if (method === 'edit.thumbnails') return Promise.resolve({ paths: [] });
      if (method === 'detect.run') return Promise.resolve({ error: 'opening_not_found' });
      return Promise.reject(new Error('unexpected ' + method));
    });
    const jm = new JobManager(makeBridge(call as Bridge['call']));

    jm.startDetect('p1');
    await new Promise((r) => setTimeout(r, 5));

    expect(useToasts.getState().toasts.some((t) => t.kind === 'error' && /opening_not_found/.test(t.message))).toBe(true);
  });
});
