import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SidecarManager } from '../../electron/sidecar/manager';
import path from 'path';

describe('SidecarManager', () => {
  let mgr: SidecarManager;

  beforeAll(async () => {
    // Use the dev Python interpreter (assumes venv at python-pipeline/.venv)
    const py = path.resolve('python-pipeline/.venv/bin/python');
    mgr = new SidecarManager({
      pythonExecutable: py,
      moduleEntry: 'khutbah_pipeline',
      cwd: path.resolve('python-pipeline'),
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
