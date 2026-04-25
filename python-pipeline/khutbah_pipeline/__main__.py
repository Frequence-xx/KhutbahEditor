"""Entry point — starts the JSON-RPC server on stdin/stdout."""
from typing import Any
from khutbah_pipeline.rpc import RpcServer, register
from khutbah_pipeline.ingest.local import probe_local
from khutbah_pipeline.edit.proxy import generate_proxy
from khutbah_pipeline.edit.smartcut import smart_cut

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
) -> dict[str, str]:
    smart_cut(src, dst, start, end, normalize_audio=normalize_audio)
    return {"output": dst}

if __name__ == "__main__":
    RpcServer().run_forever()
