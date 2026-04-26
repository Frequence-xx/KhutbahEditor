"""Headless end-to-end orchestrator: input → publish-ready files.

The auto-pilot's single entry point. Composes ingest → detect → smart_cut
both parts → thumbnails into one call so the renderer doesn't have to
orchestrate. Returns a dict with all paths, confidences, and a
needs_review flag derived from the auto-pilot threshold.

Per the 2026-04-26 product direction: editor opens *only* when
needs_review is True. Most sources should pass the threshold and never
require manual intervention.
"""
from __future__ import annotations

import os
import time
from typing import Any, Callable, Optional

from khutbah_pipeline.detect.pipeline import run_detection_pipeline
from khutbah_pipeline.edit.smartcut import smart_cut, compute_source_av_offset
from khutbah_pipeline.edit.thumbnail import extract_candidates


def _is_url(s: str) -> bool:
    return s.startswith("http://") or s.startswith("https://")


def run_full(
    input_path: str,
    output_dir: str,
    whisper_model_dir: str,
    device: str = "auto",
    target_lufs: float = -14.0,
    audio_offset_ms: Optional[int] = None,
    thumbnail_count: int = 6,
    auto_pilot_threshold: float = 0.90,
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    """Run the full pipeline on a single source.

    `input_path` is either a YouTube URL (downloaded via yt-dlp into
    `output_dir`) or a local file path. `audio_offset_ms=None` triggers
    SyncNet auto-detection per smart_cut's contract.

    Returns a dict with input metadata, detect result, per-part cut
    results, thumbnail paths, overall confidence, and needs_review:bool.
    needs_review=True means the auto-pilot must NOT publish — open the
    editor for human review.
    """
    total_t0 = time.time()
    os.makedirs(output_dir, exist_ok=True)

    if _is_url(input_path):
        from khutbah_pipeline.ingest.youtube import download
        local_path = download(input_path, output_dir, progress_cb=progress_cb)
    else:
        if not os.path.exists(input_path):
            raise FileNotFoundError(input_path)
        local_path = input_path

    result: dict[str, Any] = {
        "input": {"path": local_path, "is_url": _is_url(input_path), "source": input_path},
        "detect": {},
        "parts": [],
        "thumbnails": [],
        "overall_confidence": 0.0,
        "needs_review": True,
        "wall_seconds": 0.0,
    }

    detect_t0 = time.time()
    try:
        det = run_detection_pipeline(
            local_path, whisper_model_dir, device=device, progress_cb=progress_cb
        )
    except Exception as e:
        result["detect"] = {
            "wall_seconds": round(time.time() - detect_t0, 2),
            "result": {"error": "detect_raised", "message": str(e)},
        }
        result["wall_seconds"] = round(time.time() - total_t0, 2)
        return result

    result["detect"] = {
        "wall_seconds": round(time.time() - detect_t0, 2),
        "result": det,
    }

    if "error" in det:
        result["wall_seconds"] = round(time.time() - total_t0, 2)
        return result

    overall = float(det.get("overall_confidence", 0.0))
    result["overall_confidence"] = overall
    result["needs_review"] = overall < auto_pilot_threshold

    # Compute one A/V offset for the whole source. Same recording = same
    # encoder pipeline = same offset throughout — running per-cut probes
    # gave Part 1 and Part 2 different offsets on real sources because
    # SyncNet's per-window confidence varies, and that variance bled into
    # the cuts as different sync corrections.
    if audio_offset_ms is None:
        ranges: list[tuple[float, float]] = []
        for name in ("part1", "part2"):
            part = det.get(name)
            if part:
                ranges.append((float(part["start"]), float(part["end"])))
        if ranges:
            audio_offset_ms = compute_source_av_offset(
                local_path, ranges, progress_cb=progress_cb,
            )
            result["source_av_offset_ms"] = audio_offset_ms

    for name in ("part1", "part2"):
        part = det.get(name)
        if not part:
            continue
        dst = os.path.join(output_dir, f"{name}.mp4")
        # Part 2 cuts start at sit-down silence end — snap to keyframe
        # at-or-after so the cut lands on the imam's content, not on
        # tail-end silence from the rollback.
        start_snap = "after" if name == "part2" else "before"
        cut_t0 = time.time()
        try:
            cut = smart_cut(
                local_path, dst,
                float(part["start"]), float(part["end"]),
                normalize_audio=True,
                target_lufs=target_lufs,
                audio_offset_ms=audio_offset_ms,
                start_snap=start_snap,
                progress_cb=progress_cb,
            )
            size_mb = os.path.getsize(dst) / 1e6 if os.path.exists(dst) else None
            result["parts"].append({
                "name": name,
                "path": dst,
                "size_mb": round(size_mb, 2) if size_mb else None,
                "wall_seconds": round(time.time() - cut_t0, 2),
                "result": cut,
            })
        except Exception as e:
            result["parts"].append({
                "name": name,
                "path": None,
                "wall_seconds": round(time.time() - cut_t0, 2),
                "error": str(e),
            })
            result["needs_review"] = True

    thumbs_dir = os.path.join(output_dir, "thumbnails")
    os.makedirs(thumbs_dir, exist_ok=True)
    try:
        result["thumbnails"] = extract_candidates(
            local_path, thumbs_dir, count=thumbnail_count
        )
    except Exception as e:
        result["thumbnails"] = []
        result["thumbnail_error"] = str(e)

    result["wall_seconds"] = round(time.time() - total_t0, 2)
    return result
