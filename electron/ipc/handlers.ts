import { ipcMain, dialog } from 'electron';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { SidecarManager } from '../sidecar/manager.js';
import { settingsStore, type AppSettings } from '../store.js';
import {
  signInWithGoogle,
  ensureAccessToken,
  signOutAccount,
  listAccounts,
} from '../auth/youtube-oauth.js';
import { accounts as accountsStore, type YouTubeAccount } from '../auth/accounts.js';

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
  ipcMain.handle('paths:defaultOutputDir', () => {
    const home = os.homedir();
    const today = new Date().toISOString().slice(0, 10);
    const base = process.platform === 'darwin' ? 'Movies' : 'Videos';
    return path.join(home, base, 'KhutbahEditor', today);
  });
  ipcMain.handle('paths:ensureDir', async (_e, dir: string) => {
    await fs.mkdir(dir, { recursive: true });
    return dir;
  });
  ipcMain.handle('settings:get', () => settingsStore.store);
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    for (const [k, v] of Object.entries(patch)) {
      settingsStore.set(k as keyof AppSettings, v as never);
    }
    return settingsStore.store;
  });
  ipcMain.handle('auth:signIn', () => signInWithGoogle());
  ipcMain.handle('auth:listAccounts', () => listAccounts());
  ipcMain.handle(
    'auth:patchAccount',
    (_e, channelId: string, patch: Partial<YouTubeAccount>) =>
      accountsStore.patch(channelId, patch),
  );
  ipcMain.handle('auth:signOut', (_e, channelId: string) => signOutAccount(channelId));
  ipcMain.handle('auth:accessToken', (_e, channelId: string) => ensureAccessToken(channelId));
}
