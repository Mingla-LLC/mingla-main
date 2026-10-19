// Issue #3980 — the Work board list (useOpsWork), and the one loader every ops
// screen shares (useOpsPoll): loads, refreshes on a timer
// while the page is visible, on focus and when the connection returns. A
// quiet refresh that fails keeps what is on screen; only the first load
// shows an error. Answers that arrive after a newer request are dropped.
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import * as ops from "../services/opsService";
import { todayIso } from "../lib/opsModel";

export function useOpsPoll(load, { key = "", intervalMs = 30_000, enabled = true } = {}) {
  const [state, setState] = useState({ key, data: null, error: null, loaded: false });
  const seq = useRef(0);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });

  const run = useCallback(async ({ quiet = false } = {}) => {
    if (!enabled) return null;
    const mine = ++seq.current;
    try {
      const data = await loadRef.current();
      if (mine === seq.current) setState({ key, data, error: null, loaded: true });
      return data;
    } catch (error) {
      if (mine === seq.current) {
        setState((prev) => (quiet && prev.key === key && prev.data ? { ...prev, stale: true } : { key, data: prev.key === key ? prev.data : null, error, loaded: true }));
      }
      return null;
    }
  }, [enabled, key]);

  useEffect(() => {
    if (!enabled) return undefined;
    run();
    const refresh = () => {
      if (document.visibilityState === "visible" && navigator.onLine !== false) run({ quiet: true });
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = intervalMs ? setInterval(refresh, intervalMs) : null;
    return () => {
      seq.current += 1;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      if (timer) clearInterval(timer);
    };
  }, [enabled, intervalMs, run]);

  const current = state.key === key;
  const setData = useCallback((updater) => setState((prev) => ({ ...prev, data: typeof updater === "function" ? updater(prev.data) : updater })), []);
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    stale: current ? !!state.stale : false,
    loading: !current || !state.loaded,
    refetch: run,
    setData,
  };
}

/** The Work board list, refreshed every 30 seconds while visible. */
export function useOpsWork({ who = "all", week = null } = {}) {
  const { access } = useAuth();
  const query = { who, today: todayIso(), ...(week ? { week } : {}) };
  return useOpsPoll(() => ops.listWork(query), { key: `${access?.email || ""}|${who}|${week || ""}`, intervalMs: 30_000 });
}
