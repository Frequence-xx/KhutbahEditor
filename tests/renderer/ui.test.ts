import { describe, it, expect, beforeEach } from 'vitest';
import { useUi } from '../../src/store/ui';

describe('ui store', () => {
  beforeEach(() => {
    useUi.setState({ selectedProjectId: null, view: 'review' });
  });

  it('defaults: no project selected, view=review', () => {
    const s = useUi.getState();
    expect(s.selectedProjectId).toBeNull();
    expect(s.view).toBe('review');
  });

  it('select() sets selectedProjectId and resets view to review', () => {
    useUi.setState({ view: 'settings' });
    useUi.getState().select('proj-1');
    expect(useUi.getState().selectedProjectId).toBe('proj-1');
    expect(useUi.getState().view).toBe('review');
  });

  it('setView() changes view without clearing selectedProjectId', () => {
    useUi.getState().select('proj-1');
    useUi.getState().setView('settings');
    expect(useUi.getState().selectedProjectId).toBe('proj-1');
    expect(useUi.getState().view).toBe('settings');
  });

  it('clearSelection() resets selectedProjectId to null', () => {
    useUi.getState().select('proj-1');
    useUi.getState().clearSelection();
    expect(useUi.getState().selectedProjectId).toBeNull();
  });
});
