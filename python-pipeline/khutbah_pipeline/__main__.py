"""Entry point — starts the JSON-RPC server on stdin/stdout."""
import os
from typing import Any
from khutbah_pipeline.rpc import RpcServer, register
from khutbah_pipeline.ingest.local import probe_local
from khutbah_pipeline.ingest.youtube import info_only, download
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

@register("ingest.youtube_info")
def _yt_info(url: str) -> dict[str, Any]:
    return info_only(url)


@register("ingest.youtube_download")
def _yt_dl(url: str, output_dir: str) -> dict[str, str]:
    return {"path": download(url, output_dir)}


@register("detect.run")
def _detect(audio_path: str, model_dir: str = "") -> dict[str, Any]:
    """Run the khutbah detection pipeline.

    `model_dir` defaults to:
    1. KHUTBAH_MODEL_DIR env override (used by Electron main to pass the
       packaged path — set in electron/sidecar/manager.ts at Phase 5)
    2. ../resources/models/whisper-large-v3 relative to cwd (dev path)

    The packaged app bundles the model at <resourcesPath>/models/whisper-large-v3/
    (see electron-builder.json extraResources). Electron main will set
    KHUTBAH_MODEL_DIR to that resolved path before spawning the sidecar.
    """
    if not model_dir:
        model_dir = os.environ.get(
            "KHUTBAH_MODEL_DIR",
            "../resources/models/whisper-large-v3",
        )
    return run_detection_pipeline(audio_path, model_dir)

if __name__ == "__main__":
    RpcServer().run_forever()
