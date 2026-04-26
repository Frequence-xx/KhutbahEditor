from collections import Counter
from typing import Any, Callable, Optional

from khutbah_pipeline.util.gpu import has_nvidia_gpu, can_load_cublas


class CudaUnavailableError(RuntimeError):
    """Raised when CUDA is requested (or auto-selected) but the runtime
    can't actually use it. Carries an actionable message for the user."""


def _resolve_device(prefer: str = "auto") -> tuple[str, str]:
    """Resolve (device, compute_type) without silent CPU fallback.

    `prefer` ∈ {"auto", "cuda", "cpu"}:
      - "cpu":  always CPU. No probes.
      - "cuda": CUDA or raise. Never CPU.
      - "auto": CUDA if NVIDIA GPU + cuBLAS both present.
                CPU silently if NO NVIDIA GPU.
                RAISE if NVIDIA GPU present but cuBLAS missing — user
                expected GPU acceleration; degrading silently is wrong.
    """
    import ctranslate2  # type: ignore[import-untyped]

    if prefer not in ("auto", "cuda", "cpu"):
        raise ValueError(f"invalid device preference: {prefer!r}")

    if prefer == "cpu":
        cpu_types = set(ctranslate2.get_supported_compute_types("cpu"))
        for c in ("int8", "int8_float16", "float32"):
            if c in cpu_types:
                return ("cpu", c)
        return ("cpu", "float32")

    gpu_present = has_nvidia_gpu()
    cublas_ok = can_load_cublas() if gpu_present else False

    if prefer == "cuda":
        if not gpu_present:
            raise CudaUnavailableError(
                "CUDA requested but no NVIDIA GPU detected (nvidia-smi failed). "
                "Set Settings → Compute Device to CPU if your machine has no GPU."
            )
        if not cublas_ok:
            from khutbah_pipeline.util.gpu import CT2_REQUIRED_CUBLAS_MAJOR
            raise CudaUnavailableError(
                f"CUDA requested but libcublas.so.{CT2_REQUIRED_CUBLAS_MAJOR} is not loadable. "
                f"ctranslate2 4.x links against CUDA {CT2_REQUIRED_CUBLAS_MAJOR} — install the matching pip packages: "
                f"'pip install nvidia-cublas-cu{CT2_REQUIRED_CUBLAS_MAJOR} nvidia-cudnn-cu{CT2_REQUIRED_CUBLAS_MAJOR}' "
                "(or the system CUDA toolkit), or change Settings → Compute Device to CPU."
            )

    if prefer == "auto":
        if not gpu_present:
            cpu_types = set(ctranslate2.get_supported_compute_types("cpu"))
            for c in ("int8", "int8_float16", "float32"):
                if c in cpu_types:
                    return ("cpu", c)
            return ("cpu", "float32")
        if not cublas_ok:
            from khutbah_pipeline.util.gpu import CT2_REQUIRED_CUBLAS_MAJOR
            raise CudaUnavailableError(
                f"An NVIDIA GPU is present, but libcublas.so.{CT2_REQUIRED_CUBLAS_MAJOR} (the version "
                f"ctranslate2 4.x links against) is not loadable. Install the matching pip packages: "
                f"'pip install nvidia-cublas-cu{CT2_REQUIRED_CUBLAS_MAJOR} nvidia-cudnn-cu{CT2_REQUIRED_CUBLAS_MAJOR}', "
                "or change Settings → Compute Device to CPU. Auto mode refuses to silently fall back."
            )

    cuda_types = set(ctranslate2.get_supported_compute_types("cuda"))
    for c in ("float16", "int8_float16", "int8"):
        if c in cuda_types:
            return ("cuda", c)
    raise CudaUnavailableError(
        "ctranslate2 has no usable CUDA compute type on this machine. "
        "This usually means ctranslate2 was built without CUDA support — "
        "reinstall with 'pip install ctranslate2 --force-reinstall'."
    )


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
