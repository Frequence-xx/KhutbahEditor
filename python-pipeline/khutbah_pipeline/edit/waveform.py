import subprocess
from typing import Any, Callable, Optional

import numpy as np

from khutbah_pipeline.util.ffmpeg import FFMPEG, ffprobe_json


SAMPLE_RATE = 8000
EMIT_EVERY_N_BUCKETS = 30  # ~ 0.7s/30 min source — feels live without spamming


def _probe_duration(src: str) -> Optional[float]:
    try:
        meta = ffprobe_json(src)
        d = float(meta.get("format", {}).get("duration") or 0)
        return d if d > 0 else None
    except (subprocess.CalledProcessError, ValueError, KeyError):
        return None


def compute_waveform(
    src: str,
    peaks_count: int = 1500,
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    """Stream-decode an abs-max peak waveform from src.

    Without progress_cb this is a one-shot call that returns the final array.
    With progress_cb, emits the partial peaks list every ~30 buckets so the
    renderer can paint the audio lane progressively (Premiere/DaVinci-style)
    instead of staring at a blank lane while a 1h source decodes.

    Returns:
        {
            'peaks': list[float],   # 0..1 normalised abs-max per bucket
            'sample_rate': int,     # 8000
            'duration': float,      # seconds
        }
    """
    duration = _probe_duration(src)
    if duration is None or duration <= 0:
        # Fallback: probe failed — do a single-shot full decode so we still
        # produce a usable waveform, just without progressive paint.
        return _compute_waveform_oneshot(src, peaks_count)

    total_samples = int(duration * SAMPLE_RATE)
    bucket_size = max(1, total_samples // peaks_count)
    n_buckets = total_samples // bucket_size
    if n_buckets == 0:
        return {"peaks": [], "sample_rate": SAMPLE_RATE, "duration": duration}

    peaks: list[float] = [0.0] * n_buckets
    proc = subprocess.Popen(
        [
            FFMPEG, "-y", "-i", src,
            "-vn",
            "-ac", "1",
            "-ar", str(SAMPLE_RATE),
            "-f", "s16le",
            "-loglevel", "error",
            "pipe:1",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        if proc.stdout is None:
            raise RuntimeError("ffmpeg stdout unavailable")

        # Read in chunks aligned to whole buckets so we can process them
        # without keeping unbounded leftover state. 50 buckets per read keeps
        # the loop tight (~30 ticks total for a typical hour-long source).
        bytes_per_bucket = bucket_size * 2  # int16 = 2 bytes
        chunk_bytes = max(bytes_per_bucket * 50, 64 * 1024)

        bucket_idx = 0
        leftover = b""
        last_emit_idx = -EMIT_EVERY_N_BUCKETS

        while True:
            data = proc.stdout.read(chunk_bytes)
            if not data and not leftover:
                break
            buf = leftover + data
            n_complete_buckets = len(buf) // bytes_per_bucket
            if n_complete_buckets == 0 and not data:
                break
            if n_complete_buckets > 0:
                consumed = n_complete_buckets * bytes_per_bucket
                samples = np.frombuffer(buf[:consumed], dtype=np.int16)
                reshaped = samples.reshape(n_complete_buckets, bucket_size)
                new = np.abs(reshaped).max(axis=1).astype(np.float32) / 32768.0
                for v in new:
                    if bucket_idx < n_buckets:
                        peaks[bucket_idx] = float(v)
                    bucket_idx += 1
                leftover = buf[consumed:]
            else:
                leftover = buf

            if progress_cb and bucket_idx - last_emit_idx >= EMIT_EVERY_N_BUCKETS:
                last_emit_idx = bucket_idx
                progress_cb({
                    "stage": "waveform",
                    "message": "Decoding audio…",
                    "progress": min(1.0, bucket_idx / max(1, n_buckets)),
                    "peaks": list(peaks),
                })

        # Drain any final partial bucket so the tail of the audio doesn't
        # silently get a 0 peak (visible as a flat line at the right edge).
        if leftover and bucket_idx < n_buckets:
            samples = np.frombuffer(leftover, dtype=np.int16)
            if samples.size > 0:
                peaks[bucket_idx] = float(np.abs(samples).max() / 32768.0)
                bucket_idx += 1

        proc.wait()
        if proc.returncode != 0:
            stderr = proc.stderr.read().decode("utf-8", errors="replace") if proc.stderr else ""
            raise subprocess.CalledProcessError(proc.returncode, "ffmpeg", output=b"", stderr=stderr)
    finally:
        if proc.poll() is None:
            proc.kill()

    if progress_cb:
        progress_cb({
            "stage": "waveform",
            "message": "Audio decoded",
            "progress": 1.0,
            "peaks": list(peaks),
        })
    return {"peaks": peaks, "sample_rate": SAMPLE_RATE, "duration": duration}


def _compute_waveform_oneshot(src: str, peaks_count: int) -> dict[str, Any]:
    """Fallback used when ffprobe can't determine duration upfront."""
    proc = subprocess.run(
        [
            FFMPEG, "-y", "-i", src,
            "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE),
            "-f", "s16le", "-loglevel", "error", "pipe:1",
        ],
        capture_output=True,
        check=True,
    )
    samples = np.frombuffer(proc.stdout, dtype=np.int16)
    if samples.size == 0:
        return {"peaks": [], "sample_rate": SAMPLE_RATE, "duration": 0.0}
    duration = float(samples.size / SAMPLE_RATE)
    bucket_size = max(1, samples.size // peaks_count)
    n_buckets = samples.size // bucket_size
    truncated = samples[: n_buckets * bucket_size].reshape(n_buckets, bucket_size)
    peaks = (np.abs(truncated).max(axis=1).astype(np.float32) / 32768.0).tolist()
    return {"peaks": peaks, "sample_rate": SAMPLE_RATE, "duration": duration}
