"""Keyframe (I-frame) lookup via ffprobe.

Used by the smart-cut pipeline to snap requested cut points to nearest
keyframes — that's what makes stream-copy possible without re-encoding.
"""

from __future__ import annotations

import json
import subprocess
from typing import Optional


def list_keyframes(video_path: str) -> list[float]:
    """Return all keyframe timestamps in seconds, sorted ascending.

    ffprobe -skip_frame nokey -show_entries frame=pts_time -select_streams v
    enumerates only frames where pict_type=I (keyframes). Cost: a few seconds
    even for hour-long files (no decode, just packet header walk).
    """
    cmd = [
        "ffprobe",
        "-v", "error",
        "-skip_frame", "nokey",
        "-show_entries", "frame=pts_time",
        "-select_streams", "v:0",
        "-of", "json",
        video_path,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, check=True)
    data = json.loads(r.stdout)
    times: list[float] = []
    for f in data.get("frames", []):
        t = f.get("pts_time")
        if t is not None:
            try:
                times.append(float(t))
            except ValueError:
                continue
    times.sort()
    return times


def nearest_keyframe_at_or_before(keyframes: list[float], t: float) -> Optional[float]:
    """Largest keyframe <= t. Returns the first keyframe if t is before any."""
    best: Optional[float] = None
    for kt in keyframes:
        if kt > t:
            break
        best = kt
    if best is None and keyframes:
        return keyframes[0]
    return best


def nearest_keyframe_at_or_after(keyframes: list[float], t: float) -> Optional[float]:
    """Smallest keyframe >= t. Returns the last keyframe if t is past any."""
    for kt in keyframes:
        if kt >= t:
            return kt
    return keyframes[-1] if keyframes else None
