"""Automatic A/V offset detection via cross-correlation.

Why this exists
---------------
Many camera/encoder pipelines bake a fixed audio-vs-video offset into
the recording. Mic captures sound with ~zero latency; camera+encoder
adds 100-300ms of video latency. The offset shows up as "audio leads
video by N ms" lipsync error. ffprobe metadata reports the container
offset (usually 0-50ms) but NOT the content offset.

For one real-world khutbah recording (Lavf60.16.100, 60 fps H.264 +
44.1 kHz AAC) the empirically-measured content offset was 200 ms —
~12× larger than the 16 ms reported in `start_time`. Manually dialing
this in took 8 iterations between user and code; this module exists
so we can determine it once per source automatically.

Algorithm
---------
1. Decode a 30-60 s window of audio at 100 Hz (one sample per 10 ms)
   as RMS energy. Loud moments → high samples.
2. Decode the same window of video at the same 100 Hz, computing the
   per-frame magnitude of frame-to-frame difference. Big motion → high
   sample.
3. Cross-correlate the two signals over a search range of ±500 ms.
4. The lag with the highest correlation = the offset to apply: shift
   audio EARLIER by that amount (or, equivalently, read audio from
   source-time S - offset when video is at source-time S).

The probe runs in ~3-5 s on a 30 s window — cheap enough to do
automatically before every smart-cut.

Limitations
-----------
- Recordings with no clear lip-sync events in the chosen window (e.g.
  static camera + monotone speaker) produce flat correlations and a
  noisy estimate. The caller should accept the result only if the
  peak-to-noise ratio is high.
- Variable A/V drift (rare in MP4 livestreams; common in cheap
  webcams) won't be captured by a single offset value. For those the
  user must dial it in manually.
"""

from __future__ import annotations

import subprocess
from typing import Optional

import numpy as np

from khutbah_pipeline.util.ffmpeg import FFMPEG


SAMPLE_RATE_HZ = 100  # 10 ms per sample — enough for ±sub-frame accuracy


def _audio_envelope(src: str, start: float, duration: float) -> np.ndarray:
    """Return per-10ms RMS energy over the requested window."""
    proc = subprocess.run(
        [
            FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
            "-ss", f"{start:.3f}", "-i", src,
            "-t", f"{duration:.3f}",
            "-vn", "-ac", "1", "-ar", "16000",
            "-f", "s16le", "pipe:1",
        ],
        capture_output=True, check=True,
    )
    samples = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    if samples.size == 0:
        return np.zeros(0, dtype=np.float32)
    bucket = 16000 // SAMPLE_RATE_HZ  # 160 samples = 10 ms at 16 kHz
    n = samples.size // bucket
    if n == 0:
        return np.zeros(0, dtype=np.float32)
    truncated = samples[: n * bucket].reshape(n, bucket)
    return np.sqrt(np.mean(truncated * truncated, axis=1))


def _video_motion_envelope(src: str, start: float, duration: float) -> np.ndarray:
    """Return per-10ms motion energy (frame-difference magnitude)."""
    target_fps = SAMPLE_RATE_HZ
    width, height = 80, 45  # tiny — only need motion energy, not detail
    proc = subprocess.run(
        [
            FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
            "-ss", f"{start:.3f}", "-i", src,
            "-t", f"{duration:.3f}",
            "-an",
            "-vf", f"scale={width}:{height},format=gray,fps={target_fps}",
            "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
        ],
        capture_output=True, check=True,
    )
    frame_size = width * height
    n_frames = len(proc.stdout) // frame_size
    if n_frames < 2:
        return np.zeros(0, dtype=np.float32)
    frames = np.frombuffer(
        proc.stdout[: n_frames * frame_size], dtype=np.uint8
    ).reshape(n_frames, height, width).astype(np.int16)
    # Per-frame motion = mean abs diff to previous frame.
    diffs = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2)).astype(np.float32)
    return diffs


