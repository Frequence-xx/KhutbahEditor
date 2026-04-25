"""Entry point — starts the JSON-RPC server on stdin/stdout."""
import os
from typing import Any
from khutbah_pipeline.rpc import RpcServer, register
from khutbah_pipeline.ingest.local import probe_local
from khutbah_pipeline.edit.proxy import generate_proxy
from khutbah_pipeline.edit.smartcut import smart_cut
from khutbah_pipeline.detect.pipeline import run_detection_pipeline

@register("ping")
def ping() -> dict[str, object]:
    return {"ok": True, "version": __import__("khutbah_pipeline").__version__}

@register("ingest.probe_local")
def _probe(path: str) -> dict[str, Any]:
    return probe_local(path)

@register("edit.generate_proxy")
def _proxy(src: str, dst: str) -> dict[str, str]:
    generate_proxy(src, dst)
    return {"path": dst}

@register("edit.smart_cut")
def _smart_cut(
    src: str,
    dst: str,
    start: float,
    end: float,
    normalize_audio: bool = True,
    target_lufs: float = -14.0,
    target_tp: float = -1.0,
    target_lra: float = 11.0,
) -> dict[str, str]:
    smart_cut(
        src, dst, start, end,
        normalize_audio=normalize_audio,
        target_lufs=target_lufs,
        target_tp=target_tp,
        target_lra=target_lra,
    )
    return {"output": dst}

@register("detect.run")
def _detect(audio_path: str, model_dir: str = "") -> dict[str, Any]:
    """Run the khutbah detection pipeline.

    `model_dir` defaults to the bundled Whisper model path (relative to
    python-pipeline/ cwd, or via KHUTBAH_MODEL_DIR env override).
    """
    if not model_dir:
        model_dir = os.environ.get(
            "KHUTBAH_MODEL_DIR",
            "../resources/models/whisper-large-v3",
        )
    return run_detection_pipeline(audio_path, model_dir)

if __name__ == "__main__":
    RpcServer().run_forever()
