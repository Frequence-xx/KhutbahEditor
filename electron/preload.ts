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
});
