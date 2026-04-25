import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';

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
};

export const VideoPreview = forwardRef<VideoHandle, Props>(function VideoPreview(
  { src, onTimeUpdate, onLoadedMetadata, onPlayingChange },
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
  // without this the user gets jerked back to t=0 mid-scrub.
  const lastTimeRef = useRef<number>(0);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onSeek = () => {
      lastTimeRef.current = v.currentTime;
    };
    v.addEventListener('timeupdate', onSeek);
    return () => v.removeEventListener('timeupdate', onSeek);
  }, []);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // After the new src loads its metadata, restore the time we had before.
    const onMeta = () => {
      if (lastTimeRef.current > 0) {
        v.currentTime = Math.min(lastTimeRef.current, v.duration || lastTimeRef.current);
      }
    };
    v.addEventListener('loadedmetadata', onMeta);
    return () => v.removeEventListener('loadedmetadata', onMeta);
  }, [src]);

  return (
    // 16:9 aspect tied to the column width so the preview grows when the
    // user drags the resize handle to widen the player column. object-contain
    // letterboxes/pillarboxes for non-16:9 sources rather than cropping —
    // the right call for editing where frame accuracy matters.
    <div className="bg-black rounded-md relative border border-border-strong overflow-hidden w-full aspect-video">
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-contain"
        controls
        preload="metadata"
      />
    </div>
  );
});
