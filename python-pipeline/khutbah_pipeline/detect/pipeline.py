"""Compat shim — delegates to pipeline_v2.

Kept as `pipeline.run_detection_pipeline` so existing callers (the RPC
handler in __main__.py, tests) don't change signature. New work should
import pipeline_v2 directly.

Replaced the original 7-stage large-v3 full-transcribe orchestrator on
2026-04-25 — see docs/superpowers/plans/2026-04-25-pipeline-speed-overhaul.md
Phase 3 for rationale (~25 min CPU detect-bounds → <5 min target).
"""

from typing import Any, Callable, Optional

from khutbah_pipeline.detect.pipeline_v2 import run_pipeline_v2


def run_detection_pipeline(
    audio_path: str,
    model_dir: str,
    silence_noise_db: float = -35.0,
    silence_min_duration: float = 1.5,
    device: str = "auto",
    progress_cb: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    return run_pipeline_v2(
        audio_path=audio_path,
        model_dir=model_dir,
        device=device,
        silence_noise_db=silence_noise_db,
        silence_min_duration=silence_min_duration,
        progress_cb=progress_cb,
    )
