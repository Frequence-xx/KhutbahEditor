import { useEffect, useState } from 'react';

export function useIpcOnce<T>(method: string, params?: object) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    window.khutbah.pipeline.call<T>(method, params)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e : new Error(JSON.stringify(e))));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, JSON.stringify(params)]);
  return { data, error };
}
