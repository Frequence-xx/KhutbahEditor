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


def _distribute_probe_starts(
    ranges: list[tuple[float, float]],
    n_per_range: int = 3,
    probe_duration: float = 6.0,
) -> list[float]:
    """Distribute probe start times evenly within each (start, end) range.

    Skips ranges too short to fit `probe_duration` plus margins. Margins
    of `probe_duration/2` at each end keep probes inside the range.
    """
    starts: list[float] = []
    margin = max(4.0, probe_duration / 2)
    for r_start, r_end in ranges:
        duration = r_end - r_start
        if duration < probe_duration + 2 * margin:
            continue
        inner = duration - 2 * margin - probe_duration
        if n_per_range == 1:
            starts.append(r_start + duration / 2 - probe_duration / 2)
        else:
            for i in range(n_per_range):
                starts.append(r_start + margin + inner * i / max(1, n_per_range - 1))
    return starts


def compute_source_av_offset(
    src: str,
    ranges: list[tuple[float, float]],
    n_probes_per_range: int = 3,
    probe_duration: float = 6.0,
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> int:
    """Compute one A/V sync offset for the whole source.

    Probes SyncNet across N windows distributed within each speaking
    range (typically Part 1 + Part 2), pools the results, returns the
    consensus offset. Same source = same offset (encoder, container,
    A/V pipeline don't drift mid-recording) — running per-cut
    auto-detect added needless variance and gave Part 2 a different
    offset from Part 1 on real sources.

    Returns 0 if SyncNet is unavailable or no consensus emerges.
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

    starts = _distribute_probe_starts(ranges, n_probes_per_range, probe_duration)
    if not starts:
        return 0

    samples: list[dict[str, Any]] = []
    n_total = len(starts)
    for i, t in enumerate(starts):
        if progress_cb:
            progress_cb({
                "stage": "av_offset",
                "message": f"Source-wide A/V probe {i+1}/{n_total}...",
                "progress": (i + 1) / max(1, n_total),
            })
        try:
            r = syncnet_offset(src, probe_start=t, probe_duration=probe_duration)
        except Exception:
            continue
        if r:
            samples.append(r)

    consensus = _syncnet_consensus(samples)
    return int(consensus) if consensus is not None else 0


def _syncnet_consensus(
    samples: list[dict[str, Any]],
    min_confidence: float = SYNCNET_MIN_CONFIDENCE,
    min_consensus: int = 2,
) -> Optional[int]:
    """Return the median offset_ms across confident samples, or None.

    Single-probe SyncNet is unreliable: a window where the camera is on
    the audience or wide-shot returns low confidence and we silently
    fall back to 0 ms — masking a real source-wide offset that other
    windows agree on. Multi-window consensus surfaces the offset that
    *most confident probes* report.

    None means "auto-detect failed, caller should not silently apply 0":
    the caller can decide whether to leave the source unmodified or
    surface a 'needs manual offset' signal.
    """
    confident = [s for s in samples if s["confidence"] >= min_confidence]
    if len(confident) < min_consensus:
        return None
    sorted_offsets = sorted(int(s["offset_ms"]) for s in confident)
    return sorted_offsets[len(sorted_offsets) // 2]


def _detect_av_offset(
    src: str,
    snap_start: float,
    snap_end: float,
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
    n_probes: int = 5,
    probe_duration: float = 6.0,
) -> int:
    """Probe SyncNet across N windows for the audio-leads-video offset.

    Returns 0 if SyncNet is unavailable or no consensus emerges.
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

    duration = snap_end - snap_start
    if duration < probe_duration * 2:
        # Cut too short for multi-window — fall back to a single mid-cut probe
        n_probes = 1

    margin = max(4.0, probe_duration / 2)
    inner = max(0.0, duration - 2 * margin)
    if inner <= 0:
        return 0

    samples: list[dict[str, Any]] = []
    for i in range(n_probes):
        if n_probes == 1:
            t = snap_start + duration / 2 - probe_duration / 2
        else:
            t = snap_start + margin + inner * i / max(1, n_probes - 1)
        if progress_cb:
            progress_cb({
                "stage": "export",
                "message": f"Detecting A/V sync offset (SyncNet probe {i+1}/{n_probes})...",
                "progress": 0.02 + 0.04 * (i + 1) / n_probes,
            })
        try:
            r = syncnet_offset(src, probe_start=t, probe_duration=probe_duration)
        except Exception:
            continue
        if r:
            samples.append(r)

    consensus = _syncnet_consensus(samples)
    return int(consensus) if consensus is not None else 0


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
    start_snap: str = "before",
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    """Cut [start, end] from src into dst.

    audio_offset_ms:
      None  - auto-detect via SyncNet (default; ~5 s probe overhead)
      0     - no shift (fastest; assumes source has no drift)
      N>0   - shift audio N ms earlier in source-time to compensate
              for "audio leads video by N ms" content drift

    start_snap:
      "before" - default, keyframe at-or-before `start`. Use for Part 1
                 cuts where rolling back captures the imam's first frame.
      "after"  - keyframe at-or-after `start`. Use for Part 2 cuts where
                 the requested start sits at a sit-down silence end and
                 rolling back would include silence in the cut.

    Returns dict with the offset that was actually applied, the snap
    boundaries, and the audio gain. Useful for the renderer to display
    "applied X ms sync correction".
    """
    keyframes = list_keyframes(src)
    if not keyframes:
        raise RuntimeError(f"no keyframes found in {src}")
    if start_snap == "after":
        snap_start = nearest_keyframe_at_or_after(keyframes, start)
    elif start_snap == "before":
        snap_start = nearest_keyframe_at_or_before(keyframes, start)
    else:
        raise ValueError(f"start_snap must be 'before' or 'after', got {start_snap!r}")
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
