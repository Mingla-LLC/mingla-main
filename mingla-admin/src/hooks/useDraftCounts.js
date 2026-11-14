import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import * as drafts from "../services/draftService";
import * as pageReturn from "../lib/pageReturn";
import { ceilingPaused, createPoller, stateAfterFailure, tabPollGate, whenCeilingLifts } from "../lib/pollGate";

// #4423 (W1.1): refreshes on the shared page-return signal and a timer that
// counts from the last refresh, never on its own focus listeners. Every
// background refresh goes through pollGate key "draft-counts"; overlapping
// calls still fold into one follow-up. A refresh held back keeps the counts
// on screen and marks them stale.
// #4423 rework 1 (P2-1, P3-1): a failed read keeps counts already on screen
// (stale; `paused` too under the ceiling pause, with one read when it ends).
// RoleHomePage shows "may be out of date" with Try again.
const GATE_KEY = "draft-counts";

export const DRAFT_REFRESH_MS = 30_000;
const DraftCountContext = createContext(null);
const listeners = new Set();

export function announceDraftMutation() {
  for (const listener of listeners) listener();
  if (typeof window !== "undefined") window.dispatchEvent(new Event("mingla:drafts-changed"));
}

export function useDraftCounts({ enabled = true } = {}) {
  const { access } = useAuth();
  const key = access?.email || "";
  const [state, setState] = useState({ key, data: null, error: null, loaded: false });
  const seq = useRef(0);
  const pending = useRef("");
  const queued = useRef("");
  const live = useRef(false);
  const cancelResume = useRef(null);
  const loadRef = useRef(null);

  useEffect(() => {
    live.current = enabled;
    return () => {
      live.current = false;
      queued.current = "";
      seq.current += 1;
    };
  }, [enabled, key]);

  // Resolves to { skipped } for the poller.
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!enabled || !live.current) return { skipped: true };
    if (pending.current === key) {
      queued.current = key;
      return { skipped: true };
    }
    if (quiet) {
      const why = tabPollGate.why(GATE_KEY);
      if (why) {
        tabPollGate.allow(GATE_KEY);
        if (why !== "in_flight") setState((prev) => (prev.key === key && prev.data ? { ...prev, stale: true } : prev));
        return { skipped: true };
      }
    }
    pending.current = key;
    const mine = ++seq.current;
    tabPollGate.start(GATE_KEY, { background: quiet });
    try {
      const data = await drafts.fetchDraftCounts();
      tabPollGate.settle(GATE_KEY, { ok: true }, { background: quiet });
      if (live.current && mine === seq.current) setState({ key, data, error: null, loaded: true });
    } catch (error) {
      tabPollGate.settle(GATE_KEY, { ok: false, status: error?.status, code: error?.code, error }, { background: quiet });
      if (live.current && mine === seq.current) {
        const paused = ceilingPaused();
        // A quiet read with nothing on screen yet keeps the quiet "no change".
        setState((prev) => (quiet && !(prev.key === key && prev.data) ? prev : stateAfterFailure(prev, { key, error, quiet, paused })));
        if (paused && !cancelResume.current) {
          cancelResume.current = whenCeilingLifts(() => { cancelResume.current = null; void loadRef.current?.(); });
        }
      }
    } finally {
      if (pending.current === key) pending.current = "";
      const refreshAgain = queued.current === key;
      if (refreshAgain) queued.current = "";
      if (refreshAgain && live.current && enabled) await load({ quiet: true });
    }
    return { skipped: false };
  }, [enabled, key]);
  useEffect(() => { loadRef.current = load; });

  useEffect(() => {
    if (!enabled) return undefined;
    const poller = createPoller({ refresh: load, intervalMs: DRAFT_REFRESH_MS, pageReturn });
    // A draft changed here (announceDraftMutation): read again now.
    const refresh = () => { void load({ quiet: true }); };
    listeners.add(refresh);
    poller.start();
    return () => {
      listeners.delete(refresh);
      poller.stop();
      cancelResume.current?.();
      cancelResume.current = null;
    };
  }, [enabled, load]);

  const current = state.key === key;
  const refetch = useCallback(() => load(), [load]);
  return { data: current ? state.data : null, error: current ? state.error : null, stale: current ? !!state.stale : false, paused: current ? !!state.paused : false, loading: !current || !state.loaded, refetch };
}

export function DraftCountProvider({ value, children }) {
  return createElement(DraftCountContext.Provider, { value }, children);
}

export function useDraftCountValue() {
  return useContext(DraftCountContext) || { data: null, error: null, stale: false, paused: false, loading: true, refetch: () => {} };
}
