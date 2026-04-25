import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('khutbah', {
  ping: () => ipcRenderer.invoke('ping'),
});
