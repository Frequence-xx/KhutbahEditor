import keytar from 'keytar';

const SERVICE = 'nl.alhimmah.khutbaheditor';
const PREFIX = 'youtube-refresh-token:';

export const tokens = {
  /** Get the refresh token for a YouTube channel, or null if missing. */
  async get(channelId: string): Promise<string | null> {
    return keytar.getPassword(SERVICE, PREFIX + channelId);
  },
  /** Store a refresh token for a channel. Replaces any existing entry. */
  async set(channelId: string, token: string): Promise<void> {
    await keytar.setPassword(SERVICE, PREFIX + channelId, token);
  },
  /** Delete a channel's refresh token. */
  async clear(channelId: string): Promise<void> {
    await keytar.deletePassword(SERVICE, PREFIX + channelId);
  },
  /** List all channel IDs that have a stored refresh token. */
  async listChannelIds(): Promise<string[]> {
    const all = await keytar.findCredentials(SERVICE);
    return all
      .filter((c) => c.account.startsWith(PREFIX))
      .map((c) => c.account.slice(PREFIX.length));
  },
};
