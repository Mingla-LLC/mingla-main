// Issue #4130 (Wave 4a) — one server read with its own state:
//   loading -> ready | error, and Retry (refreshing keeps what was shown).
// A failure is kept as an error with the server's reason; it is never turned
// into empty data, so a page can say "Couldn't load" instead of showing 0.
// `load` must be stable (useCallback); a new `load` reads again.
import { useCallback, useEffect, useState } from "react";

export function useServerRead(load) {
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => load())
      .then(
        (data) => { if (live) setState({ status: "ready", data, error: null }); },
        (error) => { if (live) setState((s) => ({ status: "error", data: s.data, error })); }
      );
    return () => { live = false; };
  }, [load, tick]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, status: s.data ? "refreshing" : "loading", error: null }));
    setTick((t) => t + 1);
  }, []);

  return { ...state, retry };
}
