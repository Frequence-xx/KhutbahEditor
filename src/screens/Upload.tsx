import { useEffect, useState } from 'react';
import { useProjects } from '../store/projects';
import { useSettings } from '../store/settings';
import { Button } from '../components/ui/Button';
import { ProgressBar } from '../components/ui/ProgressBar';
import { ThumbnailPicker } from '../upload/ThumbnailPicker';
import { applyTemplate, langSuffix } from '../lib/templates';
import type { YouTubeAccount } from '../../electron/auth/accounts';
import type { AppSettings } from '../../electron/store';

type Props = { projectId: string; onBack: () => void };

type Visibility = 'public' | 'unlisted' | 'private';

type CellState = {
  uploading: boolean;
  progress: number;
  videoId?: string;
  error?: string;
};

type SharedPartMeta = {
  title: string;
  description: string;
  tags: string[];
  visibility: Visibility;
  madeForKids: boolean;
  thumbs: string[];
  thumbIdx: number;
};

type PerAccountPartMeta = SharedPartMeta & {
  playlist: string; // user-typed name or PL… ID; resolved at upload time
};

type PartKey = 'p1' | 'p2';
type CellKey = `${string}::${PartKey}`; // `${channelId}::p1` or p2

function effectiveTpl(base: string, override?: string): string {
  return override?.trim() ? override : base;
}
function effectiveTags(base: string[], override?: string[]): string[] {
  return override && override.length > 0 ? override : base;
}
function effectiveVisibility(base: Visibility, override?: Visibility): Visibility {
  return override ?? base;
}

