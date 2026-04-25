import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { SidecarManager } from './sidecar/manager.js';
import { registerIpcHandlers } from './ipc/handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

const BG_BACKGROUND = '#0C1118'; // matches tailwind colors.bg.1

let mainWindow: BrowserWindow | null = null;
let sidecar: SidecarManager | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: BG_BACKGROUND,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Security hardening: deny all new-window requests; route allowed external
  // URLs through the OS browser via shell.openExternal.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow YouTube watch/embed links to open in the default browser; deny everything else.
    try {
      const parsed = new URL(url);
      const allowedHosts = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be']);
      if (parsed.protocol === 'https:' && allowedHosts.has(parsed.hostname)) {
        shell.openExternal(url);
      }
    } catch {
      // ignore — invalid URL → deny
    }
    return { action: 'deny' };
  });

  // Block any in-window navigation away from the local Vite dev server / packaged file.
  // Uses URL.origin comparison (not startsWith) to defeat subdomain and userinfo tricks:
  //   http://localhost:5173.evil.test/ → origin "http://localhost:5173.evil.test" ≠ allowed
  //   http://localhost:5173@evil.test/ → origin "http://evil.test"               ≠ allowed
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      event.preventDefault();
      return;
    }
    if (isDev) {
      // URL.origin includes scheme+host+port — exact match only.
      if (parsed.origin !== 'http://localhost:5173') {
        event.preventDefault();
      }
    } else {
      // file:// origin is "null" in WHATWG URL semantics. Require protocol === 'file:'
      // AND that the path resolves inside the packaged app's dist-web/ folder.
      const distWebPath = path.join(__dirname, '../dist-web');
      if (parsed.protocol !== 'file:' || !parsed.pathname.startsWith(distWebPath)) {
        event.preventDefault();
      }
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist-web/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  sidecar = isDev
    ? new SidecarManager({
        pythonExecutable: path.resolve(
          process.platform === 'win32'
            ? 'python-pipeline/.venv/Scripts/python.exe'
            : 'python-pipeline/.venv/bin/python',
        ),
        moduleEntry: 'khutbah_pipeline',
        cwd: path.resolve('python-pipeline'),
      })
    : new SidecarManager({
        pythonExecutable: path.join(
          process.resourcesPath,
          process.platform === 'win32'
            ? 'python-pipeline/khutbah_pipeline.exe'
            : 'python-pipeline/khutbah_pipeline',
        ),
        moduleEntry: 'khutbah_pipeline',
        cwd: process.resourcesPath,
      });
  try {
    await sidecar.start();
  } catch (err) {
    console.error('[main] failed to start sidecar:', err);
    // Continue anyway so the window opens with a clearly-broken state, rather than the app silently dying.
  }
  registerIpcHandlers(sidecar);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

app.on('before-quit', async () => {
  await sidecar?.stop();
});
