// Issue #4423 (W1.1): the one gate every background read in Admin goes through.
//
// - In-flight dedupe per key: a key with a read in flight never starts another.
// - Exponential backoff per key on a server-side failure (HTTP >= 500, a
//   PostgREST PGRST003, a network failure, a client timeout or the tab's
//   request ceiling): 30 s, 60 s, 120 s, 240 s, then 300 s, each +-20 %
//   jitter. Success resets the key. A 4xx is not backed off.
// - Tab-wide breaker: when 5 or more of the last 10 background reads failed
//   server-side, every background read pauses for 60 s (doubling up to 300 s
//   each time it re-opens) and closes on the first success.
// - Budget: at most 60 background reads per rolling 60 s per tab
//   (invariant I-ADMIN-POLL-BUDGET-60-PER-MIN). Reads over it are skipped and
//   the screen keeps its last data (shown as stale).
//
// A person's own refresh (a button) skips allow() but still goes through
// start()/settle(), so its success closes the breaker and resets the key.
//
// Pure: `now` and `random` are injectable for tests.
import { tabCeiling } from "./requestCeiling.js";

export const BACKOFF_STEPS_MS = [30_000, 60_000, 120_000, 240_000, 300_000];
export const BACKOFF_JITTER = 0.2;
export const BREAKER_WINDOW = 10;
export const BREAKER_FAILURES = 5;
export const BREAKER_BASE_MS = 60_000;
export const BREAKER_MAX_MS = 300_000;
export const POLL_BUDGET = 60;
export const POLL_BUDGET_WINDOW_MS = 60_000;

/**
 * Is this failure the server's (back off) or the request's (do not)?
 * `outcome` is { status, code, error }. `transportFailed` is true when the
 * tab's fetch layer saw a 5xx, network failure, timeout or ceiling refusal
 * while this read was in flight (supabase-js drops the HTTP status from the
 * error it hands back, so the fetch layer is the reliable witness).
 */
export function isServerFailure({ status, code, error } = {}, transportFailed = false) {
  if (typeof status === "number") {
    if (status >= 500) return true;
    if (status >= 400) return false;
  }
  const c = String(code || error?.code || "");
  if (c === "PGRST003" || c === "57014") return true;
  const name = String(error?.name || "");
  if (name === "AbortError" || name === "TimeoutError") return true;
  const text = `${error?.message || ""} ${error?.detail || ""} ${error?.details || ""}`;
  if (/request_ceiling|timed? ?out|TimeoutError|AbortError|failed to fetch|networkerror|load failed|network request failed/i.test(text)) return true;
  if (error?.token === "network") return true;
  return !!transportFailed;
}

