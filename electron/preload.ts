import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('khutbah', {
  ping: () => ipcRenderer.invoke('ping'),
  pipeline: {
    call: <T = unknown>(method: string, params?: object): Promise<T> =>
      ipcRenderer.invoke('pipeline:call', { method, params }) as Promise<T>,
    onProgress: (listener: (params: Record<string, unknown>) => void): (() => void) => {
      const wrapped = (_event: unknown, params: Record<string, unknown>): void => listener(params);
      ipcRenderer.on('pipeline:progress', wrapped);
      return () => { ipcRenderer.off('pipeline:progress', wrapped); };
    },
  },
  dialog: {
    openVideo: () => ipcRenderer.invoke('dialog:openVideo') as Promise<string | null>,
    openAudio: () => ipcRenderer.invoke('dialog:openAudio') as Promise<string | null>,
  },
  paths: {
    defaultOutputDir: () => ipcRenderer.invoke('paths:defaultOutputDir') as Promise<string>,
    ensureDir: (dir: string) => ipcRenderer.invoke('paths:ensureDir', dir) as Promise<string>,
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: object) => ipcRenderer.invoke('settings:set', patch),
  },
  auth: {
    signIn: () => ipcRenderer.invoke('auth:signIn'),
    listAccounts: () => ipcRenderer.invoke('auth:listAccounts'),
    patchAccount: (channelId: string, patch: object) =>
      ipcRenderer.invoke('auth:patchAccount', channelId, patch),
    signOut: (channelId: string) => ipcRenderer.invoke('auth:signOut', channelId),
    accessToken: (channelId: string) =>
      ipcRenderer.invoke('auth:accessToken', channelId),
  },
  notify: (args: { title: string; body: string; clickUrl?: string }) =>
    ipcRenderer.invoke('notify', args),
});
