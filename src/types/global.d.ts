export {};
declare global {
  interface Window {
    khutbah?: {
      ping: () => Promise<{ ok: boolean; ts: number }>;
      pipeline: { call: <T = unknown>(method: string, params?: object) => Promise<T> };
      dialog: { openVideo: () => Promise<string | null> };
    };
  }
}
