import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobManager } from '../../src/jobs/JobManager';
import type { Bridge } from '../../src/jobs/types';
import { useProjects } from '../../src/store/projects';

const makeBridge = (): Bridge => ({
  call: vi.fn(),
  onProgress: vi.fn(() => () => {}),
  auth: { accessToken: vi.fn(() => Promise.resolve({ accessToken: 'mock-token' })) },
});

describe('JobManager — skeleton', () => {
  beforeEach(() => {
    useProjects.setState({ projects: [] });
  });

  it('exposes startDetect / startCut / startUpload / retry / cancel methods', () => {
    const jm = new JobManager(makeBridge());
    expect(typeof jm.startDetect).toBe('function');
    expect(typeof jm.startCut).toBe('function');
    expect(typeof jm.startUpload).toBe('function');
    expect(typeof jm.retry).toBe('function');
    expect(typeof jm.cancel).toBe('function');
  });

  it('isRunning(projectId) returns false when no job is in flight', () => {
    const jm = new JobManager(makeBridge());
    expect(jm.isRunning('proj-1')).toBe(false);
  });
});
