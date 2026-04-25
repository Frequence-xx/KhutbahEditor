import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SidecarManager } from '../../electron/sidecar/manager';
import path from 'path';

const PY = path.resolve('python-pipeline/.venv/bin/python');
const CWD = path.resolve('python-pipeline');

describe('SidecarManager', () => {
  let mgr: SidecarManager;

  beforeAll(async () => {
    // Use the dev Python interpreter (assumes venv at python-pipeline/.venv)
    mgr = new SidecarManager({
      pythonExecutable: PY,
      moduleEntry: 'khutbah_pipeline',
      cwd: CWD,
    });
    await mgr.start();
  });

  afterAll(async () => { await mgr.stop(); });

  it('responds to ping RPC', async () => {
    const result = await mgr.call('ping');
    expect(result).toMatchObject({ ok: true });
  });

  it('rejects unknown methods with code -32601', async () => {
    await expect(mgr.call('nonexistent')).rejects.toMatchObject({ code: -32601 });
  });
});

describe('SidecarManager — failure modes', () => {
  it('rejects start() when executable is missing', async () => {
    const m = new SidecarManager({
      pythonExecutable: '/nonexistent/python',
      moduleEntry: 'khutbah_pipeline',
      cwd: CWD,
    });
    await expect(m.start()).rejects.toThrow();
    // stop() must be safe to call after a failed start
    await m.stop();
  });

  it('rejects in-flight call when sidecar is killed', async () => {
    const m = new SidecarManager({ pythonExecutable: PY, moduleEntry: 'khutbah_pipeline', cwd: CWD });
    await m.start();
    const pending = m.call('ping');
    // Kill the underlying child — stdout close triggers failAll
    (m as unknown as { child: ReturnType<typeof import('child_process').spawn> }).child.kill('SIGKILL');
    await expect(pending).rejects.toBeDefined();
    await m.stop();
  });

  it('double stop() is safe', async () => {
    const m = new SidecarManager({ pythonExecutable: PY, moduleEntry: 'khutbah_pipeline', cwd: CWD });
    await m.start();
    await m.stop();
    await m.stop();  // must not throw or hang
  });

  it('rejects start() if already started', async () => {
    const m = new SidecarManager({ pythonExecutable: PY, moduleEntry: 'khutbah_pipeline', cwd: CWD });
    await m.start();
    await expect(m.start()).rejects.toThrow(/already/i);
    await m.stop();
  });
});
