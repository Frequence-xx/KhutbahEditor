"""Video filmstrip thumbnail extraction.

Progressive thumbnail extraction for the timeline. Premiere/DaVinci show
the video frames along the timeline track immediately on load — this
module provides the same affordance: a per-thumb subprocess seek-and-grab,
emitted via progress_cb as each one finishes so the renderer can paint
them in left-to-right while later thumbs are still extracting.

Sequential one-by-one (vs. a single ffmpeg fps-filter pass) is the right
trade-off here: we want each thumb to land on the renderer the moment
it's done, not all at the end. Per-thumb seek is fast on H.264 sources
(<150ms typical), so 30 thumbs land in ~3-5s total with the user seeing
the strip fill in continuously.
"""
import os
import subprocess
from typing import Any, Callable, Optional

from khutbah_pipeline.util.ffmpeg import FFMPEG, ffprobe_json


def _probe_duration(src: str) -> Optional[float]:
    try:
        meta = ffprobe_json(src)
        d = float(meta.get("format", {}).get("duration") or 0)
        return d if d > 0 else None
    except (subprocess.CalledProcessError, ValueError, KeyError):
        return None


def extract_filmstrip(
    src: str,
    output_dir: str,
    count: int = 30,
    width: int = 160,
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    """Extract `count` evenly-spaced thumbnails from src into output_dir.

    Each thumbnail is JPEG, scaled so the longer edge matches `width` while
    preserving aspect (16:9 → 160x90). The strip is emitted progressively
    via progress_cb so the renderer can render thumbs as they land.

    Returns:
        {
            'thumbs': [{'index': int, 'time': float, 'path': str}, ...],
            'duration': float,
        }
    """
    duration = _probe_duration(src)
    if duration is None or duration <= 0:
        return {"thumbs": [], "duration": 0.0}

    os.makedirs(output_dir, exist_ok=True)
    interval = duration / count
    thumbs: list[dict[str, Any]] = []

    for i in range(count):
        # Sample at the *middle* of each interval — gives a more
        # representative frame than t=0 (which is often a black
        # leader/title card on khutbah uploads).
        t = min(duration - 0.1, i * interval + interval / 2)
        thumb_path = os.path.join(output_dir, f"thumb_{i:03d}.jpg")
        cmd = [
            FFMPEG, "-y",
            # -ss before -i = fast seek to nearest keyframe (within ~2s).
            # That's perfectly fine for filmstrip purposes and 10-100×
            # faster than putting -ss after -i (decoder seek).
            "-ss", f"{t:.3f}",
            "-i", src,
            "-vframes", "1",
            "-vf", f"scale={width}:-2",
            "-q:v", "5",
            "-loglevel", "error",
            thumb_path,
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=15)
            thumbs.append({"index": i, "time": float(t), "path": thumb_path})
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            # Skip thumbs that fail (past EOF, corrupt segment, etc.) —
            # we still emit progress so the strip just has gaps where the
            # source couldn't produce a frame.
            continue

        if progress_cb:
            progress_cb({
                "stage": "filmstrip",
                "message": f"Extracting thumbs… {len(thumbs)}/{count}",
                "progress": (i + 1) / count,
                "thumbs": list(thumbs),
            })

    return {"thumbs": thumbs, "duration": duration}
