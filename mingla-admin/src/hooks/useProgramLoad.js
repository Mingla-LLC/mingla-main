import { useCallback, useEffect, useState } from "react";

/**
 * Issue #3872 — load once, reload on demand, ignore answers that arrive after
 * the page moved on. `fetcher` must be stable (useCallback); a new fetcher
 * loads again. Returns { data, error, loading, reload }.
 */
export function useProgramLoad(fetcher) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let current = true;
    fetcher().then(
      (data) => { if (current) setState({ data, error: null, loading: false }); },
      (error) => { if (current) setState((s) => ({ ...s, error, loading: false })); },
    );
    return () => { current = false; };
  }, [fetcher, tick]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    setTick((t) => t + 1);
  }, []);

  return { ...state, reload };
}
