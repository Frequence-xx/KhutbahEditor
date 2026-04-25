export type IpcChannels = {
  'pipeline:call': { method: string; params?: object };
  'pipeline:result': unknown;
};
