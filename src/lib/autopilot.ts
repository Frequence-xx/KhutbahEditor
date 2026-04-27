import type { Part, PartUploadResult, Project } from '../store/projects';
import { useProjects } from '../store/projects';
import { useSettings } from '../store/settings';
import { applyTemplate, langSuffix } from './templates';
import type { YouTubeAccount } from '../../electron/auth/accounts';
import type { AppSettings } from '../../electron/store';

type DetectionResult =
  | {
      duration: number;
      part1: { start: number; end: number; confidence: number; transcript_at_start: string };
      part2: { start: number; end: number; confidence: number; transcript_at_end: string };
      lang_dominant: string;
      overall_confidence: number;
    }
  | { error: string; duration?: number };

export type AutoPilotStage =
  | 'detect'
  | 'export'
  | 'upload'
  | 'manual_review'   // confidence < 0.9
  | 'auto_complete'
  | 'partial_failure';

export type AutoPilotResult = {
  mode: AutoPilotStage;
  detection?: DetectionResult;
  uploads?: Record<string, { p1?: string; p2?: string; errors: string[] }>;  // by channelId
};

export type AutoPilotProgress = {
  stage: AutoPilotStage;
  message: string;
  progress?: number;  // 0-100
};

function effectiveTemplate(
  base: string,
  override: string | undefined,
): string {
  return override?.trim() ? override : base;
}

function effectiveTags(base: string[], override: string[] | undefined): string[] {
  return override && override.length > 0 ? override : base;
}

function effectiveVisibility(
  base: AppSettings['defaultVisibility'],
  override: AppSettings['defaultVisibility'] | undefined,
): AppSettings['defaultVisibility'] {
  return override ?? base;
}

