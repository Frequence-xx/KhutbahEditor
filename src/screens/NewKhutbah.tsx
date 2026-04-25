import { Button } from '../components/ui/Button';

type Props = { onPickFile: () => void; onCancel: () => void };
export function NewKhutbah({ onPickFile, onCancel }: Props) {
  return (
    <div className="flex-1 p-8 flex items-center justify-center">
      <div className="max-w-xl w-full bg-bg-2 border border-border-strong rounded-lg p-8">
        <h2 className="font-display text-xl tracking-wider text-text-strong mb-1">NEW KHUTBAH</h2>
        <p className="text-text-muted text-sm mb-8">Choose your input source</p>
        <div className="space-y-3">
          <button onClick={onPickFile}
            className="w-full bg-bg-3 border border-border-strong p-6 rounded-md text-left hover:border-amber transition">
            <div className="font-semibold text-text-strong">Pick local file</div>
            <div className="text-text-muted text-sm mt-1">MP4, MOV, MKV, WebM, etc.</div>
          </button>
          <div className="bg-bg-3 border border-border-strong p-6 rounded-md text-left opacity-50">
            <div className="font-semibold text-text-muted">YouTube URL</div>
            <div className="text-text-muted text-sm mt-1">Coming in Phase 3</div>
          </div>
          <div className="bg-bg-3 border border-border-strong p-6 rounded-md text-left opacity-50">
            <div className="font-semibold text-text-muted">Dual file (video + separate audio)</div>
            <div className="text-text-muted text-sm mt-1">Coming in Phase 4</div>
          </div>
        </div>
        <div className="mt-8 flex justify-end">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
