import { ipcMain, dialog, Notification, shell, BrowserWindow } from 'electron';
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
  // Forward sidecar progress notifications to all renderer webContents
  sidecar.onNotification((method, params) => {
    if (method === 'progress') {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('pipeline:progress', params);
        }
      }
    }
  });

  ipcMain.handle('pipeline:call', async (_e, args: { method: string; params?: object }) => {
    try {
      return await sidecar.call(args.method, args.params);
    } catch (rpcErr) {
      // The Python sidecar emits JSON-RPC errors as {code, message, data}; if
      // we let those propagate as-is, Electron's IPC serializer stringifies
      // them as `[object Object]` in the renderer. Convert to a proper Error
      // with a meaningful message + the RPC code on the cause.
      if (rpcErr && typeof rpcErr === 'object' && 'message' in rpcErr) {
        const r = rpcErr as { code?: number; message: unknown; data?: unknown };
        const wrapped = new Error(String(r.message));
        // Attach metadata for the renderer to introspect if it wants:
        (wrapped as Error & { rpcCode?: number; rpcData?: unknown }).rpcCode = r.code;
        (wrapped as Error & { rpcCode?: number; rpcData?: unknown }).rpcData = r.data;
        throw wrapped;
      }
      throw rpcErr;
    }
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
  ipcMain.handle('dialog:openAudio', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus'] },
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
  ipcMain.handle('paths:projectCacheDir', async (_e, projectId: string) => {
    // Per-project cache for derived assets that aren't worth backing up
    // (filmstrip thumbnails, scratch files). Lives under Electron's
    // userData so it gets cleaned with the rest of app state.
    const { app } = await import('electron');
    const dir = path.join(app.getPath('userData'), 'project-cache', projectId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
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
  const NOTIFY_ALLOWED_HOSTS = new Set([
    'www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be',
  ]);

  ipcMain.handle('notify', (_e, args: { title: string; body: string; clickUrl?: string }) => {
    if (!Notification.isSupported()) {
      console.warn('[notify] Native notifications not supported on this OS');
      return;
    }
    const n = new Notification({ title: args.title, body: args.body });
    if (args.clickUrl) {
      let validUrl: URL | null = null;
      try {
        const parsed = new URL(args.clickUrl);
        if (parsed.protocol === 'https:' && NOTIFY_ALLOWED_HOSTS.has(parsed.hostname)) {
          validUrl = parsed;
        }
      } catch {
        // Invalid URL — ignore.
      }
      if (validUrl) {
        const safeUrl = validUrl.toString();
        n.on('click', () => {
          shell.openExternal(safeUrl);
        });
      }
    }
    n.show();
  });
}
