import { useEffect, useState } from 'react';
import { useProjects } from '../store/projects';
import { useMarkers } from '../editor/markersStore';
import { withETA, formatETA, type EnrichedProgress } from '../lib/eta';

type Stage = 'extract_audio' | 'transcribe' | 'detect_boundaries' | 'done';

type Props = {
  projectId: string;
  onDone: () => void;
  onError: (msg: string) => void;
};

type DetectionResult =
  | {
      duration: number;
      part1: { start: number; end: number; confidence: number; transcript_at_start: string };
      part2: { start: number; end: number; confidence: number; transcript_at_end: string };
      lang_dominant: string;
      overall_confidence: number;
    }
  | { error: string; duration?: number };

export function Processing({ projectId, onDone, onError }: Props) {
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId));
  const updateProject = useProjects((s) => s.update);
  const setMarker = useMarkers((s) => s.setMarker);
  const reset = useMarkers((s) => s.reset);
  const [stage, setStage] = useState<Stage>('extract_audio');
  const [progress, setProgress] = useState<EnrichedProgress | null>(null);

  useEffect(() => {
    if (!project || !window.khutbah) return;
    let cancelled = false;
    const unsubscribe = window.khutbah.pipeline.onProgress((params) => {
      if (cancelled) return;
      const p = {
        stage: typeof params.stage === 'string' ? params.stage : 'transcribe',
        message: typeof params.message === 'string' ? params.message : '',
        progress: typeof params.progress === 'number' ? Math.round(params.progress * 100) : undefined,
      };
      setProgress((prev) => withETA(prev, p));
      if (typeof params.stage === 'string') {
        if (params.stage === 'transcribe' || params.stage === 'extract_audio') {
          setStage(params.stage as Stage);
        } else if (params.stage === 'detect') {
          setStage('detect_boundaries');
        }
      }
    });
    (async () => {
      try {
        setStage('transcribe');
        const result = await window.khutbah!.pipeline.call<DetectionResult>(
          'detect.run',
          { audio_path: project.sourcePath },
        );
        if (cancelled) return;

        if ('error' in result) {
          if (result.error === 'opening_not_found') {
            onError('Could not find the opening phrase in this audio. Open the editor to mark Part 1 manually.');
            return;
          }
          if (result.error === 'sitting_silence_not_found') {
            onError('Could not detect a clear sitting silence. Open the editor to mark boundaries manually.');
            return;
          }
          onError(`Detection failed: ${result.error}`);
          return;
        }

        setStage('detect_boundaries');
        reset(result.duration);
        setMarker('p1Start', result.part1.start);
        setMarker('p1End', result.part1.end);
        setMarker('p2Start', result.part2.start);
        setMarker('p2End', result.part2.end);
        updateProject(project.id, {
          status: 'processed',
          part1: {
            start: result.part1.start,
            end: result.part1.end,
            confidence: result.part1.confidence,
            transcript: result.part1.transcript_at_start,
          },
          part2: {
            start: result.part2.start,
            end: result.part2.end,
            confidence: result.part2.confidence,
            transcript: result.part2.transcript_at_end,
          },
        });
        setStage('done');
        onDone();
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : String(e);
        onError(msg);
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [project?.id, project?.sourcePath, onDone, onError, reset, setMarker, updateProject]);

  const stages: { key: Stage; label: string }[] = [
    { key: 'extract_audio', label: 'Extracting audio' },
    { key: 'transcribe', label: 'Transcribing (Whisper large-v3)' },
    { key: 'detect_boundaries', label: 'Detecting boundaries' },
  ];
  const stageIdx = stages.findIndex((s) => s.key === stage);

  return (
    <div className="flex-1 p-8 flex items-center justify-center">
      <div className="max-w-md w-full bg-bg-2 border border-border-strong rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <h2 className="font-display text-xl tracking-wider text-text-strong">PROCESSING</h2>
          {progress?.progress !== undefined && (
            <span className="ml-auto text-text-muted text-sm font-mono">
              {Math.round(progress.progress)}%
              {progress.etaSeconds !== undefined && progress.etaSeconds > 0 && (
                <span className="ml-2 text-text-dim">· ~{formatETA(progress.etaSeconds)} left</span>
              )}
            </span>
          )}
        </div>
        {progress?.message && (
          <p className="text-text-dim text-sm mb-4 break-words">{progress.message}</p>
        )}
        <div className="h-1.5 bg-border-strong rounded overflow-hidden mb-4">
          {progress?.progress !== undefined ? (
            <div
              className="h-full bg-gradient-to-r from-amber to-amber-dark transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, progress.progress))}%` }}
            />
          ) : (
            <div
              className="h-full bg-gradient-to-r from-transparent via-amber to-transparent animate-pulse"
              style={{ width: '40%' }}
            />
          )}
        </div>
        <div className="space-y-3">
          {stages.map((s, i) => (
            <div key={s.key} className="flex items-center gap-3">
              <div
                className={`w-6 h-6 rounded-full border flex items-center justify-center text-xs ${
                  i < stageIdx
                    ? 'bg-green/20 border-green text-green'
                    : i === stageIdx
                    ? 'bg-amber/20 border-amber text-amber animate-pulse'
                    : 'bg-bg-3 border-border-strong text-text-muted'
                }`}
              >
                {i < stageIdx ? '✓' : i === stageIdx ? '⟳' : '·'}
              </div>
              <span className={i === stageIdx ? 'text-text-strong' : 'text-text-muted'}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
