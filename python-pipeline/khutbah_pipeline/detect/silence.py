import re
import subprocess
from typing import Any
from khutbah_pipeline.util.ffmpeg import FFMPEG


def detect_silences(
    audio_path: str,
    noise_db: float = -35.0,
    min_duration: float = 1.5,
) -> list[dict[str, Any]]:
    """Run ffmpeg silencedetect filter and parse silence_start/silence_end events.

    Returns a list of silence intervals: [{"start", "end", "duration"}, ...].
    Raises RuntimeError if FFmpeg fails (per CLAUDE.md no-silent-error rule).
    """
    cmd = [
        FFMPEG, "-hide_banner", "-i", audio_path,
        "-vn",                        # skip video decode entirely
        "-ac", "1", "-ar", "16000",   # downsample mono 16k — silencedetect doesn't need more
        "-af", f"silencedetect=noise={noise_db}dB:duration={min_duration}",
        "-f", "null", "-",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        # Surface the FFmpeg error rather than returning [] (which would be
        # indistinguishable from "no silences found").
        raise RuntimeError(
            f"ffmpeg silencedetect failed (exit {r.returncode}): "
            f"{r.stderr[-500:]}"
        )
    text = r.stderr
    starts = [float(m.group(1)) for m in re.finditer(r"silence_start: (\d+\.?\d*)", text)]
    ends = [float(m.group(1)) for m in re.finditer(r"silence_end: (\d+\.?\d*)", text)]
    durations = [float(m.group(1)) for m in re.finditer(r"silence_duration: (\d+\.?\d*)", text)]
    return [
        {"start": s, "end": e, "duration": d}
        for s, e, d in zip(starts, ends, durations)
    ]
