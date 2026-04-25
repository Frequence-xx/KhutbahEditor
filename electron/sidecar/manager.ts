import { spawn, ChildProcess } from 'child_process';
import { StdioRpc } from './rpc';

export type SidecarOpts = {
  pythonExecutable: string;
  moduleEntry: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
};

export class SidecarManager {
  private child: ChildProcess | null = null;
  private rpc: StdioRpc | null = null;

  constructor(private opts: SidecarOpts) {}

  async start(): Promise<void> {
    this.child = spawn(
      this.opts.pythonExecutable,
      ['-m', this.opts.moduleEntry],
      { cwd: this.opts.cwd, env: { ...process.env, ...this.opts.env }, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    this.child.stderr?.on('data', (chunk) => process.stderr.write(`[sidecar] ${chunk}`));
    this.child.on('exit', (code) => { console.error(`[sidecar] exited with code ${code}`); });
    if (!this.child.stdin || !this.child.stdout) throw new Error('Sidecar stdio unavailable');
    this.rpc = new StdioRpc(this.child.stdin, this.child.stdout);
    // Sanity ping with timeout
    await Promise.race([
      this.call('ping'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Sidecar startup timeout')), 5000)),
    ]);
  }

  call<T = unknown>(method: string, params?: object): Promise<T> {
    if (!this.rpc) throw new Error('Sidecar not started');
    return this.rpc.call<T>(method, params);
  }

  async stop(): Promise<void> {
    this.rpc?.close();
    if (this.child && !this.child.killed) {
      this.child.kill('SIGTERM');
      await new Promise<void>((res) => setTimeout(() => { this.child?.kill('SIGKILL'); res(); }, 1000));
    }
    this.child = null;
    this.rpc = null;
  }
}
