// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjects, type Project } from '../../src/store/projects';

const seed = (overrides = {}) => ({
  id: 'p1',
  sourcePath: '/tmp/src.mp4',
  duration: 120,
  createdAt: 1,
  runState: 'idle' as const,
  ...overrides,
});

describe('projects store — runState fields', () => {
  beforeEach(() => {
    useProjects.setState({ projects: [] });
  });

  it('add() persists a project with runState=idle by default', () => {
    useProjects.getState().add(seed());
    const p = useProjects.getState().projects[0];
    expect(p.runState).toBe('idle');
    expect(p.progress).toBeUndefined();
    expect(p.lastError).toBeUndefined();
    expect(p.thumbnailPath).toBeUndefined();
  });

  it('setRunState() updates only runState and clears progress', () => {
    useProjects.getState().add(seed({ runState: 'detecting', progress: 42 }));
    useProjects.getState().setRunState('p1', 'ready');
    const p = useProjects.getState().projects[0];
    expect(p.runState).toBe('ready');
    expect(p.progress).toBeUndefined();
  });

  it('setProgress() updates progress without changing runState', () => {
    useProjects.getState().add(seed({ runState: 'detecting' }));
    useProjects.getState().setProgress('p1', 73);
    const p = useProjects.getState().projects[0];
    expect(p.runState).toBe('detecting');
    expect(p.progress).toBe(73);
  });

  it('setError() sets runState=error and lastError; clears progress', () => {
    useProjects.getState().add(seed({ runState: 'detecting', progress: 50 }));
    useProjects.getState().setError('p1', 'sidecar crash');
    const p = useProjects.getState().projects[0];
    expect(p.runState).toBe('error');
    expect(p.lastError).toBe('sidecar crash');
    expect(p.progress).toBeUndefined();
  });

  it('setError() with kind sets lastFailedKind alongside the existing fields', () => {
    useProjects.getState().add(seed({ runState: 'detecting', progress: 50 }));
    useProjects.getState().setError('p1', 'sidecar crash', 'detect');
    const p = useProjects.getState().projects[0];
    expect(p.runState).toBe('error');
    expect(p.lastError).toBe('sidecar crash');
    expect(p.lastFailedKind).toBe('detect');
    expect(p.progress).toBeUndefined();
  });

  it('migration v1: legacy "draft" status maps to runState=idle', () => {
    const persisted = { state: { projects: [{ id: 'old', sourcePath: '/x', duration: 1, createdAt: 1, status: 'draft' }] }, version: 0 };
    const migrated = useProjects.persist.getOptions().migrate!(persisted.state, 0) as { projects: Project[] };
    expect(migrated.projects[0].runState).toBe('idle');
    expect((migrated.projects[0] as Project & { status?: string }).status).toBeUndefined();
  });

  it('migration v1: legacy "uploaded" status maps to runState=uploaded', () => {
    const persisted = { state: { projects: [{ id: 'old', sourcePath: '/x', duration: 1, createdAt: 1, status: 'uploaded' }] }, version: 0 };
    const migrated = useProjects.persist.getOptions().migrate!(persisted.state, 0) as { projects: Project[] };
    expect(migrated.projects[0].runState).toBe('uploaded');
  });
});
