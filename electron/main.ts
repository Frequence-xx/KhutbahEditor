import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import electronUpdater from 'electron-updater';
import { SidecarManager } from './sidecar/manager.js';
import { registerIpcHandlers } from './ipc/handlers.js';

const { autoUpdater } = electronUpdater;

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
      // Use pathToFileURL so both sides use forward-slash pathnames on all platforms
      // (path.join returns backslashes on Windows, but URL.pathname is always forward-slash).
      if (parsed.protocol !== 'file:') {
        event.preventDefault();
        return;
      }
      // Use a trailing slash on the prefix so sibling directories like
      // `dist-web2/` or `dist-web-evil/` can't pass the prefix check.
      const distWebPathname = pathToFileURL(path.join(__dirname, '../dist-web')).pathname;
      const allowedPrefix = distWebPathname.endsWith('/') ? distWebPathname : distWebPathname + '/';
      if (parsed.pathname !== distWebPathname && !parsed.pathname.startsWith(allowedPrefix)) {
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

function buildSidecarEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  // Augment PATH so the Python sidecar's shutil.which() finds bundled binaries.
  // In dev, fall back to the system PATH (assume system ffmpeg/yt-dlp exist).
  if (!isDev) {
    // electron-builder.json copies `resources/bin/${os}/${arch}` (the
    // platform-specific subdirectory) directly to `<resourcesPath>/bin/`,
    // flattening the structure. So PATH points at `<resourcesPath>/bin/`,
    // NOT a nested `bin/<OS>/<arch>/` subpath.
    const binDir = path.join(process.resourcesPath, 'bin');
    const pathSep = process.platform === 'win32' ? ';' : ':';
    env.PATH = `${binDir}${pathSep}${process.env.PATH ?? ''}`;
  }

  // Tell the Python sidecar where the bundled Whisper model lives.
  // Packaged: <resourcesPath>/models/whisper-large-v3/ (per electron-builder.json)
  // Dev: <repo>/resources/models/whisper-large-v3/ (downloaded by fetch-resources.sh)
  env.KHUTBAH_MODEL_DIR = isDev
    ? path.resolve('resources/models/whisper-large-v3')
    : path.join(process.resourcesPath, 'models', 'whisper-large-v3');

  return env;
}

app.whenReady().then(async () => {
  const sidecarEnv = buildSidecarEnv();

  sidecar = isDev
    ? new SidecarManager({
        pythonExecutable: path.resolve(
          process.platform === 'win32'
            ? 'python-pipeline/.venv/Scripts/python.exe'
            : 'python-pipeline/.venv/bin/python',
        ),
        moduleEntry: 'khutbah_pipeline',
        cwd: path.resolve('python-pipeline'),
        env: sidecarEnv,
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
        env: sidecarEnv,
      });
  try {
    await sidecar.start();
  } catch (err) {
    console.error('[main] failed to start sidecar:', err);
    // Continue anyway so the window opens with a clearly-broken state, rather than the app silently dying.
  }
  registerIpcHandlers(sidecar);
  createWindow();
  if (!isDev) {
    autoUpdater.checkForUpdatesAndNotify().catch((e) => {
      console.error('[updater] check failed:', e);
    });
  }
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
