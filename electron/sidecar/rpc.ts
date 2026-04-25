import { Writable, Readable } from 'stream';
import readline from 'readline';

type RpcResponse = {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

function isRpcResponse(v: unknown): v is RpcResponse {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  if (r['jsonrpc'] !== '2.0') return false;
  if (!('id' in r)) return false;
  const id = r['id'];
  if (id !== null && typeof id !== 'number' && typeof id !== 'string') return false;
  const hasResult = 'result' in r;
  const hasError = 'error' in r;
  // Exactly one of result/error must be present
  if (hasResult === hasError) return false;
  if (hasError) {
    const err = r['error'];
    if (typeof err !== 'object' || err === null) return false;
    const e = err as Record<string, unknown>;
    if (typeof e['code'] !== 'number') return false;
    if (typeof e['message'] !== 'string') return false;
  }
  return true;
}

export class StdioRpc {
  private nextId = 1;
  private pending = new Map<number | string, Pending>();
  private rl: readline.Interface;

  constructor(private stdin: Writable, stdout: Readable) {
    this.rl = readline.createInterface({ input: stdout, crlfDelay: Infinity });
    this.rl.on('line', (line) => this.handleLine(line));
    this.rl.on('close', () => this.failAll(new Error('Sidecar stdout closed')));
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      process.stderr.write(`[sidecar][rpc] dropped malformed line (JSON parse error): ${line}\n`);
      return;
    }
    if (!isRpcResponse(parsed)) {
      process.stderr.write(`[sidecar][rpc] dropped malformed line (invalid RPC frame): ${line}\n`);
      return;
    }
    const id = parsed.id;
    if (id === null) return;
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (parsed.error !== undefined) {
      p.reject(parsed.error);
    } else {
      p.resolve(parsed.result);
    }
  }

  call<T = unknown>(method: string, params?: object): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  failAll(error: unknown): void {
    for (const p of this.pending.values()) {
      p.reject(error);
    }
    this.pending.clear();
  }

  close(): void {
    this.rl.close();
  }
}
