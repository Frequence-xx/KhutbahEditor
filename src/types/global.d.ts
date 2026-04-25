export {};

import type { AppSettings } from '../../electron/store';
import type { YouTubeAccount } from '../../electron/auth/accounts';

declare global {
  interface Window {
    khutbah?: {
      ping: () => Promise<{ ok: boolean; ts: number }>;
      pipeline: {
        call: <T = unknown>(method: string, params?: object) => Promise<T>;
        onProgress: (listener: (params: {
          stage?: string;
          message?: string;
          progress?: number;     // 0-1
          current?: number;      // bytes
          total?: number;        // bytes
          _request_id?: number;
        }) => void) => () => void;
      };
      dialog: {
        openVideo: () => Promise<string | null>;
        openAudio: () => Promise<string | null>;
      };
      paths: {
        defaultOutputDir: () => Promise<string>;
        ensureDir: (dir: string) => Promise<string>;
        projectCacheDir: (projectId: string) => Promise<string>;
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
