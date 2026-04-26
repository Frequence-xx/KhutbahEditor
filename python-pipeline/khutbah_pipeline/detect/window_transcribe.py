"""Transcribe specific time windows of an audio file with whisper-tiny.

This is the speedup that makes the new pipeline practical: instead of
transcribing 3 hours of audio (~25 min CPU on large-v3), we transcribe
~5-15 windows of 10 s each (~30 s CPU on tiny). The windows come from
the candidate scorer — only timestamps where boundaries might be.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from typing import Any, Callable, Optional

from khutbah_pipeline.detect.transcribe import _resolve_device
from khutbah_pipeline.util.ffmpeg import FFMPEG


def _extract_window(audio_path: str, start: float, end: float, dst: str) -> None:
    """Cut a window into a wav file. -ss before -i for fast input seek."""
    duration = max(0.5, end - start)
    subprocess.run(
        [
            FFMPEG, "-y",
            "-ss", f"{start:.3f}", "-i", audio_path,
            "-t", f"{duration:.3f}",
            "-vn", "-ac", "1", "-ar", "16000",
            "-loglevel", "error",
            dst,
        ],
        check=True, capture_output=True,
    )


def transcribe_windows(
    audio_path: str,
    model_dir: str,
    windows: list[dict[str, Any]],
    device: str = "auto",
    language: Optional[str] = None,
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, dict[str, Any]]:
    """Run whisper-tiny on each window. Returns {window_id: {words, language}}.

    `windows` items must have `id`, `start`, `end`. Out-of-order windows
    are fine — model loads once and processes serially.
    """
    if not windows:
        return {}

    from faster_whisper import WhisperModel

    resolved_device, resolved_compute = _resolve_device(device)

    if progress_cb:
        progress_cb({
            "stage": "transcribe_windows",
            "message": f"Loading whisper-tiny ({resolved_device}, {resolved_compute})…",
            "progress": 0.0,
        })

    model = WhisperModel(model_dir, device=resolved_device, compute_type=resolved_compute)

    out: dict[str, dict[str, Any]] = {}
    with tempfile.TemporaryDirectory() as tmp:
        for i, w in enumerate(windows):
            wav = os.path.join(tmp, f"w_{i}.wav")
            _extract_window(audio_path, w["start"], w["end"], wav)
            segments, info = model.transcribe(
                wav,
                word_timestamps=True,
                # vad_filter skips silent regions inside whisper's own pass —
                # without this we burned ~130s decoding silent pre-roll on a
                # 34min source. silero may miss Quran recitation but the
                # khutbah body has clear conversational speech which it
                # handles fine.
                vad_filter=True,
                beam_size=1,
                language=language,
            )
            words: list[dict[str, Any]] = []
            for seg in segments:
                for word in (seg.words or []):
                    words.append({
                        "word": word.word,
                        "start": float(word.start) + w["start"],
                        "end": float(word.end) + w["start"],
                        "probability": float(word.probability),
                    })
            out[w["id"]] = {"words": words, "language": info.language}
            if progress_cb:
                progress_cb({
                    "stage": "transcribe_windows",
                    "message": f"Window {i + 1}/{len(windows)}",
                    "progress": (i + 1) / len(windows),
                })

    return out
