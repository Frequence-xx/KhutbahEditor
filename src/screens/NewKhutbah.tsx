import { useState } from 'react';
import { Button } from '../components/ui/Button';

type Tab = 'youtube' | 'local' | 'dual';

type Props = {
  onPickFile: () => void;
  onYoutubeUrl: (url: string) => void;
  onCancel: () => void;
};

export function NewKhutbah({ onPickFile, onYoutubeUrl, onCancel }: Props) {
  const [tab, setTab] = useState<Tab>('youtube');
  const [url, setUrl] = useState<string>('');
  const valid = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url);

  return (
    <div className="flex-1 p-8 flex items-center justify-center">
      <div className="max-w-xl w-full bg-bg-2 border border-border-strong rounded-lg p-8">
        <h2 className="font-display text-xl tracking-wider text-text-strong mb-1">NEW KHUTBAH</h2>
        <p className="text-text-muted text-sm mb-6">Choose your input source</p>
        <div className="flex gap-2 mb-6">
          {(['youtube', 'local', 'dual'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              disabled={t === 'dual'}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-semibold ${
                tab === t
                  ? 'bg-amber/15 text-amber border border-amber'
                  : 'bg-bg-3 text-text-muted border border-border-strong hover:text-text disabled:opacity-50'
              }`}
            >
              {t === 'youtube' ? 'YouTube URL' : t === 'local' ? 'Local file' : 'Dual file (Phase 4)'}
            </button>
          ))}
        </div>

        {tab === 'youtube' && (
          <div className="space-y-3">
            <input
              className="w-full bg-bg-0 border border-border-strong rounded p-3 text-text font-mono text-sm"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button variant="primary" disabled={!valid} onClick={() => onYoutubeUrl(url)}>
              Start
            </Button>
          </div>
        )}
        {tab === 'local' && (
          <Button variant="primary" onClick={onPickFile}>
            Pick local file…
          </Button>
        )}
        <div className="mt-8 flex justify-end">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
