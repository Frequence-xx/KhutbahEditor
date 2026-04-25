import subprocess
from typing import Any

import numpy as np

from khutbah_pipeline.util.ffmpeg import FFMPEG


def compute_waveform(src: str, peaks_count: int = 1500) -> dict[str, Any]:
    """Extract a downsampled abs-max peak waveform from src.

    8kHz mono is overkill for visualisation but cheap to extract; downsampling
    to ~1500 peaks keeps the JSON small (<15 KB) while resolving sub-second
    silence regions on a 1h source.

    Returns:
        {
            'peaks': list[float],   # 0..1 normalised abs-max per bucket
            'sample_rate': int,     # 8000
            'duration': float,      # seconds, computed from sample count
        }
    """
    sample_rate = 8000
    proc = subprocess.run(
        [
            FFMPEG, "-y", "-i", src,
            "-vn",
            "-ac", "1",
            "-ar", str(sample_rate),
            "-f", "s16le",
            "-loglevel", "error",
            "pipe:1",
        ],
        capture_output=True,
        check=True,
    )
    samples = np.frombuffer(proc.stdout, dtype=np.int16)
    if samples.size == 0:
        return {"peaks": [], "sample_rate": sample_rate, "duration": 0.0}

    duration = float(samples.size / sample_rate)
    bucket_size = max(1, samples.size // peaks_count)
    n_buckets = samples.size // bucket_size
    truncated = samples[: n_buckets * bucket_size].reshape(n_buckets, bucket_size)
    peaks = (np.abs(truncated).max(axis=1).astype(np.float32) / 32768.0).tolist()
    return {"peaks": peaks, "sample_rate": sample_rate, "duration": duration}
