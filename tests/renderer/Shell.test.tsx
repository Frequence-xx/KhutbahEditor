// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Shell } from '../../src/screens/Shell';
import { useProjects } from '../../src/store/projects';
import { useUi } from '../../src/store/ui';
import { useToasts } from '../../src/store/toasts';

afterEach(() => {
  cleanup();
  useProjects.setState({ projects: [] });
  useUi.setState({ selectedProjectId: null, view: 'review' });
  useToasts.setState({ toasts: [] });
});

const ready = {
  id: 'p1',
  sourcePath: '/p1.mp4',
  duration: 200,
  createdAt: 1,
  runState: 'ready' as const,
  part1: { start: 10, end: 100, confidence: 0.95, outputPath: '/p1-out.mp4' },
  part2: { start: 110, end: 195, confidence: 0.95, outputPath: '/p2-out.mp4' },
};

describe('Shell', () => {
  beforeEach(() => {
    Object.assign(window, {
      khutbah: {
        auth: {
          listAccounts: vi.fn(() => Promise.resolve([])),
          accessToken: vi.fn(() => Promise.resolve({ accessToken: 'tok' })),
          signIn: vi.fn(() => Promise.resolve()),
          signOut: vi.fn(() => Promise.resolve()),
        },
        settings: {
          get: vi.fn(() => Promise.resolve({ computeDevice: 'auto', outputDir: '/o' })),
          set: vi.fn(() => Promise.resolve({ computeDevice: 'auto', outputDir: '/o' })),
        },
        pipeline: {
          call: vi.fn(() => Promise.resolve([])),
          onProgress: vi.fn(() => () => {}),
        },
        dialog: {
          openVideo: vi.fn(() => Promise.resolve(null)),
          openAudio: vi.fn(() => Promise.resolve(null)),
        },
      },
    });
  });

  it('with no project selected: shows EmptyState', () => {
    render(<Shell />);
    expect(screen.getAllByRole('button', { name: /new khutbah/i }).length).toBeGreaterThan(0);
  });

  it('with a ready project selected: shows ReviewPane', () => {
    useProjects.setState({ projects: [ready] });
    useUi.setState({ selectedProjectId: 'p1', view: 'review' });
    render(<Shell />);
    expect(screen.getByRole('tab', { name: /part 1/i })).toBeTruthy();
  });

  it('view=settings: shows SettingsPane', async () => {
    useProjects.setState({ projects: [ready] });
    useUi.setState({ selectedProjectId: 'p1', view: 'settings' });
    render(<Shell />);
    expect(await screen.findByLabelText(/compute device/i)).toBeTruthy();
  });

  it('view=upload: shows UploadPane', async () => {
    useProjects.setState({ projects: [ready] });
    useUi.setState({ selectedProjectId: 'p1', view: 'upload' });
    render(<Shell />);
    expect(await screen.findByText(/Upload to YouTube/i)).toBeTruthy();
  });

  it('clicking + New khutbah opens the modal', () => {
    render(<Shell />);
    // Multiple buttons match: sidebar's "+ New khutbah" + EmptyState's "+ New khutbah"
    fireEvent.click(screen.getAllByRole('button', { name: /\+ new khutbah/i })[0]);
    expect(screen.getByRole('tab', { name: /youtube/i })).toBeTruthy();
  });

  it('error state: shows ErrorPane with Retry', () => {
    useProjects.setState({ projects: [{ ...ready, runState: 'error', lastError: 'boom' }] });
    useUi.setState({ selectedProjectId: 'p1', view: 'review' });
    render(<Shell />);
    // "boom" appears in both the Sidebar status line and the ErrorPane body.
    expect(screen.getAllByText(/boom/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('detecting state: shows DetectingPane with progress', () => {
    useProjects.setState({ projects: [{ ...ready, runState: 'detecting', progress: 42 }] });
    useUi.setState({ selectedProjectId: 'p1', view: 'review' });
    render(<Shell />);
    // Sidebar renders "Detecting · 42%"; DetectingPane has its own progressbar.
    expect(screen.getAllByText(/42%/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });
});
