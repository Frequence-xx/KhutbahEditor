import { Writable, Readable } from 'stream';
import readline from 'readline';

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

export class StdioRpc {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private rl: readline.Interface;

  constructor(private stdin: Writable, stdout: Readable) {
    this.rl = readline.createInterface({ input: stdout, crlfDelay: Infinity });
    this.rl.on('line', (line) => this.handleLine(line));
  }

  private handleLine(line: string) {
    if (!line.trim()) return;
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(msg.error);
    else p.resolve(msg.result);
  }

  call<T = unknown>(method: string, params?: object): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as any, reject });
      this.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  close() { this.rl.close(); }
}
