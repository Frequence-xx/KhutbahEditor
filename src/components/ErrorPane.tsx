export function ErrorPane({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-12 gap-4">
      <h2 className="font-display text-xl text-red-400">Something went wrong</h2>
      <p className="text-slate-300 text-sm max-w-md text-center">{message}</p>
      <button onClick={onRetry} className="px-5 py-2 bg-amber-400 text-slate-900 rounded font-semibold">
        Retry
      </button>
    </div>
  );
}
