import { ipcMain, dialog } from 'electron';
import { SidecarManager } from '../sidecar/manager.js';

export function registerIpcHandlers(sidecar: SidecarManager): void {
  ipcMain.handle('pipeline:call', async (_e, args: { method: string; params?: object }) => {
    return sidecar.call(args.method, args.params);
  });
  ipcMain.handle('ping', () => ({ ok: true, ts: Date.now() }));
  ipcMain.handle('dialog:openVideo', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'flv', 'wmv'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return r.canceled ? null : r.filePaths[0];
  });
}
