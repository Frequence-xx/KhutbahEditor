// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { UploadPane } from '../../src/components/UploadPane';

afterEach(cleanup);

const project = {
  id: 'p1',
  sourcePath: '/s.mp4',
  duration: 200,
  createdAt: 1,
  runState: 'ready' as const,
  part1: { start: 10, end: 100, confidence: 0.95, outputPath: '/p1.mp4' },
  part2: { start: 110, end: 195, confidence: 0.95, outputPath: '/p2.mp4' },
};

describe('UploadPane', () => {
  beforeEach(() => {
    Object.assign(window, {
      khutbah: {
        auth: {
          listAccounts: vi.fn(() =>
            Promise.resolve([
              { channelId: 'ch-1', channelTitle: 'Frequence', autoPublish: true },
            ]),
          ),
          accessToken: vi.fn(() => Promise.resolve({ accessToken: 'tkn' })),
        },
        pipeline: {
          call: vi.fn((method: string) => {
            if (method === 'playlists.list') return Promise.resolve([]);
            return Promise.reject(new Error('unexpected ' + method));
          }),
        },
        dialog: {
          openVideo: vi.fn(() => Promise.resolve(null)),
          openAudio: vi.fn(() => Promise.resolve(null)),
        },
      },
    });
  });

  it('pre-fills the title input from project name', async () => {
    render(<UploadPane project={project} projectName="Iziyi" onStart={() => {}} />);
    const input = await screen.findByDisplayValue(/Iziyi/);
    expect(input).toBeTruthy();
  });

  it('renders the account by channelTitle', async () => {
    render(<UploadPane project={project} projectName="Iziyi" onStart={() => {}} />);
    await screen.findByText(/Frequence/);
  });

  it('clicking Upload calls onStart with channelId, title, playlistId, thumbnailPath', async () => {
    const onStart = vi.fn();
    render(<UploadPane project={project} projectName="Iziyi" onStart={onStart} />);
    await waitFor(() => {
      expect(
        (screen.getByRole('button', { name: /upload/i }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: /upload/i }));
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'ch-1',
        title: expect.stringContaining('Iziyi'),
      }),
    );
  });

  it('disables the Upload button while project.runState is uploading', async () => {
    render(
      <UploadPane
        project={{ ...project, runState: 'uploading' }}
        projectName="Iziyi"
        onStart={() => {}}
      />,
    );
    const btn = await screen.findByRole('button', { name: /upload/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
