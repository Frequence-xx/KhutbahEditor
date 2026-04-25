import subprocess
from khutbah_pipeline.util.ffmpeg import FFMPEG


def apply_offset_and_mux(
    video_path: str,
    audio_path: str,
    offset_seconds: float,
    dst: str,
) -> None:
    """Mux video + offset-shifted audio, dropping the original camera audio.

    Positive offset_seconds: external audio LAGS the video; pad the audio's
    front by offset_seconds (FFmpeg `-itsoffset <offset>`).

    Negative offset_seconds: external audio LEADS the video; trim the front
    of the audio by abs(offset_seconds) (FFmpeg `-ss <abs(offset)>` on the
    audio input).
    """
    args = [FFMPEG, "-y", "-i", video_path]
    if offset_seconds >= 0:
        args += ["-itsoffset", str(offset_seconds), "-i", audio_path]
    else:
        args += ["-ss", str(-offset_seconds), "-i", audio_path]
    args += [
        "-map", "0:v", "-map", "1:a",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        dst,
    ]
    subprocess.run(args, check=True, capture_output=True)
