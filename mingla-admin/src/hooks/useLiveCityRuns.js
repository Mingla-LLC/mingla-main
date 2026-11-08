/**
 * useLiveCityRuns: issue #4276 Live runs, shaped on useActiveRunsPoller.
 *
 * Reads admin_city_pipeline_live (one database call, no edge function) and keeps it
 * fresh:
 *   - every 5 s while any run is active, every 30 s when none is;
 *   - nothing while the tab is hidden, and a read straight away when it comes back;
 *   - an error only after 3 failed reads in a row, keeping the last good runs;
 *   - per-run samples of the current stage's progress, for a rolling 3-minute rate.
 *
 * Contract:
 *   runs        every run the server returned, each with _ratePerMin (null until known)
 *   loading     true until the first read answers
 *   error       null until 3 consecutive failures
 *   updatedAt   ms of the last good read
 *   refresh()   read now (after an action)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchLiveRuns } from "../services/cityPipelineService";
import { ACTIVE_RUN_STATUSES, LIVE_RATE_WINDOW_MS, currentProgress, runRate } from "../lib/cityPipeline";

export const LIVE_ACTIVE_POLL_MS = 5000;
export const LIVE_IDLE_POLL_MS = 30000;
const ERROR_THRESHOLD = 3;

export function useLiveCityRuns({ days = 7 } = {}) {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  const failuresRef = useRef(0);
  const samplesRef = useRef(new Map()); // run id -> { stage, list: [{ ts, done }] }
  const activeRef = useRef(false);
  const timerRef = useRef(null);
  const unmountedRef = useRef(false);
  const inFlightRef = useRef(false);
  const tickRef = useRef(null);

  function schedule() {
    if (unmountedRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => tickRef.current?.(), activeRef.current ? LIVE_ACTIVE_POLL_MS : LIVE_IDLE_POLL_MS);
  }

  async function tick() {
    if (unmountedRef.current) return;
    // A hidden tab reads nothing; visibilitychange reads again when it is back.
    if (typeof document !== "undefined" && document.hidden) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const data = await fetchLiveRuns(days);
      if (unmountedRef.current) return;
      failuresRef.current = 0;
      setError(null);
      const now = Date.now();
      const seen = new Set();
      const next = data.runs.map((run) => {
        seen.add(run.id);
        const p = currentProgress(run);
        let rate = null;
        if (p && p.done !== null && ACTIVE_RUN_STATUSES.includes(run.status)) {
          const prev = samplesRef.current.get(run.id);
          const list = prev && prev.stage === run.current_stage ? prev.list : [];
          const kept = [...list, { ts: now, done: p.done }].filter((s) => s.ts >= now - LIVE_RATE_WINDOW_MS - LIVE_ACTIVE_POLL_MS);
          samplesRef.current.set(run.id, { stage: run.current_stage, list: kept });
          rate = runRate(kept);
        } else {
          samplesRef.current.delete(run.id);
        }
        return { ...run, _ratePerMin: rate };
      });
      for (const id of [...samplesRef.current.keys()]) if (!seen.has(id)) samplesRef.current.delete(id);
      activeRef.current = next.some((r) => ACTIVE_RUN_STATUSES.includes(r.status));
      setRuns(next);
      setUpdatedAt(now);
    } catch (err) {
      failuresRef.current += 1;
      // Keep the last good runs; say so only after three misses in a row.
      if (failuresRef.current >= ERROR_THRESHOLD && !unmountedRef.current) setError(err?.message || "Couldn't refresh live runs (retrying)");
    } finally {
      inFlightRef.current = false;
      if (!unmountedRef.current) setLoading(false);
      schedule();
    }
  }
  // The latest tick, kept in a ref (set after render) so the timers never restart.
  useEffect(() => { tickRef.current = tick; });

  const refresh = useCallback(async () => {
    if (tickRef.current) await tickRef.current();
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    refresh();
    function onVisibility() {
      if (!document.hidden) tickRef.current?.();
    }
    document.addEventListener("visibilitychange", onVisibility);
    const samples = samplesRef.current;
    return () => {
      unmountedRef.current = true;
      clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      samples.clear();
    };
  }, [refresh]);

  return { runs, loading, error, updatedAt, refresh };
}

export default useLiveCityRuns;
