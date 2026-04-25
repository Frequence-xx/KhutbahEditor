import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { SidecarManager } from './sidecar/manager.js';
import { registerIpcHandlers } from './ipc/handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let sidecar: SidecarManager | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#0C1118',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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
        pythonExecutable: path.resolve('python-pipeline/.venv/bin/python'),
        moduleEntry: 'khutbah_pipeline',
        cwd: path.resolve('python-pipeline'),
      })
    : new SidecarManager({
        pythonExecutable: path.join(process.resourcesPath, 'python-pipeline/khutbah_pipeline'),
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
