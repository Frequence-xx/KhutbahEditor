import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the global window.khutbah API surface used by autopilot.
function setupKhutbahMock(opts: {
  detection?: object;
  accounts: Array<{ channelId: string; autoPublish: boolean; channelTitle: string }>;
  accessTokenBehavior: Record<string, () => unknown>;
  uploadVideoBehavior?: () => unknown;
}) {
  const settingsLoaded = {
    autoPilot: true,
    audioTargetLufs: -14,
    audioTargetTp: -1,
    audioTargetLra: 11,
    titleTemplate: 'Test {n}',
    descriptionTemplate: 'Test desc',
    defaultTags: ['t'],
    defaultVisibility: 'unlisted' as const,
    defaultMadeForKids: false,
    defaultCategoryId: '27',
    khatibName: '',
    silenceThresholdDb: -35,
    silenceMinDuration: 1.5,
    minPart1Duration: 300,
  };

  const ipcCall = vi.fn(async (method: string, _params?: object) => {
    if (method === 'detect.run') return opts.detection ?? {
      duration: 1500,
      part1: { start: 0, end: 700, confidence: 0.95, transcript_at_start: '' },
      part2: { start: 720, end: 1400, confidence: 0.95, transcript_at_end: '' },
      lang_dominant: 'ar',
      overall_confidence: 0.95,
    };
    if (method === 'edit.smart_cut') return { output: '/tmp/x.mp4' };
    if (method === 'upload.video') return opts.uploadVideoBehavior
      ? opts.uploadVideoBehavior()
      : { video_id: 'mockVideoId' };
    if (method === 'upload.thumbnail') return {};
    if (method === 'playlists.resolve_or_create') return { playlist_id: null };
    if (method === 'playlists.add_video') return {};
    if (method === 'edit.thumbnails') return { paths: [] };
    return undefined;
  });

  (globalThis as Record<string, unknown>).window = {
    khutbah: {
      paths: {
        defaultOutputDir: vi.fn(async () => '/tmp'),
        ensureDir: vi.fn(async (d: string) => d),
      },
      pipeline: { call: ipcCall },
      auth: {
        listAccounts: vi.fn(async () => opts.accounts),
        accessToken: vi.fn(async (channelId: string) => {
          const fn = opts.accessTokenBehavior[channelId];
          if (!fn) throw new Error(`No mock for ${channelId}`);
          const r = fn();
          if (r instanceof Error) throw r;
          return r as { accessToken: string; expiresAt: number };
        }),
      },
    },
  };

  return { ipcCall, settingsLoaded };
}

describe('runAutoPilot — auth failure isolation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('a single auth failure does not abort other accounts', async () => {
    const { settingsLoaded } = setupKhutbahMock({
      accounts: [
        { channelId: 'chA', autoPublish: true, channelTitle: 'Account A' },
        { channelId: 'chB', autoPublish: true, channelTitle: 'Account B' },
      ],
      accessTokenBehavior: {
        chA: () => new Error('invalid_grant'),  // fails
        chB: () => ({ accessToken: 'tokenB', expiresAt: Date.now() + 3600000 }),  // succeeds
      },
    });

    // Hydrate the settings store with our mock settings before importing autopilot.
    const { useSettings } = await import('../../src/store/settings');
    useSettings.setState({ settings: settingsLoaded as unknown as ReturnType<typeof useSettings.getState>['settings'] });

    const { runAutoPilot } = await import('../../src/lib/autopilot');
    const project = {
      id: 'p1',
      sourcePath: '/tmp/in.mp4',
      duration: 1500,
      createdAt: Date.now(),
      status: 'draft' as const,
    };
    const result = await runAutoPilot(project, () => undefined);

    // Account A should have errors; Account B should have succeeded
    expect(result.uploads).toBeDefined();
    expect(result.uploads!['chA'].errors).toContainEqual(expect.stringContaining('auth'));
    expect(result.uploads!['chB'].p1).toBe('mockVideoId');
    expect(result.uploads!['chB'].p2).toBe('mockVideoId');
    // Mode should be partial_failure (chA failed, chB succeeded)
    expect(result.mode).toBe('partial_failure');
  });
});
