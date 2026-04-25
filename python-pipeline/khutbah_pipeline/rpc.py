"""Minimal JSON-RPC 2.0 server over a line-oriented stream (stdin/stdout)."""
import json
import sys
import traceback
from typing import Callable, Any

_METHODS: dict[str, Callable[..., Any]] = {}

def register(name: str):
    def deco(fn: Callable[..., Any]) -> Callable[..., Any]:
        _METHODS[name] = fn
        return fn
    return deco

class RpcServer:
    def __init__(self, in_stream=sys.stdin, out_stream=sys.stdout):
        self.in_ = in_stream
        self.out = out_stream

    def _write(self, payload: dict):
        self.out.write(json.dumps(payload) + "\n")
        self.out.flush()

    def _handle(self, req: dict):
        rid = req.get("id")
        method = req.get("method")
        params = req.get("params") or {}
        if method not in _METHODS:
            return {"jsonrpc": "2.0", "id": rid,
                    "error": {"code": -32601, "message": f"Method not found: {method}"}}
        try:
            result = _METHODS[method](**params) if isinstance(params, dict) else _METHODS[method](*params)
            return {"jsonrpc": "2.0", "id": rid, "result": result}
        except Exception as e:
            return {"jsonrpc": "2.0", "id": rid,
                    "error": {"code": -32000, "message": str(e), "data": traceback.format_exc()}}

    def run_one(self) -> bool:
        line = self.in_.readline()
        if not line:
            return False
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            self._write({"jsonrpc": "2.0", "id": None,
                         "error": {"code": -32700, "message": "Parse error"}})
            return True
        self._write(self._handle(req))
        return True

    def run_forever(self):
        while self.run_one():
            pass
