import subprocess
from khutbah_pipeline.util.ffmpeg import FFMPEG
from khutbah_pipeline.edit.loudnorm import measure_loudness, build_loudnorm_filter


def smart_cut(
    src: str,
    dst: str,
    start: float,
    end: float,
    normalize_audio: bool = True,
    target_lufs: float = -14.0,
    target_tp: float = -1.0,
    target_lra: float = 11.0,
) -> None:
    """Cut [start, end] from src into dst. If normalize_audio, apply EBU R128.

    Two-pass loudnorm: measure the SAME segment that will be exported, then
    apply during the cut. Critical: measuring the full source and applying to
    a trimmed segment produces wrong loudness when source loudness varies.
    """
    duration = end - start
    audio_filter: list[str] = []
    if normalize_audio:
        measured = measure_loudness(src, start=start, end=end)
        audio_filter = ["-af", build_loudnorm_filter(measured, target_lufs, target_tp, target_lra)]

    cmd = [
        FFMPEG, "-y", "-ss", str(start), "-t", str(duration), "-i", src,
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p",
    ] + audio_filter + [
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-movflags", "+faststart",
        "-async", "1", "-vsync", "cfr",
        dst,
    ]
    subprocess.run(cmd, check=True, capture_output=True)
