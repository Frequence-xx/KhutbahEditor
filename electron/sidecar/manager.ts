import { spawn, ChildProcess } from 'child_process';
import { StdioRpc } from './rpc.js';

export type SidecarOpts = {
  pythonExecutable: string;
  moduleEntry: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
};

export class SidecarManager {
  private child: ChildProcess | null = null;
  private rpc: StdioRpc | null = null;
  private starting = false;
  private stopping: Promise<void> | null = null;

  constructor(private opts: SidecarOpts) {}

  async start(): Promise<void> {
    if (this.child) throw new Error('Sidecar already started');
    if (this.starting) throw new Error('Sidecar start already in progress');
    this.starting = true;
    try {
      await this._startImpl();
    } catch (e) {
      await this.stop();
      throw e;
    } finally {
      this.starting = false;
    }
  }

  private async _startImpl(): Promise<void> {
    const child = spawn(
      this.opts.pythonExecutable,
      ['-m', this.opts.moduleEntry],
      { cwd: this.opts.cwd, env: { ...process.env, ...this.opts.env }, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.child = child;

    // Wire error event immediately — before any async work
    const spawnErrorPromise = new Promise<never>((_, reject) => {
      child.on('error', (err) => {
        this.rpc?.failAll(err);
        reject(err);
      });
    });

    child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[sidecar] ${chunk}`));

    child.on('exit', (code) => {
      process.stderr.write(`[sidecar] exited with code ${code}\n`);
      this.rpc?.failAll(new Error(`Sidecar exited with code ${code}`));
      // Null out state so new call() throws 'Sidecar not started' rather than
      // writing to a closed stdin and hanging forever with no future close/exit.
      this.rpc = null;
      this.child = null;
    });

    if (!child.stdin || !child.stdout) throw new Error('Sidecar stdio unavailable');
    this.rpc = new StdioRpc(child.stdin, child.stdout);

    // Startup ping with a properly-cleared timer
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Sidecar startup timeout')), 5000);
    });
    try {
      await Promise.race([this.call('ping'), timeoutPromise, spawnErrorPromise]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  call<T = unknown>(method: string, params?: object): Promise<T> {
    if (!this.rpc) throw new Error('Sidecar not started');
    return this.rpc.call<T>(method, params);
  }

  onNotification(listener: (method: string, params: Record<string, unknown>) => void): () => void {
    if (!this.rpc) throw new Error('Sidecar not started');
    return this.rpc.onNotification(listener);
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = this._stopImpl();
    try {
      await this.stopping;
    } finally {
      this.stopping = null;
    }
  }

  private async _stopImpl(): Promise<void> {
    this.rpc?.close();
    this.rpc = null;

    const child = this.child;
    this.child = null;

    if (!child || child.killed || child.exitCode !== null) return;

    await new Promise<void>((resolve) => {
      let killTimer: NodeJS.Timeout | undefined;

      const onExit = () => {
        if (killTimer !== undefined) clearTimeout(killTimer);
        resolve();
      };

      // Single listener survives the SIGKILL fallback — no race window.
      // If SIGTERM works, onExit fires and clears the timer.
      // If the timer fires first, it sends SIGKILL without re-wiring; onExit
      // then catches the SIGKILL-induced exit and resolves.
      child.once('exit', onExit);
      child.kill('SIGTERM');

      killTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, 1000);
    });
  }
}