export function createPollGate({
  now = () => Date.now(),
  random = Math.random,
  transportFailureSeq = () => 0,
} = {}) {
  const keys = new Map(); // key -> { inFlight, failures, retryAt, startedSeq }
  const outcomes = []; // last BREAKER_WINDOW background outcomes: true = server failure
  const starts = []; // timestamps of background starts in the budget window
  let breakerOpenUntil = 0;
  let breakerMs = 0; // 0 = closed and never tripped since the last success
  let breakerOpen = false;
  let skipped = 0;
  const listeners = new Set();

  const entry = (key) => {
    let e = keys.get(key);
    if (!e) { e = { inFlight: 0, failures: 0, retryAt: 0, startedSeq: 0 }; keys.set(key, e); }
    return e;
  };

  const notify = () => { for (const fn of [...listeners]) fn(); };

  function prune(t) {
    while (starts.length && t - starts[0] >= POLL_BUDGET_WINDOW_MS) starts.shift();
  }

  /** Backoff wait after the n-th consecutive failure (1-based), jittered. */
  function backoffMs(n) {
    const base = BACKOFF_STEPS_MS[Math.min(n, BACKOFF_STEPS_MS.length) - 1];
    const jitter = 1 + (random() * 2 - 1) * BACKOFF_JITTER;
    return Math.round(base * jitter);
  }

  /**
   * Why a background read of `key` may not start now: "in_flight" |
   * "backoff" | "breaker" | "budget", or null when it may. Pure check.
   */
  function why(key) {
    const t = now();
    const e = keys.get(key);
    if (e?.inFlight) return "in_flight";
    if (e && t < e.retryAt) return "backoff";
    if (breakerOpen && t < breakerOpenUntil) return "breaker";
    prune(t);
    if (starts.length >= POLL_BUDGET) return "budget";
    return null;
  }

  return {
    why,
    /** May a background read of `key` start now? Skips are counted. */
    allow(key) {
      const ok = why(key) === null;
      if (!ok) skipped += 1;
      return ok;
    },
    /** A read of `key` starts. `background` reads count toward the budget. */
    start(key, { background = true } = {}) {
      const t = now();
      const e = entry(key);
      e.inFlight += 1;
      e.startedSeq = transportFailureSeq();
      if (background) { prune(t); starts.push(t); }
    },
    /**
     * A read of `key` ended. `{ ok, status, code, error }`. Returns
     * "ok" | "backoff" | "failed" (a failure that is not backed off).
     */
    settle(key, { ok, status, code, error } = {}, { background = true } = {}) {
      const t = now();
      const e = entry(key);
      const sawTransport = transportFailureSeq() > e.startedSeq;
      e.inFlight = Math.max(0, e.inFlight - 1);
      let verdict;
      if (ok) {
        e.failures = 0;
        e.retryAt = 0;
        if (breakerOpen || breakerMs) {
          // The first success closes the breaker and starts a fresh window.
          breakerOpen = false; breakerOpenUntil = 0; breakerMs = 0;
          outcomes.length = 0;
        } else if (background) {
          outcomes.push(false);
          if (outcomes.length > BREAKER_WINDOW) outcomes.shift();
        }
        verdict = "ok";
      } else if (isServerFailure({ status, code, error }, sawTransport)) {
        e.failures += 1;
        e.retryAt = t + backoffMs(e.failures);
        verdict = "backoff";
        if (background) {
          outcomes.push(true);
          if (outcomes.length > BREAKER_WINDOW) outcomes.shift();
          const failed = outcomes.filter(Boolean).length;
          const probeFailed = breakerOpen && t >= breakerOpenUntil;
          if (probeFailed || (!breakerOpen && failed >= BREAKER_FAILURES)) {
            breakerMs = breakerMs ? Math.min(breakerMs * 2, BREAKER_MAX_MS) : BREAKER_BASE_MS;
            breakerOpen = true;
            breakerOpenUntil = t + breakerMs;
          }
        }
      } else {
        verdict = "failed";
        if (background) {
          outcomes.push(false);
          if (outcomes.length > BREAKER_WINDOW) outcomes.shift();
        }
      }
      notify();
      return verdict;
    },
    /** For the stale state, the banner and tests. */
    state() {
      const t = now();
      prune(t);
      const backoff = {};
      for (const [k, e] of keys) if (t < e.retryAt) backoff[k] = { failures: e.failures, retryInMs: e.retryAt - t };
      return {
        breakerOpen: breakerOpen && t < breakerOpenUntil,
        breakerProbe: breakerOpen && t >= breakerOpenUntil,
        breakerRetryInMs: breakerOpen ? Math.max(0, breakerOpenUntil - t) : 0,
        breakerMs,
        budgetUsed: starts.length,
        budget: POLL_BUDGET,
        skipped,
        backoff,
        inFlight: [...keys].filter(([, e]) => e.inFlight > 0).map(([k]) => k),
      };
    },
    /** Is `key` currently held back (backoff or breaker)? */
    isHeld(key) {
      const t = now();
      const e = keys.get(key);
      return !!(e && t < e.retryAt) || (breakerOpen && t < breakerOpenUntil);
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Tests only. */
    reset() { keys.clear(); outcomes.length = 0; starts.length = 0; breakerOpen = false; breakerOpenUntil = 0; breakerMs = 0; skipped = 0; },
  };
}

/**
 * Run one read through `gate`. Background reads (`quiet`) ask allow() first
 * and return { skipped: true } when held back; a person's own refresh does
 * not. Returns { skipped, ok, data, error }.
 */
export async function gatedRun(gate, key, load, { background = true } = {}) {
  if (background) {
    const why = gate.why(key);
    if (why) { gate.allow(key); return { skipped: true, why, ok: false, data: null, error: null }; }
  }
  gate.start(key, { background });
  try {
    const data = await load();
    gate.settle(key, { ok: true }, { background });
    return { skipped: false, ok: true, data, error: null };
  } catch (error) {
    gate.settle(key, { ok: false, status: error?.status ?? error?.context?.status, code: error?.code, error }, { background });
    return { skipped: false, ok: false, data: null, error };
  }
}

/**
 * The triggers of one background poller, without React: the first load, the
 * page-return signal, and a refresh timer that counts from the last refresh
 * (so a return refresh pushes the next timer tick back, and the timer never
 * doubles a refresh the return just made). `refresh({ quiet })` does the read
 * (and its gating) and resolves to { skipped }.
 */
export function createPoller({
  refresh,
  intervalMs = 0,
  pageReturn,
  isVisible = () => typeof document === "undefined" || document.visibilityState === "visible",
  isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
  initial = true,
}) {
  let handle = null;
  let live = false;
  let unsubscribe = () => {};

  function arm() {
    if (handle !== null) clearTimer(handle);
    handle = null;
    if (live && intervalMs > 0) handle = setTimer(fire, intervalMs);
  }

  function ran(result) {
    if (live && result && !result.skipped) arm();
  }

  function fire() {
    handle = null;
    if (!live) return;
    if (isVisible() && isOnline()) {
      Promise.resolve(refresh({ quiet: true })).then((result) => {
        // Only a tick that sent its read counts as a refresh: a key held back
        // (backoff, breaker, budget, in flight) must not hold the others.
        if (live && result && !result.skipped) pageReturn?.markRefreshed();
        ran(result);
      }, () => {});
    }
    arm();
  }

  return {
    start() {
      if (live) return;
      live = true;
      if (initial) Promise.resolve(refresh({ quiet: false })).then(ran, () => {});
      unsubscribe = pageReturn ? pageReturn.subscribePageReturn(() => {
        Promise.resolve(refresh({ quiet: true })).then(ran, () => {});
      }) : () => {};
      arm();
    },
    stop() {
      live = false;
      unsubscribe();
      unsubscribe = () => {};
      if (handle !== null) clearTimer(handle);
      handle = null;
    },
  };
}

// The tab's one gate. It reads the tab ceiling's transport-failure witness.
export const tabPollGate = createPollGate({ transportFailureSeq: () => tabCeiling.transportFailureSeq() });

// #4423 rework 1 (P2-1, P3-1): what a failed read leaves on screen.
//
// `prev` is a hook's { key, data, error, loaded, stale, paused }. When the
// read failed in the background (`quiet`) or because the tab's request
// ceiling is paused (`paused`), data already on screen for this key stays,
// marked stale (and paused), and no error replaces it: a person's Try again
// during the pause must never wipe the board. Otherwise (a first load, or a
// person's own retry that the server refused) the error shows, with any
// data for this key kept beside it.
export function stateAfterFailure(prev, { key, error, quiet = false, paused = false } = {}) {
  const had = !!prev && prev.key === key && prev.data != null;
  if (had && (quiet || paused)) return { ...prev, stale: true, paused: !!paused };
  return { key, data: had ? prev.data : null, error, loaded: true, stale: false, paused: !!paused };
}

/** Is the tab's request ceiling refusing to send right now (lib/requestCeiling)? */
export function ceilingPaused(ceiling = tabCeiling) {
  try { return !!ceiling.state().tripped; } catch { return false; }
}

/**
 * Run `fn` once, just after the ceiling pause ends. Returns a cancel
 * function. `setTimer` / `clearTimer` are injectable for tests.
 */
export function whenCeilingLifts(fn, { ceiling = tabCeiling, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let resumeInMs = 0;
  try { resumeInMs = Number(ceiling.state().resumeInMs) || 0; } catch { resumeInMs = 0; }
  const handle = setTimer(() => {
    try { fn(); } catch (error) { console.error("[pollGate] retry after the pause failed:", error?.message || error); }
  }, Math.max(250, resumeInMs + 50));
  return () => clearTimer(handle);
}

// #4423 rework 2 (P3-A): a page whose FIRST load was refused by the ceiling
// pause has nothing on screen to keep, so it shows the shared LoadError. While
// the pause holds, that card says the tab is paused (not "tell an admin") and
// the page loads again by itself just after the pause ends.
export const PAUSED_LOAD_TITLE = "Paused for a minute";
export const PAUSED_LOAD_WORDS = "Admin paused refreshing because this tab sent too many requests. This loads by itself when the pause ends.";

/** What LoadError shows: the page's own words, or the pause words while paused. */
export function loadErrorView({ title, message } = {}, paused = false) {
  if (paused) return { title: PAUSED_LOAD_TITLE, message: PAUSED_LOAD_WORDS, variant: "warning", paused: true };
  return { title, message, variant: "error", paused: false };
}
