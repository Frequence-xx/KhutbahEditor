import io
import json
from khutbah_pipeline.rpc import RpcServer, register

@register("ping")
def ping():
    return {"ok": True}

def test_rpc_handles_single_request():
    stdin = io.StringIO(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"}) + "\n")
    stdout = io.StringIO()
    server = RpcServer(stdin, stdout)
    server.run_one()
    response = json.loads(stdout.getvalue().strip())
    assert response == {"jsonrpc": "2.0", "id": 1, "result": {"ok": True}}

def test_rpc_handles_unknown_method():
    stdin = io.StringIO(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "nope"}) + "\n")
    stdout = io.StringIO()
    server = RpcServer(stdin, stdout)
    server.run_one()
    response = json.loads(stdout.getvalue().strip())
    assert response["error"]["code"] == -32601  # method not found
