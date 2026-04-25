export {};

import type { AppSettings } from '../../electron/store';
import type { YouTubeAccount } from '../../electron/auth/accounts';

declare global {
  interface Window {
    khutbah?: {
      ping: () => Promise<{ ok: boolean; ts: number }>;
      pipeline: { call: <T = unknown>(method: string, params?: object) => Promise<T> };
      dialog: { openVideo: () => Promise<string | null> };
      paths: {
        defaultOutputDir: () => Promise<string>;
        ensureDir: (dir: string) => Promise<string>;
      };
      settings: {
        get: () => Promise<AppSettings>;
        set: (patch: Partial<AppSettings>) => Promise<AppSettings>;
      };
      auth: {
        signIn: () => Promise<{
          accessToken: string;
          expiresAt: number;
          addedAccounts: YouTubeAccount[];
        }>;
        listAccounts: () => Promise<YouTubeAccount[]>;
        patchAccount: (
          channelId: string,
          patch: Partial<YouTubeAccount>,
        ) => Promise<YouTubeAccount | null>;
        signOut: (channelId: string) => Promise<void>;
        accessToken: (channelId: string) => Promise<{ accessToken: string; expiresAt: number }>;
      };
      notify: (args: { title: string; body: string; clickUrl?: string }) => Promise<void>;
    };
  }
}
