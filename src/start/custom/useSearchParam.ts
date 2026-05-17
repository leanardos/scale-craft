// PROTOTYPE — tiny URL search param hook so variants are shareable / reload-stable.
import { useCallback, useEffect, useState } from 'react';

export function useSearchParam(
  name: string
): [string | null, (v: string | null) => void] {
  const read = (): string | null => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get(name);
  };

  const [val, setVal] = useState<string | null>(read);

  useEffect(() => {
    const onPop = () => setVal(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const set = useCallback(
    (v: string | null) => {
      const sp = new URLSearchParams(window.location.search);
      if (v === null) sp.delete(name);
      else sp.set(name, v);
      const qs = sp.toString();
      const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
      window.history.replaceState({}, '', url);
      setVal(v);
    },
    [name]
  );

  return [val, set];
}
