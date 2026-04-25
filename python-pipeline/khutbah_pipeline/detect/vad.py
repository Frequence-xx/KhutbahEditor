"""silero-vad wrapper.

Returns speech segments [{start, end}, ...] in seconds. Decoded audio is
streamed from ffmpeg at 16 kHz mono — silero's required input format.
"""

from __future__ import annotations

import subprocess
from typing import Any, Callable, Optional

import numpy as np

from khutbah_pipeline.util.ffmpeg import FFMPEG


SAMPLE_RATE = 16000


def detect_speech_segments(
    audio_path: str,
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> list[dict[str, float]]:
    """Run silero-vad over the full audio file and return speech intervals.

    Streams 16 kHz mono PCM from ffmpeg through silero-vad's get_speech_timestamps.
    Cost: ~30-60 s on CPU for a 3 hr source on a modern laptop.
    """
    from silero_vad import load_silero_vad, get_speech_timestamps
    import torch

    if progress_cb:
        progress_cb({"stage": "vad", "message": "Loading VAD model…", "progress": 0.0})

    model = load_silero_vad()

    if progress_cb:
        progress_cb({"stage": "vad", "message": "Decoding audio for VAD…", "progress": 0.1})

    proc = subprocess.run(
        [
            FFMPEG, "-y", "-i", audio_path,
            "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE),
            "-f", "s16le", "-loglevel", "error", "pipe:1",
        ],
        capture_output=True,
        check=True,
    )
    samples = np.frombuffer(proc.stdout, dtype=np.int16)
    if samples.size == 0:
        return []
    audio = torch.from_numpy(samples.astype(np.float32) / 32768.0)

    if progress_cb:
        progress_cb({"stage": "vad", "message": "Running VAD…", "progress": 0.5})

    timestamps = get_speech_timestamps(
        audio, model,
        sampling_rate=SAMPLE_RATE,
        return_seconds=True,
        min_speech_duration_ms=500,
        min_silence_duration_ms=300,
    )

    segs = [{"start": float(t["start"]), "end": float(t["end"])} for t in timestamps]

    if progress_cb:
        progress_cb({"stage": "vad", "message": f"Found {len(segs)} speech segments", "progress": 1.0})

    return segs
