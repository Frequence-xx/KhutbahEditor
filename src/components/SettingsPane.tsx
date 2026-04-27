import { useEffect, useState } from 'react';
import { useSettings } from '../store/settings';

type Account = { channelId: string; channelTitle: string };

export function SettingsPane() {
  const settings = useSettings((s) => s.settings);
  const load = useSettings((s) => s.load);
  const patch = useSettings((s) => s.patch);
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    void load();
    void window.khutbah?.auth.listAccounts().then((a) => setAccounts(a as Account[]));
  }, [load]);

  const refreshAccounts = (): void => {
    void window.khutbah?.auth.listAccounts().then((a) => setAccounts(a as Account[]));
  };

  return (
    <div className="h-full p-4 flex flex-col gap-4 overflow-auto">
      <h2 className="font-display text-xl text-amber-glow">Settings</h2>

      <div>
        <label htmlFor="device" className="text-sm text-text block mb-1">
          Compute device
        </label>
        <select
          id="device"
          value={settings?.computeDevice ?? 'auto'}
          onChange={(e) =>
            void patch({ computeDevice: e.target.value as 'auto' | 'cpu' | 'cuda' })
          }
          className="w-full px-3 py-2 bg-bg-1 border border-border-strong text-text-strong rounded"
        >
          <option value="auto">Auto</option>
          <option value="cpu">CPU</option>
          <option value="cuda">CUDA (GPU)</option>
        </select>
      </div>

      <div>
        <label htmlFor="outdir" className="text-sm text-text block mb-1">
          Output directory
        </label>
        <input
          id="outdir"
          type="text"
          value={settings?.outputDir ?? ''}
          onChange={(e) => void patch({ outputDir: e.target.value })}
          placeholder="Path where part1.mp4 / part2.mp4 are written"
          className="w-full px-3 py-2 bg-bg-1 border border-border-strong text-text-strong rounded"
        />
      </div>

      <div>
        <h3 className="text-sm text-text mb-2">YouTube accounts</h3>
        <ul className="space-y-1">
          {accounts.map((a) => (
            <li
              key={a.channelId}
              className="flex items-center justify-between bg-bg-3 px-3 py-2 rounded"
            >
              <span className="text-text">{a.channelTitle}</span>
              <button
                onClick={async () => {
                  await window.khutbah?.auth.signOut(a.channelId);
                  refreshAccounts();
                }}
                className="text-xs text-text-dim hover:text-danger"
              >
                Sign out
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={async () => {
            await window.khutbah?.auth.signIn();
            refreshAccounts();
          }}
          className="mt-2 px-3 py-2 bg-amber text-bg-1 rounded font-semibold"
        >
          Sign in
        </button>
      </div>
    </div>
  );
}
