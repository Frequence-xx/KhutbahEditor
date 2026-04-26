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

    # Two-stage to keep A/V perfectly in sync:
    # Stage 1: stream-copy both video and audio into a temp file. This is
    #          near-instant (5-10s for a 10-min part) and produces output
    #          where video and audio packets share a clean PTS=0 origin.
    # Stage 2: apply loudnorm to the temp file, video stream-copied. Since
    #          the input is already cut and PTS-aligned, loudnorm's internal
    #          buffer latency manifests as a small uniform delay that
    #          aresample=async=1 compensates cleanly — no input-seek race.
    # This pattern eliminated the residual 400-600ms audio lead that the
    # single-pass approach left behind.
    import os, tempfile
    tmp_dir = tempfile.mkdtemp(prefix="khutbah-smartcut-")
    tmp_cut = os.path.join(tmp_dir, "cut.mp4")

    if progress_cb:
        progress_cb({
            "stage": "export",
            "message": "Stage 1/2: cutting (stream-copy both tracks)…",
            "progress": 0.20,
        })

    cut_cmd = [
        FFMPEG, "-y",
        "-ss", f"{snap_start:.3f}", "-i", src,
        "-t", f"{snap_duration:.3f}",
        "-c", "copy",
        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",
        tmp_cut,
    ]
    try:
        subprocess.run(cut_cmd, check=True, capture_output=True)

        if audio_filter is None:
            # No loudnorm requested — the temp cut IS the output. Move it.
            import shutil
            shutil.move(tmp_cut, dst)
            return

        if progress_cb:
            progress_cb({
                "stage": "export",
                "message": "Stage 2/2: applying loudnorm to audio…",
                "progress": 0.50,
            })

        norm_cmd = [
            FFMPEG, "-y", "-i", tmp_cut,
            "-c:v", "copy",
            "-af", f"{audio_filter},aresample=async=1:first_pts=0",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
            "-movflags", "+faststart",
        ]
        if progress_cb:
            norm_cmd += ["-progress", "pipe:1", "-nostats"]
        norm_cmd.append(dst)

        if not progress_cb:
            subprocess.run(norm_cmd, check=True, capture_output=True)
            return

        proc = subprocess.Popen(
            norm_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1,
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
                    max(0.50, min(1.0, 0.50 + 0.50 * done_s / snap_duration))
                    if snap_duration > 0
                    else 0.0
                )
                progress_cb({
                    "stage": "export",
                    "message": "Stage 2/2: loudnorm…",
                    "progress": frac,
                })
            proc.wait()
            if proc.returncode != 0:
                stderr = proc.stderr.read() if proc.stderr else ""
                raise subprocess.CalledProcessError(proc.returncode, norm_cmd, output="", stderr=stderr)
        finally:
            if proc.poll() is None:
                proc.kill()
    finally:
        import shutil
        shutil.rmtree(tmp_dir, ignore_errors=True)
