import { useEffect } from 'react';
import { useToasts } from '../store/toasts';

const AUTO_DISMISS_MS = 5000;

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  useEffect(() => {
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), AUTO_DISMISS_MS));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          onClick={() => dismiss(t.id)}
          className={`px-4 py-2 rounded shadow-lg cursor-pointer text-sm ${t.kind === 'success' ? 'bg-green text-bg-1' : 'bg-danger text-white'}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
