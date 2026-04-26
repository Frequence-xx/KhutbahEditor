"""Smart cut: stream-copy video + re-encode audio (with loudnorm if requested).

The previous implementation re-encoded video at libx264 preset=medium CRF 18,
turning a "fast cut" into a 30-90 minute encode for a 30-min khutbah part.
The real smart cut snaps cuts to keyframes and stream-copies the video —
output is bit-identical to source for video; audio gets re-encoded only
because loudnorm requires decoding it (or because the source codec isn't AAC).

Boundary precision: ±1 GOP (~1-3 s on typical livestream encodes). For
khutbah cuts at sit-down silences this is invisible.
"""

from __future__ import annotations

import subprocess
from typing import Any, Callable, Optional

from khutbah_pipeline.edit.loudnorm import measure_loudness, build_loudnorm_filter
from khutbah_pipeline.util.ffmpeg import FFMPEG
from khutbah_pipeline.util.keyframes import (
    list_keyframes,
    nearest_keyframe_at_or_before,
    nearest_keyframe_at_or_after,
)


def smart_cut(
    src: str,
    dst: str,
    start: float,
    end: float,
    normalize_audio: bool = True,
    target_lufs: float = -14.0,
    target_tp: float = -1.0,
    target_lra: float = 11.0,
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> None:
    """Cut [start, end] from src into dst with keyframe-snapped stream-copy.

    The video bitstream is stream-copied — no re-encode. Audio is
    re-encoded to AAC (with EBU R128 loudnorm if normalize_audio=True)
    because that's required for loudnorm and ensures the output is
    universally playable.

    The cut boundaries are snapped to the nearest keyframes:
      - start  → largest keyframe <= start
      - end    → smallest keyframe >= end
    This means the actual output duration is >= (end - start) but never
    less. For khutbah cuts at sit-down silences (where the speaker is
    not talking) the ±1 GOP imprecision is invisible.

    Two-pass loudnorm: pass 1 measures the *snapped* segment so the
    target LUFS is correct for what actually lands in the output.

    Emits {"stage": "export", "message": str, "progress": float (0..1)}
    per FFmpeg progress tick when progress_cb is given.
    """
    keyframes = list_keyframes(src)
    if not keyframes:
        raise RuntimeError(f"no keyframes found in {src}")

    snap_start = nearest_keyframe_at_or_before(keyframes, start)
    snap_end = nearest_keyframe_at_or_after(keyframes, end)
    if snap_start is None or snap_end is None or snap_end <= snap_start:
        raise RuntimeError(
            f"keyframe snap failed: start={start} -> {snap_start}, "
            f"end={end} -> {snap_end}"
        )

    snap_duration = snap_end - snap_start

    audio_filter: Optional[str] = None
    if normalize_audio:
        if progress_cb:
            progress_cb({
                "stage": "export",
                "message": f"Loudnorm pass 1 ({snap_duration:.0f}s)…",
                "progress": 0.05,
            })
        measured = measure_loudness(src, snap_start, snap_end)
        audio_filter = build_loudnorm_filter(measured, target_lufs, target_tp, target_lra)

    if progress_cb:
        progress_cb({
            "stage": "export",
            "message": "Cutting (video stream-copy + audio re-encode)…",
            "progress": 0.15,
        })

    cmd = [
        FFMPEG, "-y",
        "-ss", f"{snap_start:.3f}", "-i", src,
        "-t", f"{snap_duration:.3f}",
        "-c:v", "copy",
    ]
    if audio_filter is not None:
        # aresample=async=1 keeps re-encoded audio locked to the
        # stream-copied video PTS — without it, video (which carries
        # source PTS from the keyframe) and audio (which the AAC
        # encoder restarts at PTS=0) drift apart by the input-seek
        # offset, producing 3-5 s lipsync error.
        cmd += ["-af", f"{audio_filter},aresample=async=1"]
    cmd += [
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",
    ]
    if progress_cb:
        cmd += ["-progress", "pipe:1", "-nostats"]
    cmd.append(dst)

    if not progress_cb:
        subprocess.run(cmd, check=True, capture_output=True)
        return

    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1,
    )
    try:
        if proc.stdout is None:
            raise RuntimeError("ffmpeg stdout unavailable")
        for line in proc.stdout:
            if not line.startswith("out_time_us="):
                continue
            try:
                out_us = int(line.split("=", 1)[1].strip())
            except ValueError:
                continue
            done_s = out_us / 1_000_000
            frac = (
                max(0.15, min(1.0, 0.15 + 0.85 * done_s / snap_duration))
                if snap_duration > 0
                else 0.0
            )
            progress_cb({
                "stage": "export",
                "message": "Cutting…",
                "progress": frac,
            })
        proc.wait()
        if proc.returncode != 0:
            stderr = proc.stderr.read() if proc.stderr else ""
            raise subprocess.CalledProcessError(proc.returncode, cmd, output="", stderr=stderr)
    finally:
        if proc.poll() is None:
            proc.kill()
