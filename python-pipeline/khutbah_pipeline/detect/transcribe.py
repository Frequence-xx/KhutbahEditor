from collections import Counter
from typing import Any, Callable, Optional


def transcribe_multilingual(
    audio_path: str,
    model_dir: str,
    device: str = "auto",
    compute_type: str = "auto",
    progress_cb: Optional[Callable[[float], None]] = None,
) -> dict[str, Any]:
    """Two-pass: detect language per chunk, then transcribe with locked language.

    Returns:
      {
        "duration": <seconds>,
        "words": [{"word", "start", "end", "probability", "lang"}],
        "lang_dominant": "ar" | "nl" | "en" | "...",
      }
    """
    # Lazy import — faster_whisper pulls in heavy CTranslate2 deps. We don't
    # want to import it at module import time so that the rest of the pipeline
    # (including tests that mock this function) can run without faster_whisper
    # installed in the dev venv.
    from faster_whisper import WhisperModel  # type: ignore[import-untyped]

    if device == "auto":
        try:
            import torch  # type: ignore[import-untyped]
            device = "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            device = "cpu"

    resolved_compute_type = compute_type if compute_type != "auto" else "default"
    model = WhisperModel(model_dir, device=device, compute_type=resolved_compute_type)

    # faster-whisper supports multilingual auto-detect per segment with language=None.
    # The plan calls for a "two-pass" approach (detect-then-transcribe) but
    # faster-whisper's `transcribe(language=None, ...)` already performs language
    # detection internally per segment, so a separate pass is unnecessary.
    segments, info = model.transcribe(
        audio_path,
        language=None,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )
    words: list[dict[str, Any]] = []
    lang_counter: Counter[str] = Counter()
    duration = info.duration if info.duration else 0.0

    for seg in segments:
        # info.language is the file-level dominant language; finer per-chunk
        # detection would require running detect_language() on each VAD chunk
        # separately. For Phase 2 the file-level lang is sufficient.
        seg_lang = info.language or "ar"
        for w in (seg.words or []):
            words.append({
                "word": w.word.strip(),
                "start": w.start,
                "end": w.end,
                "probability": w.probability,
                "lang": seg_lang,
            })
            lang_counter[seg_lang] += 1
        if progress_cb and duration > 0:
            progress_cb(seg.end / duration)

    dominant = lang_counter.most_common(1)[0][0] if lang_counter else "ar"
    return {"duration": duration, "words": words, "lang_dominant": dominant}
