import { useState, useEffect, useCallback } from 'react';
import { Button } from '../components/ui/Button';
import type { YouTubeAccount } from '../../electron/auth/accounts';

type Playlist = { id: string; snippet: { title: string } };

type Props = { onError: (msg: string) => void };

export function AccountsSection({ onError }: Props) {
  const [accounts, setAccounts] = useState<YouTubeAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [playlistsCache, setPlaylistsCache] = useState<Record<string, Playlist[]>>({});

  const refresh = useCallback(async () => {
    if (!window.khutbah) return;
    setLoading(true);
    try {
      const list = await window.khutbah.auth.listAccounts();
      setAccounts(list);
    } catch (e) {
      onError(formatErr(e));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function addAccount() {
    if (!window.khutbah || busy) return;
    setBusy(true);
    try {
      await window.khutbah.auth.signIn();
      await refresh();
    } catch (e) {
      onError(`Sign-in failed: ${formatErr(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function signOutAccount(channelId: string) {
    if (!window.khutbah || busy) return;
    if (!confirm(`Sign out of this account?`)) return;
    setBusy(true);
    try {
      await window.khutbah.auth.signOut(channelId);
      await refresh();
    } catch (e) {
      onError(`Sign-out failed: ${formatErr(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function setPatch(channelId: string, p: Partial<YouTubeAccount>) {
    if (!window.khutbah) return;
    try {
      const updated = await window.khutbah.auth.patchAccount(channelId, p);
      if (updated) {
        setAccounts((prev) => prev.map((a) => (a.channelId === channelId ? updated : a)));
      }
    } catch (e) {
      onError(`Update failed: ${formatErr(e)}`);
    }
  }

  async function ensurePlaylistsLoaded(channelId: string): Promise<void> {
    if (playlistsCache[channelId] || !window.khutbah) return;
    try {
      const tk = await window.khutbah.auth.accessToken(channelId);
      const lists = await window.khutbah.pipeline.call<Playlist[]>('playlists.list', {
        access_token: tk.accessToken,
      });
      setPlaylistsCache((prev) => ({ ...prev, [channelId]: lists }));
    } catch (e) {
      // Non-fatal; user can still type a name freehand
      onError(`Could not load playlists: ${formatErr(e)}`);
    }
  }

  if (loading) return <div className="text-text-muted text-sm">Loading accounts…</div>;

  return (
    <div className="space-y-3">
      {accounts.length === 0 ? (
        <div className="text-text-muted text-sm">No signed-in accounts.</div>
      ) : (
        accounts.map((a) => (
          <AccountRow
            key={a.channelId}
            account={a}
            playlists={playlistsCache[a.channelId]}
            busy={busy}
            onLoadPlaylists={() => void ensurePlaylistsLoaded(a.channelId)}
            onSignOut={() => void signOutAccount(a.channelId)}
            onPatch={(p) => void setPatch(a.channelId, p)}
          />
        ))
      )}
      <Button variant="primary" onClick={() => void addAccount()} disabled={busy}>
        + Add account
      </Button>
    </div>
  );
}

function AccountRow({
  account,
  playlists,
  busy,
  onLoadPlaylists,
  onSignOut,
  onPatch,
}: {
  account: YouTubeAccount;
  playlists?: Playlist[];
  busy: boolean;
  onLoadPlaylists: () => void;
  onSignOut: () => void;
  onPatch: (p: Partial<YouTubeAccount>) => void;
}) {
  const [playlistInput, setPlaylistInput] = useState<string>(
    account.defaultPlaylistName ?? account.defaultPlaylistId ?? '',
  );

  // Sync local state if the account record changes externally
  useEffect(() => {
    setPlaylistInput(account.defaultPlaylistName ?? account.defaultPlaylistId ?? '');
  }, [account.defaultPlaylistName, account.defaultPlaylistId]);

  function applyPlaylist() {
    const trimmed = playlistInput.trim();
    if (!trimmed) {
      onPatch({ defaultPlaylistName: undefined, defaultPlaylistId: undefined });
      return;
    }
    if (trimmed.startsWith('PL')) {
      onPatch({ defaultPlaylistId: trimmed, defaultPlaylistName: undefined });
    } else {
      onPatch({ defaultPlaylistName: trimmed, defaultPlaylistId: undefined });
    }
  }

  return (
    <div className="bg-bg-3 border border-border-strong rounded p-3 space-y-2">
      <div className="flex items-center gap-3">
        {account.thumbnailUrl ? (
          <img src={account.thumbnailUrl} alt="" className="w-10 h-10 rounded-full" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-bg-0" />
        )}
        <div className="flex-1">
          <div className="text-text-strong font-semibold text-sm">{account.channelTitle}</div>
          <div className="text-text-muted text-xs font-mono">{account.channelId}</div>
        </div>
        <Button variant="ghost" onClick={onSignOut} disabled={busy}>Sign out</Button>
      </div>

      <label className="flex items-center gap-2 text-xs text-text-muted">
        <input
          type="checkbox"
          checked={account.autoPublish}
          onChange={(e) => onPatch({ autoPublish: e.target.checked })}
        />
        Auto-publish (include in auto-pilot uploads)
      </label>

      <div>
        <label className="block text-xs text-text-muted mb-1">
          Default playlist (name or ID; use a PL… ID directly or a free-form name to lookup/create)
        </label>
        <div className="flex gap-2">
          <input
            list={`pl-${account.channelId}`}
            className="flex-1 bg-bg-0 border border-border-strong rounded p-2 text-text text-sm"
            value={playlistInput}
            onFocus={onLoadPlaylists}
            onChange={(e) => setPlaylistInput(e.target.value)}
            onBlur={applyPlaylist}
            placeholder="e.g. Vrijdagkhutbah 2026"
          />
          <Button variant="ghost" onClick={applyPlaylist}>Save</Button>
        </div>
        {playlists && playlists.length > 0 && (
          <datalist id={`pl-${account.channelId}`}>
            {playlists.map((p) => (
              <option key={p.id} value={p.snippet.title} />
            ))}
          </datalist>
        )}
      </div>
    </div>
  );
}

function formatErr(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
