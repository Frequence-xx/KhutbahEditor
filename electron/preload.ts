import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('khutbah', {
  ping: () => ipcRenderer.invoke('ping'),
  pipeline: {
    call: <T = unknown>(method: string, params?: object): Promise<T> =>
      ipcRenderer.invoke('pipeline:call', { method, params }) as Promise<T>,
  },
  dialog: {
    openVideo: () => ipcRenderer.invoke('dialog:openVideo') as Promise<string | null>,
  },
  paths: {
    defaultOutputDir: () => ipcRenderer.invoke('paths:defaultOutputDir') as Promise<string>,
    ensureDir: (dir: string) => ipcRenderer.invoke('paths:ensureDir', dir) as Promise<string>,
  },
});
