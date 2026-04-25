import { useEffect, useState } from 'react';
import { useProjects } from '../store/projects';
import { useSettings } from '../store/settings';
import { Button } from '../components/ui/Button';
import { ProgressBar } from '../components/ui/ProgressBar';
import { ThumbnailPicker } from '../upload/ThumbnailPicker';
import { applyTemplate, langSuffix } from '../lib/templates';
import type { YouTubeAccount } from '../../electron/auth/accounts';

type Props = { projectId: string; onBack: () => void };

type PartUpload = {
  title: string;
  description: string;
  tags: string[];
  visibility: 'public' | 'unlisted' | 'private';
  madeForKids: boolean;
  thumbs: string[];
  thumbIdx: number;
  uploading: boolean;
  videoId?: string;
  progress: number;
  error?: string;
};

export function Upload({ projectId, onBack }: Props) {
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId));
  const updateProject = useProjects((s) => s.update);
  const settings = useSettings((s) => s.settings);
  const loadSettings = useSettings((s) => s.load);
  const [accounts, setAccounts] = useState<YouTubeAccount[]>([]);
  const [parts, setParts] = useState<{ p1: PartUpload; p2: PartUpload } | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
    if (window.khutbah) {
      window.khutbah.auth.listAccounts().then(setAccounts);
    }
  }, [loadSettings]);

  // Initialize per-part upload state from templates + extract thumbnails
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

        // Per spec: Part 1 always Arabic. Part 2 lang inferred from the project
        // (Phase 4 will read from detection result; for Phase 3 default to nl
        // if khutbah is multilingual).
        const lang1 = 'ar';
        const lang2 = 'nl';

        const mkPart = (n: 1 | 2, lang: string, thumbs: string[]): PartUpload => {
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
            uploading: false,
            progress: 0,
          };
        };

        setParts({
          p1: mkPart(1, lang1, t1.paths),
          p2: mkPart(2, lang2, t2.paths),
        });
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = e && typeof e === 'object' && 'message' in e
            ? String((e as { message: unknown }).message)
            : String(e);
          setSignInError(`Failed to extract thumbnails: ${msg}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project?.id, project?.part1?.outputPath, project?.part2?.outputPath, settings]);

  async function uploadOne(which: 'p1' | 'p2'): Promise<void> {
    if (!parts || !project || !window.khutbah || !settings || accounts.length === 0) return;
    const filePart = which === 'p1' ? project.part1! : project.part2!;
    const meta = parts[which];
    setParts((p) => p && ({
      ...p,
      [which]: { ...p[which], uploading: true, progress: 0, error: undefined },
    }));
    try {
      // Phase 3: upload to the FIRST signed-in account.
      // Phase 4 will iterate over all auto-publish accounts.
      const account = accounts[0];
      const { accessToken } = await window.khutbah.auth.accessToken(account.channelId);
      const r = await window.khutbah.pipeline.call<{ video_id: string }>('upload.video', {
        access_token: accessToken,
        file_path: filePart.outputPath,
        title: meta.title,
        description: meta.description,
        tags: meta.tags,
        category_id: settings.defaultCategoryId,
        privacy_status: meta.visibility,
        self_declared_made_for_kids: meta.madeForKids,
        default_audio_language: which === 'p1' ? 'ar' : 'nl',
      });
      // Set thumbnail
      if (meta.thumbs[meta.thumbIdx]) {
        await window.khutbah.pipeline.call('upload.thumbnail', {
          access_token: accessToken,
          video_id: r.video_id,
          thumbnail_path: meta.thumbs[meta.thumbIdx],
        });
      }
      setParts((p) => p && ({
        ...p,
        [which]: { ...p[which], uploading: false, progress: 100, videoId: r.video_id },
      }));
      updateProject(project.id, {
        [which === 'p1' ? 'part1' : 'part2']: {
          ...filePart,
          videoId: r.video_id,
        },
        status: 'uploaded',
      });
    } catch (e: unknown) {
      const msg = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : String(e);
      setParts((p) => p && ({
        ...p,
        [which]: { ...p[which], uploading: false, error: msg },
      }));
    }
  }

  if (!project || !settings || !parts) {
    return <div className="p-8 text-text-muted">Preparing upload…</div>;
  }
  if (accounts.length === 0) {
    return (
      <div className="flex-1 p-8">
        <div className="max-w-md mx-auto">
          <Button variant="ghost" onClick={onBack} className="mb-4">← Back</Button>
          <h2 className="font-display text-xl tracking-wider text-text-strong mb-2">
            SIGN IN TO UPLOAD
          </h2>
          <p className="text-text-muted text-sm mb-4">
            Sign in with Google to upload to YouTube. Your refresh token is stored
            in your OS keychain — never sent to any third-party server.
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
              } catch (e: unknown) {
                const msg = e && typeof e === 'object' && 'message' in e
                  ? String((e as { message: unknown }).message)
                  : String(e);
                setSignInError(msg);
              }
            }}
          >
            Sign in with Google
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" onClick={onBack}>← Back</Button>
          <h2 className="font-display text-2xl tracking-wider text-text-strong">UPLOAD TO YOUTUBE</h2>
          <span className="ml-auto text-text-muted text-sm" aria-label="signed in account">
            {accounts[0].channelTitle}
          </span>
          <Button
            variant="ghost"
            onClick={async () => {
              if (!window.khutbah) return;
              if (!confirm(`Sign out of ${accounts[0].channelTitle}?`)) return;
              await window.khutbah.auth.signOut(accounts[0].channelId);
              const list = await window.khutbah.auth.listAccounts();
              setAccounts(list);
            }}
          >
            Sign out
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-6">
          {(['p1', 'p2'] as const).map((k) => {
            const m = parts[k];
            return (
              <div key={k} className="bg-bg-2 border border-border-strong rounded-lg p-4 space-y-3">
                <div className="font-arabic text-text-strong" dir="rtl" lang="ar">
                  {k === 'p1' ? 'الخطبة الأولى' : 'الخطبة الثانية'}
                </div>
                <input
                  className="w-full bg-bg-0 border border-border-strong rounded p-2 text-text-strong text-sm font-semibold"
                  value={m.title}
                  onChange={(e) =>
                    setParts((p) => p && ({ ...p, [k]: { ...p[k], title: e.target.value } }))
                  }
                  aria-label={`Title for part ${k === 'p1' ? '1' : '2'}`}
                />
                <textarea
                  rows={5}
                  className="w-full bg-bg-0 border border-border-strong rounded p-2 text-text text-sm"
                  value={m.description}
                  onChange={(e) =>
                    setParts((p) => p && ({ ...p, [k]: { ...p[k], description: e.target.value } }))
                  }
                  aria-label={`Description for part ${k === 'p1' ? '1' : '2'}`}
                />
                <ThumbnailPicker
                  paths={m.thumbs}
                  selectedIdx={m.thumbIdx}
                  onSelect={(i) =>
                    setParts((p) => p && ({ ...p, [k]: { ...p[k], thumbIdx: i } }))
                  }
                />
                <div className="flex gap-2 text-xs">
                  {(['public', 'unlisted', 'private'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() =>
                        setParts((p) => p && ({ ...p, [k]: { ...p[k], visibility: v } }))
                      }
                      className={`flex-1 px-2 py-1 rounded ${
                        m.visibility === v
                          ? 'bg-amber/15 text-amber border border-amber'
                          : 'bg-bg-0 border border-border-strong text-text-muted'
                      }`}
                      aria-pressed={m.visibility === v}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs text-text-muted">
                  <input
                    type="checkbox"
                    checked={m.madeForKids}
                    onChange={(e) =>
                      setParts((p) =>
                        p && ({ ...p, [k]: { ...p[k], madeForKids: e.target.checked } }),
                      )
                    }
                  />
                  Made for kids (COPPA)
                </label>
                {m.error && <div className="text-danger text-xs">{m.error}</div>}
                {m.uploading && <ProgressBar value={m.progress} label="Uploading…" />}
                {m.videoId && (
                  <div className="text-green text-xs">
                    ✓ Uploaded ·{' '}
                    <a
                      href={`https://youtube.com/watch?v=${m.videoId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      View
                    </a>
                  </div>
                )}
                {!m.videoId && (
                  <Button variant="upload" onClick={() => uploadOne(k)} disabled={m.uploading}>
                    ↑ Upload
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
