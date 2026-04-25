import Store from 'electron-store';

export type YouTubeAccount = {
  /** YouTube channel ID (UCxxxxxx). Primary key. */
  channelId: string;
  /** Channel title (display name). */
  channelTitle: string;
  /** URL of the channel's avatar/thumbnail for UI display. */
  thumbnailUrl: string;
  /** Unix ms when the user signed in to this channel. */
  signedInAt: number;
  /** YouTube playlist ID for auto-add. Optional. */
  defaultPlaylistId?: string;
  /** Human label for the playlist (persisted alongside the ID for UI). */
  defaultPlaylistName?: string;
  /** Include this channel in auto-pilot uploads. */
  autoPublish: boolean;
  /** Per-account override of the global title template. */
  titleTemplateOverride?: string;
  /** Per-account override of the global description template. */
  descriptionTemplateOverride?: string;
  /** Per-account override of the global tags. */
  tagsOverride?: string[];
  /** Per-account override of the global default visibility. */
  defaultVisibilityOverride?: 'public' | 'unlisted' | 'private';
};

const accountStore = new Store<{ accounts: YouTubeAccount[] }>({
  name: 'youtube-accounts',
  defaults: { accounts: [] },
});

export const accounts = {
  /** Return all stored accounts. */
  list(): YouTubeAccount[] {
    return accountStore.get('accounts');
  },
  /** Insert or replace an account record by channelId. */
  upsert(a: YouTubeAccount): void {
    const all = accountStore.get('accounts').filter((x) => x.channelId !== a.channelId);
    accountStore.set('accounts', [...all, a]);
  },
  /** Remove an account record by channelId. */
  remove(channelId: string): void {
    accountStore.set(
      'accounts',
      accountStore.get('accounts').filter((a) => a.channelId !== channelId),
    );
  },
  /** Apply a partial update to an existing account record. Returns the updated record or null if not found. */
  patch(channelId: string, patch: Partial<YouTubeAccount>): YouTubeAccount | null {
    const all = accountStore.get('accounts');
    const idx = all.findIndex((a) => a.channelId === channelId);
    if (idx < 0) return null;
    const updated: YouTubeAccount = { ...all[idx], ...patch };
    all[idx] = updated;
    accountStore.set('accounts', all);
    return updated;
  },
};
