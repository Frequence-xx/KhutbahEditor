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
        if (videoRef.current) videoRef.current.currentTime = t;
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
    // Cap the preview at ~280px tall so the editor keeps the timeline +
    // export bar visible without scrolling. aspectRatio keeps width in
    // sync with the cap; mx-auto centers it in the column. Native HTML5
    // controls include a fullscreen button when the user does need a
    // bigger view.
    <div
      className="bg-black rounded-md relative border border-border-strong overflow-hidden mx-auto"
      style={{ aspectRatio: '16 / 9', maxHeight: '280px', maxWidth: '100%' }}
    >
      <video ref={videoRef} src={src} className="w-full h-full" controls preload="metadata" />
    </div>
  );
});
