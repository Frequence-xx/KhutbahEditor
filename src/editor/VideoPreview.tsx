import { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react';

export type VideoHandle = {
  play: () => void;
  pause: () => void;
  seek: (t: number) => void;
  el: HTMLVideoElement | null;
};

type Props = {
  src: string;
  onTimeUpdate?: (t: number) => void;
  onLoadedMetadata?: (duration: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  onMediaError?: (code: number) => void;
};

export const VideoPreview = forwardRef<VideoHandle, Props>(function VideoPreview(
  { src, onTimeUpdate, onLoadedMetadata, onPlayingChange, onMediaError },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      play: () => videoRef.current?.play(),
      pause: () => videoRef.current?.pause(),
      seek: (t: number) => {
        const v = videoRef.current;
        if (!v) {
          console.log('[seek] no video ref');
          return;
        }
        // readyState semantics:
        //   0 = HAVE_NOTHING, 1 = HAVE_METADATA, 2 = HAVE_CURRENT_DATA,
        //   3 = HAVE_FUTURE_DATA, 4 = HAVE_ENOUGH_DATA
        // Setting currentTime requires ≥ HAVE_METADATA. Below that the
        // assignment is silently ignored — explains "click seems to do
        // nothing" when the timeline is clicked before the video has
        // loaded its metadata.
        const before = v.currentTime;
        if (v.readyState < 1) {
          console.log('[seek] video not ready, queuing', { t, readyState: v.readyState });
          const onReady = () => {
            v.removeEventListener('loadedmetadata', onReady);
            v.currentTime = t;
            console.log('[seek] applied after metadata loaded', { t, applied: v.currentTime });
          };
          v.addEventListener('loadedmetadata', onReady);
          return;
        }
        v.currentTime = t;
        console.log('[seek]', {
          requested: t,
          before,
          after: v.currentTime,
          duration: v.duration,
          readyState: v.readyState,
          src: v.currentSrc,
        });
      },
      el: videoRef.current,
    }),
    [],
  );

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => onTimeUpdate?.(v.currentTime);
    const onMeta = () => onLoadedMetadata?.(v.duration);
    const onPlay = () => onPlayingChange?.(true);
    const onPause = () => onPlayingChange?.(false);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onPause);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onPause);
    };
  }, [onTimeUpdate, onLoadedMetadata, onPlayingChange]);

  // Preserve playback position across src swaps. The Editor swaps from the
  // raw source to the scrub-friendly proxy as soon as proxy gen finishes;
  // without this the user gets jerked back to t=0 mid-scrub. We update
  // lastTimeRef on every timeupdate AND every seek so a click-then-swap
  // race always restores to the user's intended time, not whatever the
  // last timeupdate happened to land on.
  const lastTimeRef = useRef<number>(0);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const sync = () => {
      if (Number.isFinite(v.currentTime) && v.currentTime > 0) {
        lastTimeRef.current = v.currentTime;
      }
    };
    v.addEventListener('timeupdate', sync);
    v.addEventListener('seeked', sync);
    v.addEventListener('seeking', sync);
    return () => {
      v.removeEventListener('timeupdate', sync);
      v.removeEventListener('seeked', sync);
      v.removeEventListener('seeking', sync);
    };
  }, []);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onMeta = () => {
      if (lastTimeRef.current > 0) {
        v.currentTime = Math.min(lastTimeRef.current, v.duration || lastTimeRef.current);
        console.log('[video] restored time after src swap', {
          restored: v.currentTime, src: v.currentSrc,
        });
      }
    };
    v.addEventListener('loadedmetadata', onMeta);
    return () => v.removeEventListener('loadedmetadata', onMeta);
  }, [src]);

  // Surface video-element errors to the console + UI. A broken proxy file
  // (incomplete generation, missing keyframes) makes the video silently
  // ignore seeks and revert to t=0 — exactly the "seek goes back to
  // beginning" symptom. We log the MediaError code so we can tell whether
  // it's a network/decode/source error vs. just slow buffering.
  const [mediaError, setMediaError] = useState<string | null>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onError = () => {
      const err = v.error;
      const code = err?.code ?? 0;
      const msg = err
        ? `code=${code} (${
            code === 1 ? 'aborted'
            : code === 2 ? 'network'
            : code === 3 ? 'decode'
            : code === 4 ? 'src not supported'
            : 'unknown'
          })`
        : 'unknown';
      console.error('[video] error', { msg, src: v.currentSrc });
      setMediaError(msg);
      onMediaError?.(code);
    };
    v.addEventListener('error', onError);
    return () => v.removeEventListener('error', onError);
  }, [src]);
  // Reset the error when src changes — the user may be retrying with a
  // fresh proxy/source and we don't want a stale error sticking around.
  useEffect(() => { setMediaError(null); }, [src]);

  return (
    <div className="bg-black rounded-md relative border border-border-strong overflow-hidden w-full aspect-video">
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-contain"
        controls
        preload="metadata"
        onSeeking={(e) => {
          const v = e.currentTarget;
          console.log('[video] seeking', { currentTime: v.currentTime, readyState: v.readyState });
        }}
        onSeeked={(e) => {
          const v = e.currentTarget;
          console.log('[video] seeked', { currentTime: v.currentTime, readyState: v.readyState });
        }}
        onLoadStart={() => console.log('[video] loadstart', { src })}
        onCanPlay={(e) => console.log('[video] canplay', { duration: e.currentTarget.duration, readyState: e.currentTarget.readyState })}
      />
      {mediaError && (
        <div className="absolute bottom-2 left-2 right-2 px-2 py-1 bg-danger/90 text-white text-[10px] font-mono rounded">
          Video error ({mediaError}) — try ↻ Rebuild preview
        </div>
      )}
    </div>
  );
});
