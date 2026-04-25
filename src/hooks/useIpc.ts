import { useEffect, useState } from 'react';

export function useIpcOnce<T>(method: string, params?: object) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (!window.khutbah) return; // no Electron preload (e.g. Playwright against Vite directly)
    window.khutbah.pipeline.call<T>(method, params)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(JSON.stringify(e))));
  }, [method, JSON.stringify(params)]); // params serialized to avoid referential churn
  return { data, error };
}
