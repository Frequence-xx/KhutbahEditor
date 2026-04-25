"""Entry point — starts the JSON-RPC server on stdin/stdout."""
from khutbah_pipeline.rpc import RpcServer, register

@register("ping")
def ping():
    return {"ok": True, "version": __import__("khutbah_pipeline").__version__}

if __name__ == "__main__":
    RpcServer().run_forever()
