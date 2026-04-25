import { Logo } from '../components/Logo';
import { Button } from '../components/ui/Button';

type Props = { onSignIn: () => void; onSkip: () => void };

export function Welcome({ onSignIn, onSkip }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <Logo className="h-24 mx-auto mb-6" />
        <h1 className="font-display text-3xl tracking-widest text-text-strong mb-3">WELCOME</h1>
        <p className="text-text-muted mb-8">
          Sign in with your YouTube account to enable one-click publishing.
        </p>
        <div className="flex gap-3 justify-center">
          <Button variant="ghost" onClick={onSkip}>Skip for now</Button>
          <Button variant="upload" onClick={onSignIn}>Sign in with Google</Button>
        </div>
      </div>
    </div>
  );
}