export function Upload({ projectId, onBack }: Props) {
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId));
  const updateProject = useProjects((s) => s.update);
  const settings = useSettings((s) => s.settings);
  const loadSettings = useSettings((s) => s.load);

  const [accounts, setAccounts] = useState<YouTubeAccount[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customizePerAccount, setCustomizePerAccount] = useState<boolean>(false);

  const [shared, setShared] = useState<{ p1: SharedPartMeta; p2: SharedPartMeta } | null>(null);
  // Per-account metadata: keyed by channelId; only populated when customizePerAccount is ON
  const [perAccount, setPerAccount] = useState<
    Record<string, { p1: PerAccountPartMeta; p2: PerAccountPartMeta }>
  >({});

  const [cells, setCells] = useState<Record<CellKey, CellState>>({});
  const [signInError, setSignInError] = useState<string | null>(null);

  // Load settings + accounts on mount
  useEffect(() => {
    void loadSettings();
    if (window.khutbah) {
      window.khutbah.auth.listAccounts().then((list) => {
        setAccounts(list);
        // Default selection: only accounts with autoPublish:true. If the user
        // hasn't enabled autoPublish on any account, start with an empty
        // selection — they must explicitly pick which account(s) to publish to.
        // (Falling back to list[0] would publish to an account the user opted
        // out of via Settings → Accounts → autoPublish OFF.)
        const auto = list.filter((a) => a.autoPublish).map((a) => a.channelId);
        setSelected(new Set(auto));
      });
    }
  }, [loadSettings]);

  // Initialize shared metadata when project + settings + thumbnails are ready
  useEffect(() => {
    if (
      !window.khutbah ||
      !project ||
      !settings ||
      !project.part1?.outputPath ||
      !project.part2?.outputPath
    ) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const date = new Date(project.createdAt).toISOString().slice(0, 10);
        const thumbsDir1 = project.part1!.outputPath! + '.thumbs';
        const thumbsDir2 = project.part2!.outputPath! + '.thumbs';
        const t1 = await window.khutbah!.pipeline.call<{ paths: string[] }>(
          'edit.thumbnails',
          { src: project.part1!.outputPath, output_dir: thumbsDir1, count: 6 },
        );
        const t2 = await window.khutbah!.pipeline.call<{ paths: string[] }>(
          'edit.thumbnails',
          { src: project.part2!.outputPath, output_dir: thumbsDir2, count: 6 },
        );
        if (cancelled) return;

        const lang1 = 'ar';
        const lang2 = project.part2?.transcript ? 'nl' : 'nl'; // Phase 4 detection sets this

        const mkShared = (n: 1 | 2, lang: string, thumbs: string[]): SharedPartMeta => {
          const vars = {
            date,
            n,
            lang_suffix: langSuffix(lang),
            khatib: settings.khatibName,
            other_part_link: '',
          };
          return {
            title: applyTemplate(settings.titleTemplate, vars),
            description: applyTemplate(settings.descriptionTemplate, vars),
            tags: [
              ...settings.defaultTags,
              lang === 'ar' ? 'arabisch' : lang === 'nl' ? 'nederlands' : 'english',
            ],
            visibility: settings.defaultVisibility,
            madeForKids: settings.defaultMadeForKids,
            thumbs,
            thumbIdx: Math.min(2, Math.max(0, thumbs.length - 1)),
          };
        };

        setShared({
          p1: mkShared(1, lang1, t1.paths),
          p2: mkShared(2, lang2, t2.paths),
        });
      } catch (e) {
        if (!cancelled) setSignInError(`Failed to extract thumbnails: ${formatErr(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project?.id, project?.part1?.outputPath, project?.part2?.outputPath, settings]);

  // When "Customize per account" toggles on, seed perAccount from shared + account overrides
  useEffect(() => {
    if (!customizePerAccount || !shared || !settings || !project) {
      return;
    }
    const seeded: Record<string, { p1: PerAccountPartMeta; p2: PerAccountPartMeta }> = {};
    for (const a of accounts) {
      if (!selected.has(a.channelId)) continue;
      seeded[a.channelId] = {
        p1: makePerAccountFromAccount(shared.p1, a, 1, project, settings),
        p2: makePerAccountFromAccount(shared.p2, a, 2, project, settings),
      };
    }
    setPerAccount((prev) => ({ ...seeded, ...prev })); // preserve existing edits
  }, [customizePerAccount, shared, accounts, selected, settings, project]);

  function toggleSelected(channelId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  }

  function getMetaForCell(
    channelId: string,
    part: PartKey,
  ): PerAccountPartMeta | SharedPartMeta {
    if (customizePerAccount && perAccount[channelId]) {
      return perAccount[channelId][part];
    }
    return shared![part];
  }

  async function uploadAll() {
    if (!project || !window.khutbah || !settings || !shared) return;

    const targets = accounts.filter((a) => selected.has(a.channelId));
    if (targets.length === 0) {
      alert('Select at least one account');
      return;
    }

    // Spin up each cell
    const initialCells: Record<CellKey, CellState> = {};
    for (const a of targets) {
      for (const part of ['p1', 'p2'] as PartKey[]) {
        initialCells[`${a.channelId}::${part}` as CellKey] = {
          uploading: true,
          progress: 0,
        };
      }
    }
    setCells(initialCells);

    // Per-account, per-part loop
    await Promise.all(
      targets.map(async (account) => {
        let accessToken: string;
        try {
          const tk = await window.khutbah!.auth.accessToken(account.channelId);
          accessToken = tk.accessToken;
        } catch (e) {
          // Fail both parts for this account
          setCells((prev) => ({
            ...prev,
            [`${account.channelId}::p1` as CellKey]: {
              uploading: false,
              progress: 0,
              error: `auth: ${formatErr(e)}`,
            },
            [`${account.channelId}::p2` as CellKey]: {
              uploading: false,
              progress: 0,
              error: `auth: ${formatErr(e)}`,
            },
          }));
          return;
        }

        for (const part of ['p1', 'p2'] as PartKey[]) {
          const cellKey: CellKey = `${account.channelId}::${part}` as CellKey;
          const partFile = part === 'p1' ? project.part1! : project.part2!;
          const meta = getMetaForCell(account.channelId, part);
          const lang = part === 'p1' ? 'ar' : 'nl';

          try {
            const r = await window.khutbah!.pipeline.call<{ video_id: string }>(
              'upload.video',
              {
                access_token: accessToken,
                file_path: partFile.outputPath,
                title: meta.title,
                description: meta.description,
                tags: meta.tags,
                category_id: settings.defaultCategoryId,
                privacy_status: meta.visibility,
                self_declared_made_for_kids: meta.madeForKids,
                default_audio_language: lang,
              },
            );

            // Set thumbnail — non-fatal on failure
            if (meta.thumbs[meta.thumbIdx]) {
              try {
                await window.khutbah!.pipeline.call('upload.thumbnail', {
                  access_token: accessToken,
                  video_id: r.video_id,
                  thumbnail_path: meta.thumbs[meta.thumbIdx],
                });
              } catch {
                // Non-fatal — video uploaded, thumbnail failed.
              }
            }

            // Per-account playlist (if customize-per-account is ON and a playlist is set)
            // OR account's default playlist.
            const playlistName =
              customizePerAccount && perAccount[account.channelId]
                ? perAccount[account.channelId][part].playlist
                : (account.defaultPlaylistName ?? account.defaultPlaylistId ?? '');
            if (playlistName.trim()) {
              try {
                const resolved = await window.khutbah!.pipeline.call<{
                  playlist_id: string | null;
                }>('playlists.resolve_or_create', {
                  access_token: accessToken,
                  name_or_id: playlistName.trim(),
                  auto_create: settings.autoCreateMissingPlaylists,
                  visibility: 'unlisted',
                });
                if (resolved.playlist_id) {
                  await window.khutbah!.pipeline.call('playlists.add_video', {
                    access_token: accessToken,
                    playlist_id: resolved.playlist_id,
                    video_id: r.video_id,
                  });
                }
              } catch {
                // Non-fatal — video uploaded, playlist add failed.
              }
            }

            setCells((prev) => ({
              ...prev,
              [cellKey]: { uploading: false, progress: 100, videoId: r.video_id },
            }));
          } catch (e) {
            setCells((prev) => ({
              ...prev,
              [cellKey]: { uploading: false, progress: 0, error: formatErr(e) },
            }));
          }
        }
      }),
    );

    // Update project status — read the latest cells state after all promises resolve
    setCells((finalCells) => {
      const allDone = Object.values(finalCells).every((c) => c.videoId);
      updateProject(project.id, { status: allDone ? 'uploaded' : 'failed' });
      return finalCells;
    });
  }

  if (!project || !settings || !shared)
    return <div className="p-8 text-text-muted">Preparing upload…</div>;
  if (accounts.length === 0) {
    return (
      <div className="flex-1 p-8">
        <div className="max-w-md mx-auto">
          <Button variant="ghost" onClick={onBack} className="mb-4">
            ← Back
          </Button>
          <h2 className="font-display text-xl tracking-wider text-text-strong mb-2">
            SIGN IN TO UPLOAD
          </h2>
          <p className="text-text-muted text-sm mb-4">
            Sign in with Google to upload to YouTube. Your refresh token is stored in your OS
            keychain — never sent to any third-party server.
          </p>
          {signInError && <div className="text-danger text-sm mb-3">{signInError}</div>}
          <Button
            variant="upload"
            onClick={async () => {
              if (!window.khutbah) return;
              try {
                await window.khutbah.auth.signIn();
                const list = await window.khutbah.auth.listAccounts();
                setAccounts(list);
                setSelected(
                  new Set(list.filter((a) => a.autoPublish).map((a) => a.channelId)),
                );
              } catch (e) {
                setSignInError(formatErr(e));
              }
            }}
          >
            Sign in with Google
          </Button>
        </div>
      </div>
    );
  }

  const selectedAccounts = accounts.filter((a) => selected.has(a.channelId));
  const anyUploading = Object.values(cells).some((c) => c.uploading);
  const allComplete =
    Object.values(cells).length > 0 && Object.values(cells).every((c) => !c.uploading);

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={onBack}>
            ← Back
          </Button>
          <h2 className="font-display text-2xl tracking-wider text-text-strong">
            UPLOAD TO YOUTUBE
          </h2>
        </div>

        {/* Account selector chips */}
        <div>
          <div className="text-text-muted uppercase tracking-wider text-xs font-bold mb-2">
            Accounts
          </div>
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <button
                key={a.channelId}
                onClick={() => toggleSelected(a.channelId)}
                className={`px-3 py-1.5 rounded-full text-sm flex items-center gap-2 ${
                  selected.has(a.channelId)
                    ? 'bg-amber/15 text-amber border border-amber'
                    : 'bg-bg-3 text-text-muted border border-border-strong hover:text-text'
                }`}
                aria-pressed={selected.has(a.channelId)}
              >
                {a.thumbnailUrl && (
                  <img src={a.thumbnailUrl} alt="" className="w-5 h-5 rounded-full" />
                )}
                {a.channelTitle}
              </button>
            ))}
          </div>
        </div>

        {/* Customize-per-account toggle */}
        <label className="flex items-center gap-2 text-sm text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={customizePerAccount}
            onChange={(e) => setCustomizePerAccount(e.target.checked)}
          />
          Customize metadata per account
        </label>

        {/* Metadata forms */}
        {customizePerAccount ? (
          <PerAccountForms
            selectedAccounts={selectedAccounts}
            perAccount={perAccount}
            setPerAccount={setPerAccount}
          />
        ) : (
          <SharedForms shared={shared} setShared={setShared} />
        )}

        {/* Upload progress matrix */}
        <UploadMatrix selectedAccounts={selectedAccounts} cells={cells} />

        <div className="flex justify-end gap-3">
          {!anyUploading && !allComplete && (
            <Button
              variant="upload"
              onClick={uploadAll}
              disabled={selectedAccounts.length === 0}
            >
              ↑ Upload to {selectedAccounts.length} account
              {selectedAccounts.length === 1 ? '' : 's'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function makePerAccountFromAccount(
  base: SharedPartMeta,
  account: YouTubeAccount,
  partN: 1 | 2,
  project: { createdAt: number },
  settings: AppSettings,
): PerAccountPartMeta {
  const date = new Date(project.createdAt).toISOString().slice(0, 10);
  const lang = partN === 1 ? 'ar' : 'nl';
  const vars = {
    date,
    n: partN,
    lang_suffix: langSuffix(lang),
    khatib: settings.khatibName,
    other_part_link: '',
  };
  const titleTpl = effectiveTpl(settings.titleTemplate, account.titleTemplateOverride);
  const descTpl = effectiveTpl(settings.descriptionTemplate, account.descriptionTemplateOverride);
  const tags = effectiveTags(settings.defaultTags, account.tagsOverride);
  const visibility = effectiveVisibility(settings.defaultVisibility, account.defaultVisibilityOverride);
  return {
    ...base,
    title: applyTemplate(titleTpl, vars),
    description: applyTemplate(descTpl, vars),
    tags,
    visibility,
    playlist: account.defaultPlaylistName ?? account.defaultPlaylistId ?? '',
  };
}

function SharedForms({
  shared,
  setShared,
}: {
  shared: { p1: SharedPartMeta; p2: SharedPartMeta };
  setShared: React.Dispatch<
    React.SetStateAction<{ p1: SharedPartMeta; p2: SharedPartMeta } | null>
  >;
}) {
  return (
    <div className="grid grid-cols-2 gap-6">
      {(['p1', 'p2'] as const).map((k) => {
        const m = shared[k];
        return (
          <PartFormCard
            key={k}
            partKey={k}
            meta={m}
            onChange={(patch) =>
              setShared((s) => s && { ...s, [k]: { ...s[k], ...patch } })
            }
            showPlaylist={false}
          />
        );
      })}
    </div>
  );
}

function PerAccountForms({
  selectedAccounts,
  perAccount,
  setPerAccount,
}: {
  selectedAccounts: YouTubeAccount[];
  perAccount: Record<string, { p1: PerAccountPartMeta; p2: PerAccountPartMeta }>;
  setPerAccount: React.Dispatch<
    React.SetStateAction<Record<string, { p1: PerAccountPartMeta; p2: PerAccountPartMeta }>>
  >;
}) {
  return (
    <div className="space-y-6">
      {selectedAccounts.map((a) => {
        const meta = perAccount[a.channelId];
        if (!meta) return null;
        return (
          <div
            key={a.channelId}
            className="bg-bg-2 border border-border-strong rounded-lg p-4 space-y-4"
          >
            <div className="flex items-center gap-2">
              {a.thumbnailUrl && (
                <img src={a.thumbnailUrl} alt="" className="w-6 h-6 rounded-full" />
              )}
              <span className="font-display text-text-strong tracking-wider">
                {a.channelTitle}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {(['p1', 'p2'] as const).map((k) => (
                <PartFormCard
                  key={k}
                  partKey={k}
                  meta={meta[k]}
                  onChange={(patch) =>
                    setPerAccount((prev) => ({
                      ...prev,
                      [a.channelId]: {
                        ...prev[a.channelId],
                        [k]: { ...prev[a.channelId][k], ...patch },
                      },
                    }))
                  }
                  showPlaylist
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PartFormCard({
  partKey,
  meta,
  onChange,
  showPlaylist,
}: {
  partKey: PartKey;
  meta: SharedPartMeta | PerAccountPartMeta;
  onChange: (patch: Partial<SharedPartMeta & PerAccountPartMeta>) => void;
  showPlaylist: boolean;
}) {
  return (
    <div className="bg-bg-3 border border-border-strong rounded p-3 space-y-3">
      <div className="font-arabic text-text-strong" dir="rtl" lang="ar">
        {partKey === 'p1' ? 'الخطبة الأولى' : 'الخطبة الثانية'}
      </div>
      <input
        className="w-full bg-bg-0 border border-border-strong rounded p-2 text-text-strong text-sm font-semibold"
        value={meta.title}
        onChange={(e) => onChange({ title: e.target.value })}
        aria-label={`Title for part ${partKey === 'p1' ? '1' : '2'}`}
      />
      <textarea
        rows={5}
        className="w-full bg-bg-0 border border-border-strong rounded p-2 text-text text-sm"
        value={meta.description}
        onChange={(e) => onChange({ description: e.target.value })}
        aria-label={`Description for part ${partKey === 'p1' ? '1' : '2'}`}
      />
      <ThumbnailPicker
        paths={meta.thumbs}
        selectedIdx={meta.thumbIdx}
        onSelect={(i) => onChange({ thumbIdx: i })}
      />
      <div className="flex gap-2 text-xs">
        {(['public', 'unlisted', 'private'] as const).map((v) => (
          <button
            key={v}
            onClick={() => onChange({ visibility: v })}
            className={`flex-1 px-2 py-1 rounded ${
              meta.visibility === v
                ? 'bg-amber/15 text-amber border border-amber'
                : 'bg-bg-0 border border-border-strong text-text-muted'
            }`}
            aria-pressed={meta.visibility === v}
          >
            {v}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-text-muted">
        <input
          type="checkbox"
          checked={meta.madeForKids}
          onChange={(e) => onChange({ madeForKids: e.target.checked })}
        />
        Made for kids (COPPA)
      </label>
      {showPlaylist && 'playlist' in meta && (
        <div>
          <label className="block text-xs text-text-muted mb-1">
            Playlist (name or PL… ID)
          </label>
          <input
            className="w-full bg-bg-0 border border-border-strong rounded p-2 text-text text-sm"
            value={(meta as PerAccountPartMeta).playlist}
            onChange={(e) => onChange({ playlist: e.target.value })}
            placeholder="e.g. Vrijdagkhutbah 2026"
          />
        </div>
      )}
    </div>
  );
}

function UploadMatrix({
  selectedAccounts,
  cells,
}: {
  selectedAccounts: YouTubeAccount[];
  cells: Record<CellKey, CellState>;
}) {
  if (selectedAccounts.length === 0 || Object.keys(cells).length === 0) return null;
  return (
    <div>
      <div className="text-text-muted uppercase tracking-wider text-xs font-bold mb-2">
        Progress
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left text-text-muted py-2 pr-2">Part</th>
              {selectedAccounts.map((a) => (
                <th key={a.channelId} className="text-left text-text-muted py-2 px-2">
                  {a.channelTitle}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(['p1', 'p2'] as const).map((part) => (
              <tr key={part}>
                <td className="py-2 pr-2 text-text-strong">
                  {part === 'p1' ? 'Part 1' : 'Part 2'}
                </td>
                {selectedAccounts.map((a) => {
                  const cell = cells[`${a.channelId}::${part}` as CellKey];
                  return (
                    <td key={a.channelId} className="py-2 px-2 align-top">
                      {!cell ? (
                        <span className="text-text-muted">—</span>
                      ) : cell.error ? (
                        <span className="text-danger">✕ {cell.error.slice(0, 60)}</span>
                      ) : cell.videoId ? (
                        <a
                          href={`https://youtube.com/watch?v=${cell.videoId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-green underline"
                        >
                          ✓ View
                        </a>
                      ) : cell.uploading ? (
                        <ProgressBar value={cell.progress} />
                      ) : (
                        <span className="text-text-muted">queued</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatErr(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e)
    return String((e as { message: unknown }).message);
  return String(e);
}
