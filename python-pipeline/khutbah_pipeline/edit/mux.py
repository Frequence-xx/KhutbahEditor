import subprocess
from khutbah_pipeline.util.ffmpeg import FFMPEG


def apply_offset_and_mux(
    video_path: str,
    audio_path: str,
    offset_seconds: float,
    dst: str,
) -> None:
    """Mux video + offset-aligned audio, dropping the original camera audio.

    Convention from align_audio_arrays(sig=audio, ref=video):
    - positive offset_seconds: audio (sig) content lags ref (video) by N samples
      in the cross-correlation sense — meaning audio FILE has N seconds of
      content at the start before reaching the same position as video. To
      align: TRIM audio front by offset_seconds (use `-ss offset_seconds`).
    - negative offset_seconds: audio (sig) content leads ref (video) — meaning
      audio FILE starts AFTER video did, so audio's file-T=0 corresponds to
      a real-world time |offset_seconds|s into the video. To align: DELAY
      audio in the output by |offset_seconds|s (use `-itsoffset |offset_seconds|`).
    """
    args = [FFMPEG, "-y", "-i", video_path]
    if offset_seconds >= 0:
        # Audio file has offset_seconds of extra content at start; trim it.
        args += ["-ss", str(offset_seconds), "-i", audio_path]
    else:
        # Audio file is shorter at start; delay it in the output.
        args += ["-itsoffset", str(-offset_seconds), "-i", audio_path]
    args += [
        "-map", "0:v", "-map", "1:a",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        dst,
    ]
    subprocess.run(args, check=True, capture_output=True)