export async function runAutoPilot(
  project: Project,
  onProgress: (p: AutoPilotProgress) => void,
): Promise<AutoPilotResult> {
  if (!window.khutbah) throw new Error('Electron API not available');

  const settings = useSettings.getState().settings;
  if (!settings) {
    throw new Error('Settings not loaded — auto-pilot requires settings.get to have completed');
  }

  // Subscribe to sidecar progress notifications for the duration of this run.
  // When smart_cut / transcribe emit progress in a future iteration, they'll
  // flow through here automatically without further wiring in the caller.
  let unsubscribeProgress: (() => void) | null = null;
  if (window.khutbah) {
    unsubscribeProgress = window.khutbah.pipeline.onProgress((params) => {
      if (typeof params.stage === 'string' && typeof params.message === 'string') {
        onProgress({
          stage: params.stage as AutoPilotStage,
          message: params.message,
          progress: typeof params.progress === 'number' ? Math.round(params.progress * 100) : undefined,
        });
      }
    });
  }

  try {
  // Stage 1: detection
  onProgress({ stage: 'detect', message: 'Detecting boundaries…', progress: 0 });
  const detection = await window.khutbah.pipeline.call<DetectionResult>(
    'detect.run',
    { audio_path: project.sourcePath },
  );
  if ('error' in detection) {
    return { mode: 'manual_review', detection };
  }

  if (detection.overall_confidence < 0.9) {
    onProgress({
      stage: 'manual_review',
      message: `Confidence ${Math.round(detection.overall_confidence * 100)}% — opening editor for manual review`,
    });
    return { mode: 'manual_review', detection };
  }

  // Stage 2: export both parts
  onProgress({ stage: 'export', message: 'Exporting parts…', progress: 0 });
  const dir = settings.outputDir ?? (await window.khutbah.paths.defaultOutputDir());
  await window.khutbah.paths.ensureDir(dir);
  const base = `${project.id}-${Date.now()}`;
  const p1Out = `${dir}/${base}-part-1.mp4`;
  const p2Out = `${dir}/${base}-part-2.mp4`;

  const audioParams = {
    target_lufs: settings.audioTargetLufs,
    target_tp: settings.audioTargetTp,
    target_lra: settings.audioTargetLra,
  };

  await window.khutbah.pipeline.call('edit.smart_cut', {
    src: project.sourcePath,
    dst: p1Out,
    start: detection.part1.start,
    end: detection.part1.end,
    normalize_audio: true,
    ...audioParams,
  });
  onProgress({ stage: 'export', message: 'Exporting parts…', progress: 50 });

  await window.khutbah.pipeline.call('edit.smart_cut', {
    src: project.sourcePath,
    dst: p2Out,
    start: detection.part2.start,
    end: detection.part2.end,
    normalize_audio: true,
    ...audioParams,
  });
  onProgress({ stage: 'export', message: 'Exporting parts…', progress: 100 });

  // After both parts are exported, extract thumbnails for each.
  onProgress({ stage: 'export', message: 'Extracting thumbnails…', progress: 100 });
  const thumbsDir1 = p1Out + '.thumbs';
  const thumbsDir2 = p2Out + '.thumbs';
  const t1 = await window.khutbah.pipeline.call<{ paths: string[] }>(
    'edit.thumbnails',
    { src: p1Out, output_dir: thumbsDir1, count: 6 },
  );
  const t2 = await window.khutbah.pipeline.call<{ paths: string[] }>(
    'edit.thumbnails',
    { src: p2Out, output_dir: thumbsDir2, count: 6 },
  );
  // Pick a sensible default thumb (3rd one, or first available).
  const thumbPath: Record<1 | 2, string | undefined> = {
    1: t1.paths[Math.min(2, t1.paths.length - 1)],
    2: t2.paths[Math.min(2, t2.paths.length - 1)],
  };

  // Stage 3: upload to every auto-publish account
  const allAccounts: YouTubeAccount[] = await window.khutbah.auth.listAccounts();
  const targets = allAccounts.filter((a) => a.autoPublish);

  if (targets.length === 0) {
    // Nothing to upload to — record export-only result and return.
    useProjects.getState().update(project.id, {
      runState: 'ready',
      part1: { start: detection.part1.start, end: detection.part1.end, outputPath: p1Out },
      part2: { start: detection.part2.start, end: detection.part2.end, outputPath: p2Out },
    });
    return { mode: 'auto_complete', detection, uploads: {} };
  }

  onProgress({ stage: 'upload', message: `Uploading to ${targets.length} account(s)…`, progress: 0 });

  // Render context for templates
  const date = new Date(project.createdAt).toISOString().slice(0, 10);
  const langs: Record<1 | 2, string> = { 1: 'ar', 2: detection.lang_dominant };

  const uploads: Record<string, { p1?: string; p2?: string; errors: string[] }> = {};
  const totalCells = targets.length * 2;
  let completedCells = 0;

  for (const account of targets) {
    uploads[account.channelId] = { errors: [] };

    let accessToken: string;
    try {
      const tk = await window.khutbah.auth.accessToken(account.channelId);
      accessToken = tk.accessToken;
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : String(e);
      uploads[account.channelId].errors.push(`auth: ${msg}`);
      completedCells += 2; // both parts couldn't even start
      onProgress({
        stage: 'upload',
        message: `Auth failed for ${account.channelTitle}; skipping`,
        progress: (completedCells / totalCells) * 100,
      });
      continue;
    }

    // Per-account effective config
    const titleTpl = effectiveTemplate(settings.titleTemplate, account.titleTemplateOverride);
    const descTpl = effectiveTemplate(settings.descriptionTemplate, account.descriptionTemplateOverride);
    const tags = effectiveTags(settings.defaultTags, account.tagsOverride);
    const visibility = effectiveVisibility(settings.defaultVisibility, account.defaultVisibilityOverride);

    for (const [n, out] of [
      [1 as const, p1Out],
      [2 as const, p2Out],
    ] as [1 | 2, string][]) {
      const lang = langs[n];
      const vars = {
        date,
        n,
        lang_suffix: langSuffix(lang),
        khatib: settings.khatibName,
        other_part_link: '',
      };
      try {
        const r = await window.khutbah.pipeline.call<{ video_id: string }>('upload.video', {
          access_token: accessToken,
          file_path: out,
          title: applyTemplate(titleTpl, vars),
          description: applyTemplate(descTpl, vars),
          tags: [...tags, lang === 'ar' ? 'arabic' : lang === 'nl' ? 'dutch' : 'english'],
          category_id: settings.defaultCategoryId,
          privacy_status: visibility,
          self_declared_made_for_kids: settings.defaultMadeForKids,
          default_audio_language: lang,
        });
        if (n === 1) uploads[account.channelId].p1 = r.video_id;
        else uploads[account.channelId].p2 = r.video_id;

        // Upload thumbnail if one was extracted — non-fatal on failure.
        if (thumbPath[n]) {
          try {
            await window.khutbah.pipeline.call('upload.thumbnail', {
              access_token: accessToken,
              video_id: r.video_id,
              thumbnail_path: thumbPath[n],
            });
          } catch (e) {
            // Thumbnail failure is non-fatal — log to errors but don't fail the upload.
            const msg = e && typeof e === 'object' && 'message' in e
              ? String((e as { message: unknown }).message)
              : String(e);
            uploads[account.channelId].errors.push(`thumbnail (part ${n}): ${msg}`);
          }
        }

        // Optional: add to default playlist for this account
        if (account.defaultPlaylistId || account.defaultPlaylistName) {
          try {
            const resolved = await window.khutbah.pipeline.call<{ playlist_id: string | null }>(
              'playlists.resolve_or_create',
              {
                access_token: accessToken,
                name_or_id: account.defaultPlaylistId ?? account.defaultPlaylistName,
                auto_create: settings.autoCreateMissingPlaylists,
                visibility: 'unlisted',
              },
            );
            if (resolved.playlist_id) {
              await window.khutbah.pipeline.call('playlists.add_video', {
                access_token: accessToken,
                playlist_id: resolved.playlist_id,
                video_id: r.video_id,
              });
            }
          } catch (e) {
            // Playlist failure is non-fatal — log and continue
            const msg = e && typeof e === 'object' && 'message' in e
              ? String((e as { message: unknown }).message)
              : String(e);
            uploads[account.channelId].errors.push(`playlist (part ${n}): ${msg}`);
          }
        }
      } catch (e) {
        const msg = e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : String(e);
        uploads[account.channelId].errors.push(`part ${n}: ${msg}`);
      }
      completedCells++;
      onProgress({
        stage: 'upload',
        message: `Uploaded ${completedCells}/${totalCells} cell(s)…`,
        progress: (completedCells / totalCells) * 100,
      });
    }
  }

  // Aggregate result + persist
  const anyFailures = Object.values(uploads).some((u) => u.errors.length > 0 || !u.p1 || !u.p2);
  const partialMode: AutoPilotStage = anyFailures ? 'partial_failure' : 'auto_complete';

  const part1Patch: Part = {
    start: detection.part1.start,
    end: detection.part1.end,
    confidence: detection.part1.confidence,
    transcript: detection.part1.transcript_at_start,
    outputPath: p1Out,
    uploads: Object.fromEntries(
      Object.entries(uploads).map(([ch, u]) => [
        ch,
        { videoId: u.p1, status: (u.p1 ? 'done' : 'failed') as PartUploadResult['status'], error: u.errors.find((e) => e.includes('part 1')) },
      ]),
    ),
  };
  const part2Patch: Part = {
    start: detection.part2.start,
    end: detection.part2.end,
    confidence: detection.part2.confidence,
    transcript: detection.part2.transcript_at_end,
    outputPath: p2Out,
    uploads: Object.fromEntries(
      Object.entries(uploads).map(([ch, u]) => [
        ch,
        { videoId: u.p2, status: (u.p2 ? 'done' : 'failed') as PartUploadResult['status'], error: u.errors.find((e) => e.includes('part 2')) },
      ]),
    ),
  };

  if (anyFailures) {
    // Persist parts first, then mark as errored so the error pane shows them.
    useProjects.getState().update(project.id, { part1: part1Patch, part2: part2Patch });
    const summary = Object.entries(uploads)
      .filter(([, u]) => u.errors.length > 0 || !u.p1 || !u.p2)
      .map(([ch, u]) => `${ch}: ${u.errors.join('; ') || 'incomplete upload'}`)
      .join(' | ');
    useProjects.getState().setError(project.id, summary || 'autopilot upload partial failure', 'upload');
  } else {
    useProjects.getState().update(project.id, {
      runState: 'uploaded',
      part1: part1Patch,
      part2: part2Patch,
    });
  }

  return { mode: partialMode, detection, uploads };
  } finally {
    unsubscribeProgress?.();
  }
}
