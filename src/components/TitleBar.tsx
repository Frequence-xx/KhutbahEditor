import { Logo } from './Logo';

type Props = { project?: string; right?: React.ReactNode };
export function TitleBar({ project, right }: Props) {
  return (
    <header className="flex items-center gap-4 px-4 py-3 bg-gradient-to-b from-bg-3 to-bg-4 border-b border-border-strong">
      <Logo className="h-16 w-auto" />
      <span className="font-display text-lg tracking-wider text-text-strong">KHUTBAH EDITOR</span>
      {project && <span className="text-text-muted text-sm">— {project}</span>}
      <div className="ml-auto flex items-center gap-3 text-text-muted text-sm">{right}</div>
    </header>
  );
}
