// Issue #3980 — the Work board list (useOpsWork), and the one loader every ops
// screen shares (useOpsPoll): loads, refreshes on a timer
// while the page is visible, and when the page comes back. A
// quiet refresh that fails keeps what is on screen; only the first load
// shows an error. Answers that arrive after a newer request are dropped.
//
// #4423 (W1.1): "the page came back" (focus, visible again, online) is the one
// shared lib/pageReturn signal, at most once per 20 s for the whole tab, and
// every background refresh goes through lib/pollGate (no second request while
// one is in flight, backoff when the server fails, the tab-wide breaker and
// budget). A refresh held back keeps the data on screen and marks it stale.
// The timer counts from the last refresh. refetch() (a person's own refresh)
// skips the gate's hold but is still counted.
//
// #4423 rework 1 (P3-1): a read refused because the tab's request ceiling is
// paused keeps what is on screen (stale and `paused`), never an error, even
// on a person's Try again, and reads again once just after the pause ends.
import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import * as ops from "../services/opsService";
import { todayIso } from "../lib/opsModel";
import * as pageReturn from "../lib/pageReturn";
import { ceilingPaused, createPoller, stateAfterFailure, tabPollGate, whenCeilingLifts } from "../lib/pollGate";

let anonymousPolls = 0;

export function useOpsPoll(load, { key = "", intervalMs = 30_000, enabled = true, cache = null } = {}) {
  // With a cache (a Map), a remounted list shows its last answer for this key
  // at once and refreshes behind it.
  const [state, setState] = useState(() => (cache?.has(key)
    ? { key, data: cache.get(key), error: null, loaded: true }
    : { key, data: null, error: null, loaded: false }));
  const seq = useRef(0);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });
  // A poll with no key still gets a gate key of its own.
  const anonId = useRef(0);
  if (!anonId.current) anonId.current = ++anonymousPolls;
  const attemptRef = useRef(null);
  const cancelResume = useRef(null);

  // { skipped } so the poller knows whether a request went out.
  const attempt = useCallback(async ({ quiet = false } = {}) => {
    if (!enabled) return { skipped: true, data: null };
    const gateKey = `ops:${key || `anon-${anonId.current}`}`;
    if (quiet) {
      const why = tabPollGate.why(gateKey);
      if (why) {
        tabPollGate.allow(gateKey); // counts the skip
        // Held back by backoff, the breaker or the budget: keep what is on
        // screen and say it may be out of date. In flight: the answer is coming.
        if (why !== "in_flight") setState((prev) => (prev.key === key && prev.data ? { ...prev, stale: true } : prev));
        return { skipped: true, data: null };
      }
    }
    const mine = ++seq.current;
    tabPollGate.start(gateKey, { background: quiet });
    try {
      const data = await loadRef.current();
      tabPollGate.settle(gateKey, { ok: true }, { background: quiet });
      if (mine === seq.current) { setState({ key, data, error: null, loaded: true }); cache?.set(key, data); }
      return { skipped: false, data };
    } catch (error) {
      tabPollGate.settle(gateKey, { ok: false, status: error?.status, code: error?.code, error }, { background: quiet });
      if (mine === seq.current) {
        const paused = ceilingPaused();
        setState((prev) => stateAfterFailure(prev, { key, error, quiet, paused }));
        if (paused && !cancelResume.current) {
          cancelResume.current = whenCeilingLifts(() => { cancelResume.current = null; void attemptRef.current?.(); });
        }
      }
      return { skipped: false, data: null };
    }
  }, [enabled, key, cache]);
  useEffect(() => { attemptRef.current = attempt; });

  const run = useCallback(async (options) => (await attempt(options)).data, [attempt]);

  useEffect(() => {
    if (!enabled) return undefined;
    const poller = createPoller({ refresh: attempt, intervalMs, pageReturn });
    poller.start();
    return () => {
      seq.current += 1;
      poller.stop();
      cancelResume.current?.();
      cancelResume.current = null;
    };
  }, [enabled, intervalMs, attempt]);

  const current = state.key === key;
  const setData = useCallback((updater) => setState((prev) => ({ ...prev, data: typeof updater === "function" ? updater(prev.data) : updater })), []);
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    stale: current ? !!state.stale : false,
    paused: current ? !!state.paused : false,
    loading: !current || !state.loaded,
    refetch: run,
    setData,
  };
}

/**
 * The Work board list, refreshed every 30 seconds while visible. #4130: the
 * person chips filter it on the server by `owner`, and the search box by `q`.
 */
export function useOpsWork({ who = "all", week = null, owner = null, q = "", limit = null, perStatus = false, subtasks = false, goalId = null, enabled = true } = {}) {
  const { access } = useAuth();
  const search = String(q || "").trim();
  // #4270: the board asks for up to 300 cards and says so when there are more.
  // Rework (P2-1): with perStatus the limit is per column, so a long To do
  // never empties In progress or Done. (P3-3) tz: Done is closed since Monday
  // 00:00 of the sprint in your own time zone, the same week as the strip.
  const query = { who, today: todayIso(), tz: browserTimeZone(), ...(week ? { week } : {}), ...(owner ? { owner } : {}), ...(search ? { q: search } : {}),
    ...(limit ? { limit } : {}), ...(perStatus ? { per_status: true } : {}),
    // #4255 W2: subtasks on the board too, and one sprint goal's cards.
    ...(subtasks ? { subtasks: true } : {}), ...(goalId ? { goal_id: goalId } : {}) };
  // #4255: only while the board is on screen (the other tabs read their own window).
  return useOpsPoll(() => ops.listBoardWork(query), { key: `${access?.email || ""}|${who}|${week || ""}|${owner || ""}|${search}|${limit || ""}|${perStatus ? "cols" : ""}|${subtasks ? "subs" : ""}|${goalId || ""}`, intervalMs: 30_000, enabled });
}

/** The browser's time zone name, or UTC when it cannot say. */
export function browserTimeZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone && zone.length <= 64 ? zone : "UTC";
  } catch {
    return "UTC";
  }
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
      ops.listBoardWork({ who: "mine", today, done_days: 0, limit: 50 }),
      ops.listBoardWork({ who: "watching", today, done_days: 0, limit: 20 }),
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
