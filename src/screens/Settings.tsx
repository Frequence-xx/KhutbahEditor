import { useEffect } from 'react';
import { useSettings } from '../store/settings';
import { Button } from '../components/ui/Button';

type Props = { onBack: () => void };

export function Settings({ onBack }: Props) {
  const { settings, load, patch } = useSettings();
  useEffect(() => {
    load();
  }, [load]);

  if (!settings) return <div className="p-8 text-text-muted">Loading…</div>;

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" onClick={onBack}>← Back</Button>
          <h2 className="font-display text-2xl tracking-wider text-text-strong">SETTINGS</h2>
        </div>

        <Section title="Workflow">
          <Toggle
            label="Auto-pilot"
            desc="Skip the editor for high-confidence detections; auto-export and upload"
            value={settings.autoPilot}
            onChange={(v) => patch({ autoPilot: v })}
          />
        </Section>

        <Section title="Brand & metadata">
          <Field
            label="Khatib name (optional)"
            value={settings.khatibName}
            onChange={(v) => patch({ khatibName: v })}
            placeholder="e.g. Imam Mohammed"
          />
          <Field
            label="Title template"
            value={settings.titleTemplate}
            onChange={(v) => patch({ titleTemplate: v })}
            mono
          />
          <TextareaField
            label="Description template"
            value={settings.descriptionTemplate}
            onChange={(v) => patch({ descriptionTemplate: v })}
            rows={6}
            mono
          />
        </Section>

        <Section title="Audio normalization">
          <NumberField label="Target LUFS" value={settings.audioTargetLufs} onChange={(v) => patch({ audioTargetLufs: v })} />
          <NumberField label="Target true peak (dBTP)" value={settings.audioTargetTp} onChange={(v) => patch({ audioTargetTp: v })} />
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h3 className="text-text-muted uppercase tracking-wider text-xs font-bold mb-3">{title}</h3>
      <div className="space-y-3 bg-bg-2 border border-border-strong rounded-lg p-4">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-text-muted text-xs">{label}</span>
      <input
        className={`w-full mt-1 bg-bg-0 border border-border-strong rounded p-2 text-text ${mono ? 'font-mono text-xs' : 'text-sm'}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  rows,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-text-muted text-xs">{label}</span>
      <textarea
        rows={rows}
        className={`w-full mt-1 bg-bg-0 border border-border-strong rounded p-2 text-text ${mono ? 'font-mono text-xs' : 'text-sm'}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-text-muted text-xs">{label}</span>
      <input
        type="number"
        step={0.1}
        className="w-32 mt-1 bg-bg-0 border border-border-strong rounded p-2 text-text text-sm"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Toggle({
  label,
  desc,
  value,
  onChange,
}: {
  label: string;
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => onChange(!value)}
        className={`w-9 h-5 rounded-full relative transition-colors ${value ? 'bg-amber/40' : 'bg-border-strong'}`}
        aria-pressed={value}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${value ? 'left-4 bg-amber' : 'left-0.5 bg-text-muted'}`}
        />
      </button>
      <div>
        <div className="text-text-strong text-sm font-semibold">{label}</div>
        <div className="text-text-muted text-xs">{desc}</div>
      </div>
    </div>
  );
}
