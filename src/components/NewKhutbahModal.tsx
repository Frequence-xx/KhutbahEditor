import { useState } from 'react';

type Tab = 'youtube' | 'local' | 'dual';

export type NewKhutbahModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmitYoutube: (url: string) => void;
  onSubmitLocal: (path: string) => void;
  onSubmitDual: (audioPath: string, videoPath: string) => void;
};

export function NewKhutbahModal({
  open, onClose, onSubmitYoutube, onSubmitLocal, onSubmitDual,
}: NewKhutbahModalProps) {
  const [tab, setTab] = useState<Tab>('youtube');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [dualAudio, setDualAudio] = useState('');
  const [dualVideo, setDualVideo] = useState('');

  if (!open) return null;

  const submit = () => {
    if (tab === 'youtube' && youtubeUrl) onSubmitYoutube(youtubeUrl);
    if (tab === 'local' && localPath) onSubmitLocal(localPath);
    if (tab === 'dual' && dualAudio && dualVideo) onSubmitDual(dualAudio, dualVideo);
  };

  const pickLocal = async () => {
    const path = await window.khutbah?.dialog.openVideo();
    if (path) setLocalPath(path);
  };

  const pickDualAudio = async () => {
    const path = await window.khutbah?.dialog.openAudio();
    if (path) setDualAudio(path);
  };

  const pickDualVideo = async () => {
    const path = await window.khutbah?.dialog.openVideo();
    if (path) setDualVideo(path);
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      data-testid="modal-backdrop"
      onClick={onClose}
    >
      <div className="bg-bg-3 rounded-lg p-6 w-[480px]" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-xl text-amber-glow mb-4">New khutbah</h2>
        <div role="tablist" className="flex gap-2 mb-4">
          <button
            role="tab"
            aria-selected={tab === 'youtube'}
            onClick={() => setTab('youtube')}
            className={tab === 'youtube' ? 'px-3 py-1 bg-amber text-bg-1 rounded' : 'px-3 py-1 bg-bg-4 text-text rounded'}
          >YouTube</button>
          <button
            role="tab"
            aria-selected={tab === 'local'}
            onClick={() => setTab('local')}
            className={tab === 'local' ? 'px-3 py-1 bg-amber text-bg-1 rounded' : 'px-3 py-1 bg-bg-4 text-text rounded'}
          >Local file</button>
          <button
            role="tab"
            aria-selected={tab === 'dual'}
            onClick={() => setTab('dual')}
            className={tab === 'dual' ? 'px-3 py-1 bg-amber text-bg-1 rounded' : 'px-3 py-1 bg-bg-4 text-text rounded'}
          >Dual file</button>
        </div>

        {tab === 'youtube' && (
          <input
            type="url"
            placeholder="YouTube URL"
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            className="w-full px-3 py-2 bg-bg-1 border border-border-strong text-text-strong rounded"
          />
        )}

        {tab === 'local' && (
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="No file selected"
              value={localPath}
              readOnly
              className="flex-1 px-3 py-2 bg-bg-1 border border-border-strong text-text-strong rounded"
            />
            <button onClick={pickLocal} className="px-3 py-2 bg-bg-4 text-text-strong rounded">Browse</button>
          </div>
        )}

        {tab === 'dual' && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input type="text" placeholder="Audio file" value={dualAudio} readOnly className="flex-1 px-3 py-2 bg-bg-1 border border-border-strong text-text-strong rounded" />
              <button onClick={pickDualAudio} className="px-3 py-2 bg-bg-4 text-text-strong rounded">Browse</button>
            </div>
            <div className="flex gap-2">
              <input type="text" placeholder="Video file" value={dualVideo} readOnly className="flex-1 px-3 py-2 bg-bg-1 border border-border-strong text-text-strong rounded" />
              <button onClick={pickDualVideo} className="px-3 py-2 bg-bg-4 text-text-strong rounded">Browse</button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-text hover:text-text-strong">Cancel</button>
          <button onClick={submit} className="px-4 py-2 bg-green text-bg-1 rounded font-semibold">Start</button>
        </div>
      </div>
    </div>
  );
}
