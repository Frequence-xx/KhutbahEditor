import { useEffect, useState } from 'react';
import type { Project } from '../store/projects';
import type { UploadOpts } from '../jobs/types';

type Account = { channelId: string; channelTitle: string };
type Playlist = { id: string; title: string };

export type UploadPaneProps = {
  project: Project;
  projectName: string;
  onStart: (opts: UploadOpts) => void;
};

export function UploadPane({ project, projectName, onStart }: UploadPaneProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [channelId, setChannelId] = useState<string>('');
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistId, setPlaylistId] = useState<string>('');
  const [title, setTitle] = useState(projectName || 'Khutbah');
  const [thumbnailPath, setThumbnailPath] = useState<string>('');

  useEffect(() => {
    void window.khutbah?.auth.listAccounts().then((a) => {
      const list = a as unknown as Account[];
      setAccounts(list);
      if (list[0]) setChannelId(list[0].channelId);
    });
  }, []);

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    (async () => {
      try {
        const { accessToken } = await window.khutbah!.auth.accessToken(channelId);
        if (cancelled) return;
        const res = await window.khutbah!.pipeline.call<
          Array<{ id: string; snippet?: { title?: string }; title?: string }>
        >('playlists.list', { access_token: accessToken });
        if (cancelled) return;
        setPlaylists(
          res.map((p) => ({
            id: p.id,
            title: p.snippet?.title ?? p.title ?? p.id,
          })),
        );
      } catch {
        if (!cancelled) setPlaylists([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const inFlight = project.runState === 'uploading';

  return (
    <div className="h-full p-4 flex flex-col gap-3 overflow-auto">
      <h2 className="font-display text-xl text-amber-glow">Upload to YouTube</h2>

      <label className="text-sm text-text">Account</label>
      <select
        value={channelId}
        onChange={(e) => setChannelId(e.target.value)}
        className="px-3 py-2 bg-bg-1 border border-border-strong text-text-strong rounded"
      >
        {accounts.map((a) => (
          <option key={a.channelId} value={a.channelId}>
            {a.channelTitle}
          </option>
        ))}
      </select>

      <label className="text-sm text-text">Title</label>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="px-3 py-2 bg-bg-1 border border-border-strong text-text-strong rounded"
      />

      <label className="text-sm text-text">Playlist (optional)</label>
      <select
        value={playlistId}
        onChange={(e) => setPlaylistId(e.target.value)}
        className="px-3 py-2 bg-bg-1 border border-border-strong text-text-strong rounded"
      >
        <option value="">— none —</option>
        {playlists.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>

      <label className="text-sm text-text">Thumbnail (optional)</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={thumbnailPath}
          readOnly
          placeholder="No thumbnail"
          className="flex-1 px-3 py-2 bg-bg-1 border border-border-strong text-text-strong rounded"
        />
        <button
          onClick={async () => {
            const path = await window.khutbah?.dialog.openVideo();
            if (path) setThumbnailPath(path);
          }}
          className="px-3 py-2 bg-bg-4 text-text-strong rounded"
        >
          Browse
        </button>
      </div>

      <div className="flex justify-end mt-4">
        <button
          disabled={inFlight || !channelId}
          onClick={() =>
            onStart({
              channelId,
              playlistId: playlistId || undefined,
              title,
              thumbnailPath: thumbnailPath || undefined,
            })
          }
          className="px-4 py-2 bg-green text-bg-1 rounded font-semibold disabled:opacity-50"
        >
          {inFlight ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {inFlight && project.progress !== undefined && (
        <p className="text-text text-sm">Progress: {project.progress}%</p>
      )}
    </div>
  );
}
