"""Smart cut: keyframe-snapped video stream-copy + audio normalisation
+ automatic A/V offset correction via SyncNet.

Pipeline:
  1. Probe source keyframes; snap [start, end] to nearest keyframe
     boundaries (input-side -ss for fast seek).
  2. Auto-detect audio-leads-video offset using SyncNet on a probe
     window inside the cut range. Falls back to 0 ms if confidence
     is too low or the model isn't installed.
  3. Open source twice: video stream from snap_start, audio stream from
     (snap_start - offset/1000). When played simultaneously this puts
     audio source-content at (snap_start + T - offset/1000) alongside
     video source-content at (snap_start + T) — cancelling the source's
     baked-in A/V drift.
  4. If normalize_audio: replace loudnorm (multi-second buffer = drift)
     with volume=<gain>dB,alimiter=limit=<tp_lin>. Static gain to
     hit target LUFS, peak limiter to enforce TP. Sample-accurate.

Validated end-to-end on two ground-truth khutbah recordings: SyncNet
default beat human ear-tuning across 8 manual iterations.
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


# Confidence threshold below which we ignore SyncNet's estimate.
# Empirically: confidence > 1.5 = reliable lock; <1.0 = noisy probe.
SYNCNET_MIN_CONFIDENCE = 1.5


def _detect_av_offset(
    src: str,
    snap_start: float,
    snap_end: float,
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> int:
    """Probe SyncNet for the audio-leads-video offset in milliseconds.

    Returns 0 if SyncNet is unavailable or confidence is too low.
    """
    try:
        from khutbah_pipeline.util.syncnet_offset import (
            syncnet_offset, SYNCNET_MODEL_PATH,
        )
        import os
        if not os.path.exists(SYNCNET_MODEL_PATH):
            return 0
    except ImportError:
        return 0

    if progress_cb:
        progress_cb({
            "stage": "export",
            "message": "Detecting A/V sync offset (SyncNet)...",
            "progress": 0.02,
        })
    # Probe in the middle of the cut where speech is most reliable.
    duration = snap_end - snap_start
    probe_start = snap_start + max(4.0, duration / 2 - 4.0)
    probe_duration = min(8.0, max(4.0, duration - 8.0))
    if probe_duration < 4.0:
        return 0
    try:
        r = syncnet_offset(src, probe_start=probe_start, probe_duration=probe_duration)
    except Exception:
        return 0
    if not r or r["confidence"] < SYNCNET_MIN_CONFIDENCE:
        return 0
    return int(r["offset_ms"])


def smart_cut(
    src: str,
    dst: str,
    start: float,
    end: float,
    normalize_audio: bool = True,
    target_lufs: float = -14.0,
    target_tp: float = -1.0,
    target_lra: float = 11.0,
    audio_offset_ms: Optional[int] = None,
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    """Cut [start, end] from src into dst.

    audio_offset_ms:
      None  - auto-detect via SyncNet (default; ~5 s probe overhead)
      0     - no shift (fastest; assumes source has no drift)
      N>0   - shift audio N ms earlier in source-time to compensate
              for "audio leads video by N ms" content drift

    Returns dict with the offset that was actually applied, the snap
    boundaries, and the audio gain. Useful for the renderer to display
    "applied X ms sync correction".
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

    if audio_offset_ms is None:
        audio_offset_ms = _detect_av_offset(src, snap_start, snap_end, progress_cb)

    audio_seek = max(0.0, snap_start - audio_offset_ms / 1000.0)

    # Audio loudness for static gain (skip when not normalising)
    audio_filter: Optional[str] = None
    audio_gain_db = 0.0
    if normalize_audio:
        if progress_cb:
            progress_cb({
                "stage": "export",
                "message": f"Measuring audio loudness ({snap_duration:.0f}s)...",
                "progress": 0.10,
            })
        measured = measure_loudness(src, snap_start, snap_end)
        audio_filter = build_loudnorm_filter(measured, target_lufs, target_tp, target_lra)
        try:
            audio_gain_db = target_lufs - float(measured["input_i"])
        except Exception:
            audio_gain_db = 0.0

    if progress_cb:
        progress_cb({
            "stage": "export",
            "message": f"Cutting (offset {audio_offset_ms:+d} ms)...",
            "progress": 0.20,
        })

    cmd = [
        FFMPEG, "-y",
        "-ss", f"{snap_start:.3f}", "-i", src,
        "-ss", f"{audio_seek:.3f}", "-i", src,
        "-map", "0:v", "-map", "1:a",
        "-t", f"{snap_duration:.3f}",
        "-c:v", "copy",
    ]
    if audio_filter is not None:
        cmd += ["-af", audio_filter]
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
    else:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
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
                    max(0.20, min(1.0, 0.20 + 0.80 * done_s / snap_duration))
                    if snap_duration > 0
                    else 0.0
                )
                progress_cb({
                    "stage": "export",
                    "message": "Cutting...",
                    "progress": frac,
                })
            proc.wait()
            if proc.returncode != 0:
                stderr = proc.stderr.read() if proc.stderr else ""
                raise subprocess.CalledProcessError(
                    proc.returncode, cmd, output="", stderr=stderr,
                )
        finally:
            if proc.poll() is None:
                proc.kill()

    return {
        "snap_start": snap_start,
        "snap_end": snap_end,
        "audio_offset_ms": audio_offset_ms,
        "audio_gain_db": audio_gain_db,
    }
