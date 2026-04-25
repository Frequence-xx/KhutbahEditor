"""Shot boundary detection via ffmpeg's scdet filter.

Streams scene-change scores out of ffmpeg, parses the stderr metadata, and
returns the timestamps where score crosses `threshold`. Much faster than
PySceneDetect (single ffmpeg pass, no Python decoding loop).
"""

from __future__ import annotations

import re
import subprocess
from typing import Any

from khutbah_pipeline.util.ffmpeg import FFMPEG


def detect_shot_boundaries(
    video_path: str,
    threshold: float = 10.0,
) -> list[dict[str, Any]]:
    """Run ffmpeg scdet and return [{time, score}, ...].

    threshold ∈ (0, 100]. ~10 catches obvious hard cuts; ~5 is jumpy;
    ~30 only catches major scene changes. Score is normalised to 0-1
    in the return value (ffmpeg emits 0-100 internally).
    """
    cmd = [
        FFMPEG, "-hide_banner", "-i", video_path,
        "-vf", f"scdet=t={threshold}",
        "-an", "-f", "null", "-",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(
            f"ffmpeg scdet failed (exit {r.returncode}): {r.stderr[-500:]}"
        )
    # scdet emits lines like:
    #   [scdet @ 0x...] lavfi.scd.score: 25.391, lavfi.scd.time: 90
    pattern = re.compile(
        r"lavfi\.scd\.score:\s*([\d.]+),\s*lavfi\.scd\.time:\s*([\d.]+)",
    )
    cuts: list[dict[str, Any]] = []
    for m in pattern.finditer(r.stderr):
        score = float(m.group(1)) / 100.0
        score = max(0.0, min(1.0, score))
        t = float(m.group(2))
        cuts.append({"time": t, "score": score})
    return cuts
