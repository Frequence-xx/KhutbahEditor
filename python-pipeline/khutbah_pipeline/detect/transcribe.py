from collections import Counter
from typing import Any, Callable, Optional


def _detect_device_and_compute(prefer: str = "auto") -> tuple[str, str]:
    """Detect best available device + compute type for faster-whisper.

    Cross-platform / cross-vendor probe order (fastest → safest fallback):
      1. CUDA float16        — NVIDIA Turing+ (GTX 16xx / RTX), ROCm-built CT2 on AMD
      2. CUDA int8_float16   — older NVIDIA (Pascal-era) where pure FP16 is slow
      3. CUDA int8           — last GPU resort
      4. CPU int8            — Apple Silicon (Accelerate), x86 with AVX-VNNI
      5. CPU float32         — universal fallback

    ctranslate2 only ships "cuda" and "cpu" device strings. It has no Apple
    Metal/MPS or Intel-GPU backend, so on Apple Silicon the fast path is CPU
    int8 with the Accelerate framework — competitive with CUDA on small models.
    AMD users running a ROCm-built ctranslate2 register their device as "cuda".

    Returns (device, compute_type).
    """
    if prefer not in ("auto", "cpu", "cuda"):
        prefer = "auto"

    if prefer in ("auto", "cuda"):
        try:
            import ctranslate2  # type: ignore[import-untyped]
            cuda_types = set(ctranslate2.get_supported_compute_types("cuda"))
            for compute in ("float16", "int8_float16", "int8"):
                if compute in cuda_types:
                    return ("cuda", compute)
        except Exception:
            pass  # No GPU backend — ctranslate2 built without CUDA, no driver,
                  # or no compatible GPU/cuDNN. Fall through to CPU.

    try:
        import ctranslate2  # type: ignore[import-untyped]
        cpu_types = set(ctranslate2.get_supported_compute_types("cpu"))
        for compute in ("int8", "float32"):
            if compute in cpu_types:
                return ("cpu", compute)
    except Exception:
        pass

    return ("cpu", "float32")


def transcribe_multilingual(
    audio_path: str,
    model_dir: str,
    device: str = "auto",
    compute_type: str = "auto",
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    """Two-pass: detect language per chunk, then transcribe with locked language.

    progress_cb receives dicts of shape:
      {"stage": "transcribe", "message": str, "progress": float (0-1)}
    """
    # Lazy import — faster_whisper pulls in heavy CTranslate2 deps. We don't
    # want to import it at module import time so that the rest of the pipeline
    # (including tests that mock this function) can run without faster_whisper
    # installed in the dev venv.
    from faster_whisper import WhisperModel  # type: ignore[import-untyped]

    resolved_device, resolved_compute = (device, compute_type)
    if device == "auto" or compute_type == "auto":
        d_auto, c_auto = _detect_device_and_compute(device)
        if device == "auto":
            resolved_device = d_auto
        if compute_type == "auto":
            resolved_compute = c_auto

    if progress_cb:
        progress_cb({
            "stage": "transcribe",
            "message": f"Loading Whisper model ({resolved_device}, {resolved_compute})…",
            "progress": 0.0,
        })

    try:
        model = WhisperModel(model_dir, device=resolved_device, compute_type=resolved_compute)
    except Exception as e:
        # If CUDA load fails (missing cuDNN, OOM, etc.), retry on CPU.
        if resolved_device == "cuda":
            if progress_cb:
                progress_cb({
                    "stage": "transcribe",
                    "message": f"CUDA load failed ({type(e).__name__}); falling back to CPU int8…",
                    "progress": 0.0,
                })
            resolved_device, resolved_compute = ("cpu", "int8")
            model = WhisperModel(model_dir, device=resolved_device, compute_type=resolved_compute)
        else:
            raise

    # Single-pass transcribe with language=None — faster-whisper auto-detects.
    segments, info = model.transcribe(
        audio_path,
        language=None,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )
    duration = info.duration if info.duration else 0.0

    if progress_cb:
        progress_cb({
            "stage": "transcribe",
            "message": f"Transcribing ({resolved_device}, lang={info.language})…",
            "progress": 0.0,
        })

    words: list[dict[str, Any]] = []
    lang_counter: Counter[str] = Counter()

    for seg in segments:
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
            frac = max(0.0, min(1.0, seg.end / duration))
            progress_cb({
                "stage": "transcribe",
                "message": f"Transcribing ({resolved_device}) — {int(frac * 100)}%",
                "progress": frac,
            })

    dominant = lang_counter.most_common(1)[0][0] if lang_counter else "ar"
    return {"duration": duration, "words": words, "lang_dominant": dominant}
