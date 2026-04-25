from collections import Counter
from typing import Any, Callable, Optional


def _can_load_cublas() -> bool:
    """Probe whether cuBLAS is actually loadable on this machine.

    ctranslate2.get_supported_compute_types("cuda") only checks compile-time
    support, not whether the runtime libs (libcublas, cuDNN) are installed.
    On Linux/Windows the cuBLAS dlopen happens lazily inside ctranslate2
    during the first matmul of model.transcribe(), which means a "cuda"
    backend can be reported as supported and still blow up mid-inference
    with `Library libcublas.so.12 is not found or cannot be loaded`.

    We dlopen/LoadLibrary the same name ctranslate2 will look for and
    return False if the loader rejects it. CPU fallback is then chosen
    proactively, which is much friendlier than failing on the user.
    """
    import ctypes
    import platform
    candidates: list[str]
    system = platform.system()
    if system == "Linux":
        candidates = ["libcublas.so.12", "libcublas.so.11", "libcublas.so"]
    elif system == "Windows":
        candidates = ["cublas64_12.dll", "cublas64_11.dll"]
    elif system == "Darwin":
        # Apple Silicon / macOS — no NVIDIA CUDA. Caller already prefers CPU.
        return False
    else:
        return False
    for name in candidates:
        try:
            ctypes.CDLL(name)
            return True
        except OSError:
            continue
    return False


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

    We also dlopen-probe cuBLAS upfront so machines that have an NVIDIA driver
    but no CUDA toolkit installed (the common Linux case) skip straight to CPU
    instead of failing mid-transcribe.

    Returns (device, compute_type).
    """
    if prefer not in ("auto", "cpu", "cuda"):
        prefer = "auto"

    if prefer in ("auto", "cuda"):
        try:
            import ctranslate2  # type: ignore[import-untyped]
            cuda_types = set(ctranslate2.get_supported_compute_types("cuda"))
            # ct2 reports "cuda" as supported even when the runtime libs
            # aren't installed. Confirm cuBLAS dlopens before committing.
            if cuda_types and _can_load_cublas():
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


def _transcribe_pass(
    audio_path: str,
    model_dir: str,
    device: str,
    compute_type: str,
    progress_cb: Optional[Callable[[dict[str, Any]], None]],
) -> dict[str, Any]:
    """One full transcribe attempt on a specific (device, compute_type).

    Raises on any error — caller decides whether to fall back. The segment
    loop is inside this function because faster-whisper's segment iterator
    is what triggers ctranslate2's lazy cuBLAS load — wrapping just the
    constructor is not enough to catch missing-runtime-libs errors.
    """
    from faster_whisper import WhisperModel  # type: ignore[import-untyped]

    if progress_cb:
        progress_cb({
            "stage": "transcribe",
            "message": f"Loading Whisper model ({device}, {compute_type})…",
            "progress": 0.0,
        })

    model = WhisperModel(model_dir, device=device, compute_type=compute_type)
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
            "message": f"Transcribing ({device}, lang={info.language})…",
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
                "message": f"Transcribing ({device}) — {int(frac * 100)}%",
                "progress": frac,
            })

    dominant = lang_counter.most_common(1)[0][0] if lang_counter else "ar"
    return {"duration": duration, "words": words, "lang_dominant": dominant}


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

    Falls back to CPU if a CUDA attempt fails at any point — including lazy
    library-load errors that don't surface until inference (e.g.
    libcublas.so.12 missing on a system with the NVIDIA driver but no CUDA
    toolkit installed).
    """
    resolved_device, resolved_compute = (device, compute_type)
    if device == "auto" or compute_type == "auto":
        d_auto, c_auto = _detect_device_and_compute(device)
        if device == "auto":
            resolved_device = d_auto
        if compute_type == "auto":
            resolved_compute = c_auto

    try:
        return _transcribe_pass(
            audio_path, model_dir, resolved_device, resolved_compute, progress_cb,
        )
    except Exception as e:
        if resolved_device != "cuda":
            raise
        # CUDA load OR runtime failure (e.g. libcublas not found mid-inference).
        # Retry on CPU so the user gets a result instead of a stack trace.
        if progress_cb:
            progress_cb({
                "stage": "transcribe",
                "message": f"GPU unavailable ({type(e).__name__}); switching to CPU…",
                "progress": 0.0,
            })
        return _transcribe_pass(
            audio_path, model_dir, "cpu", "int8", progress_cb,
        )
