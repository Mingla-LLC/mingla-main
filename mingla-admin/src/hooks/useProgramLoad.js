import { useCallback, useEffect, useRef, useState } from "react";
import * as pageReturn from "../lib/pageReturn";
import { createPoller, tabPollGate } from "../lib/pollGate";

/** #4430 item 7: the Admin gig and dispute queues reload on page return and every 60 s while visible. */
export const PROGRAM_QUEUE_REFRESH = Object.freeze({ refetchOnFocus: true, intervalMs: 60_000, key: "program-queue" });

/**
 * Issue #3872 — load once, reload on demand, ignore answers that arrive after
 * the page moved on. `fetcher` must be stable (useCallback); a new fetcher
 * loads again. Returns { data, error, loading, reload }.
 *
 * #4430 item 7: with `{ refetchOnFocus: true, intervalMs, key }` it also
 * reloads when the page comes back (the one shared lib/pageReturn signal,
 * #4423) and every `intervalMs` while the tab is visible, through the tab's
 * poll gate. A hidden tab sends nothing, and a background reload keeps the
 * current rows on screen (no loading flash; a failure keeps the rows).
 */
export function useProgramLoad(fetcher, options = {}) {
  const { refetchOnFocus = false, intervalMs = 0, key = "program-load" } = options;
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const quiet = useRef(false);

  useEffect(() => {
    let current = true;
    const background = quiet.current;
    quiet.current = false;
    const gateKey = `program:${key}`;
    if (background) tabPollGate.start(gateKey, { background: true });
    fetcher().then(
      (data) => {
        if (background) tabPollGate.settle(gateKey, { ok: true }, { background: true });
        if (current) setState({ data, error: null, loading: false });
      },
      (error) => {
        if (background) tabPollGate.settle(gateKey, { ok: false, status: error?.status, code: error?.code, error }, { background: true });
        // A quiet reload that fails keeps what is on screen.
        if (current) setState((s) => (background && s.data ? { ...s, loading: false } : { ...s, error, loading: false }));
      },
    );
    return () => { current = false; };
  }, [fetcher, tick, key]);

  useEffect(() => {
    if (!refetchOnFocus) return undefined;
    const gateKey = `program:${key}`;
    const poller = createPoller({
      initial: false,
      intervalMs,
      pageReturn,
      refresh: () => {
        if (tabPollGate.why(gateKey)) {
          tabPollGate.allow(gateKey); // counts the skip
          return { skipped: true };
        }
        quiet.current = true;
        setTick((t) => t + 1);
        return { skipped: false };
      },
    });
    poller.start();
    return () => poller.stop();
  }, [refetchOnFocus, intervalMs, key]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    setTick((t) => t + 1);
  }, []);

  return { ...state, reload };
}
