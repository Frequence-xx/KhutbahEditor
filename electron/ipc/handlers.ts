import { ipcMain } from 'electron';
import { SidecarManager } from '../sidecar/manager.js';

export function registerIpcHandlers(sidecar: SidecarManager): void {
  ipcMain.handle('pipeline:call', async (_e, args: { method: string; params?: object }) => {
    return sidecar.call(args.method, args.params);
  });
  ipcMain.handle('ping', () => ({ ok: true, ts: Date.now() }));
}