def detect_av_offset(
    src: str,
    probe_start: float = 0.0,
    probe_duration: float = 30.0,
    max_offset_ms: int = 500,
) -> Optional[dict]:
    """Detect audio-leads-video offset by cross-correlating envelopes.

    Returns:
        {
            'offset_ms':       int,    # ms to shift audio EARLIER (positive)
                                       #     to compensate for the lead
            'confidence':      float,  # 0..1 — peak-to-noise ratio
            'probe_window':    [start, end] in seconds
        }
        or None if the probe window has insufficient signal.

    Usage in smart_cut:
        info = detect_av_offset(src, probe_start=khutbah_start)
        if info and info['confidence'] > 0.4:
            audio_seek = video_seek - info['offset_ms'] / 1000.0
        else:
            audio_seek = video_seek  # no compensation
    """
    audio = _audio_envelope(src, probe_start, probe_duration)
    motion = _video_motion_envelope(src, probe_start, probe_duration)
    if audio.size < 50 or motion.size < 50:
        return None

    # Trim to common length
    n = min(audio.size, motion.size)
    audio = audio[:n]
    motion = motion[:n]

    # Z-score normalise so the cross-correlation peak is meaningful
    a = (audio - audio.mean()) / (audio.std() + 1e-9)
    m = (motion - motion.mean()) / (motion.std() + 1e-9)

    max_lag = min(max_offset_ms // (1000 // SAMPLE_RATE_HZ), n - 1)
    lags = np.arange(-max_lag, max_lag + 1)
    # Positive lag = audio leads (sample at audio[t] correlates with
    # motion[t + lag]). Compute correlation per lag.
    corrs = np.zeros(lags.size, dtype=np.float32)
    for i, lag in enumerate(lags):
        if lag >= 0:
            ao = a[: n - lag]
            mo = m[lag:]
        else:
            ao = a[-lag:]
            mo = m[: n + lag]
        if ao.size > 0:
            corrs[i] = float(np.dot(ao, mo) / ao.size)

    peak_idx = int(np.argmax(corrs))
    peak_corr = float(corrs[peak_idx])
    noise = float(np.median(np.abs(corrs)))
    confidence = peak_corr / (peak_corr + noise + 1e-9) if peak_corr > 0 else 0.0
    offset_samples = int(lags[peak_idx])
    offset_ms = offset_samples * (1000 // SAMPLE_RATE_HZ)

    return {
        "offset_ms": offset_ms,
        "confidence": confidence,
        "probe_window": [probe_start, probe_start + probe_duration],
    }



def detect_av_offset_robust(
    src: str,
    probe_starts: Optional[list[float]] = None,
    probe_duration: float = 30.0,
    max_offset_ms: int = 500,
    min_confidence: float = 0.5,
) -> Optional[dict]:
    """Multi-window cross-correlation with median aggregation.

    Single-window correlation can lock onto false peaks when the chosen
    window has motion uncorrelated with audio (camera pan, audience
    cutaway, gesture-without-emphasis). Probing 4-6 windows spread
    across the speech-heavy portion and taking the median offset is
    much more reliable.

    Default `probe_starts` covers minutes 18, 21, 24, 27, 30 of the
    source — these times correlate with khutbah body in our specific
    distribution. Caller can override per source.
    """
    if probe_starts is None:
        # Probe in the second half — for typical khutbahs, that's where
        # the speaker's body language correlates most strongly with audio
        # peaks. Skip the adhan/intro region, which is recitation +
        # static camera (poor signal).
        probe_starts = [1100.0, 1300.0, 1500.0, 1700.0, 1900.0]

    samples: list[dict] = []
    for s in probe_starts:
        r = detect_av_offset(
            src,
            probe_start=s,
            probe_duration=probe_duration,
            max_offset_ms=max_offset_ms,
        )
        if r and r["confidence"] >= min_confidence:
            samples.append(r)

    if not samples:
        return None

    offsets = sorted([r["offset_ms"] for r in samples])
    median_offset = offsets[len(offsets) // 2]
    confidences = [r["confidence"] for r in samples]
    return {
        "offset_ms": median_offset,
        "confidence": sum(confidences) / len(confidences),
        "samples": samples,
        "n_samples": len(samples),
    }
