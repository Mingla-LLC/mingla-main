// Issue #3980 — the Work board list (useOpsWork), and the one loader every ops
// screen shares (useOpsPoll): loads, refreshes on a timer
// while the page is visible, on focus and when the connection returns. A
// quiet refresh that fails keeps what is on screen; only the first load
// shows an error. Answers that arrive after a newer request are dropped.
import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import * as ops from "../services/opsService";
import { todayIso } from "../lib/opsModel";

export function useOpsPoll(load, { key = "", intervalMs = 30_000, enabled = true, cache = null } = {}) {
  // With a cache (a Map), a remounted list shows its last answer for this key
  // at once and refreshes behind it.
  const [state, setState] = useState(() => (cache?.has(key)
    ? { key, data: cache.get(key), error: null, loaded: true }
    : { key, data: null, error: null, loaded: false }));
  const seq = useRef(0);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });

  const run = useCallback(async ({ quiet = false } = {}) => {
    if (!enabled) return null;
    const mine = ++seq.current;
    try {
      const data = await loadRef.current();
      if (mine === seq.current) { setState({ key, data, error: null, loaded: true }); cache?.set(key, data); }
      return data;
    } catch (error) {
      if (mine === seq.current) {
        setState((prev) => (quiet && prev.key === key && prev.data ? { ...prev, stale: true } : { key, data: prev.key === key ? prev.data : null, error, loaded: true }));
      }
      return null;
    }
  }, [enabled, key, cache]);

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

/** Wave 3 — the Team dashboard's runway, sprint and host-owner numbers (owner and admins). */
export function useOpsTeamOverview() {
  const { access } = useAuth();
  return useOpsPoll(() => ops.fetchTeamOverview(todayIso()), { key: `${access?.email || ""}|team-overview`, intervalMs: 60_000 });
}

/** Wave 3 — My day: open cards I own and cards I watch. */
export function useMyCards() {
  const { access } = useAuth();
  return useOpsPoll(async () => {
    const today = todayIso();
    const [mine, watching] = await Promise.all([
      ops.listWork({ who: "mine", today, done_days: 0, limit: 50 }),
      ops.listWork({ who: "watching", today, done_days: 0, limit: 20 }),
    ]);
    return { mine: Array.isArray(mine?.cards) ? mine.cards : [], watching: Array.isArray(watching?.cards) ? watching.cards : [] };
  }, { key: `${access?.email || ""}|my-cards`, intervalMs: 60_000 });
}

/** #3980 synced Wave 3 — Needs attention (Work tab, Calendar summary), refreshed every minute. */
const ATTENTION_CACHE = new Map();
export function useOpsAttention({ enabled = true } = {}) {
  const { access } = useAuth();
  return useOpsPoll(() => ops.fetchAttention(todayIso()), { key: `${access?.email || ""}|attention`, intervalMs: 60_000, enabled, cache: ATTENTION_CACHE });
}

/** #3980 synced Wave 3 — the next dated thing of the host cards on screen, every 60 seconds. */
export function useHostNext(recordIds, { enabled = true } = {}) {
  const { access } = useAuth();
  const ids = Array.isArray(recordIds) ? recordIds.slice(0, 1000) : [];
  let hash = 0;
  for (const ch of ids.join(",")) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const key = `${access?.email || ""}|host-next|${ids.length}|${hash}`;
  const read = useOpsPoll(() => (ids.length ? ops.fetchHostNext(ids, todayIso()) : Promise.resolve({ hosts: [] })), { key, intervalMs: 60_000, enabled });
  const byId = {};
  for (const row of Array.isArray(read.data?.hosts) ? read.data.hosts : []) byId[row.record_id] = row;
  return { ...read, byId };
}

/** #3980 (R1): the host-next rows of the board on screen, for NextEventLine. */
export const HostNextContext = createContext(null);
