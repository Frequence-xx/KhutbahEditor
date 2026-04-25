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

  return (
    <div className="bg-black rounded-md aspect-video relative border border-border-strong overflow-hidden">
      <video ref={videoRef} src={src} className="w-full h-full" controls preload="metadata" />
    </div>
  );
});
