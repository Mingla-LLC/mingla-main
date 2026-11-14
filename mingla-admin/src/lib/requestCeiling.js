// Issue #4423 (W1.4): the hard per-tab request ceiling, the last resort.
//
// Every request this tab sends to /rest/v1/ or /functions/v1/ is counted. Past
// REQUEST_CEILING requests in a rolling REQUEST_CEILING_WINDOW_MS the ceiling
// trips: for CEILING_PAUSE_MS new requests reject with Error("request_ceiling")
// and are never sent, Sentry is told once per trip, and the shell shows a
// banner. /auth/v1/ (token refresh must always work) and /storage/v1/ are never
// counted or blocked. Mutations are not exempt: at 300 a minute something is
// wrong, and failing loud is the point.
// invariant I-ADMIN-TAB-CEILING-300-PER-MIN (tests: issue4423_requestCeiling).
//
// It is also the witness pollGate reads: a 5xx, a network failure, a timeout
// or a ceiling refusal bumps transportFailureSeq() (supabase-js does not pass
// the HTTP status on to the caller's error).
//
// REST requests that bring no abort signal of their own get a 20 s client
// timeout (the server's own statement limit is 8 s, so nothing that could
// still succeed is cut). A timeout counts as a failure in pollGate.
//
// Pure: `fetchImpl`, `now`, `report` and `route` are injectable.

export const REQUEST_CEILING = 300;
export const REQUEST_CEILING_WINDOW_MS = 60_000;
export const CEILING_PAUSE_MS = 60_000;
export const REST_TIMEOUT_MS = 20_000;
export const CEILING_MESSAGE = "admin_request_ceiling_tripped";
// #4423 rework 1 (P3-1): under a "may be out of date" notice while the pause holds.
export const STALE_PAUSED_WORDS = "Admin paused refreshing for a minute. This refreshes by itself when the pause ends.";

/** Which bucket a URL falls in: "rest" | "functions" | "auth" | "storage" | "other". */
export function requestKind(url) {
  const path = pathOf(url);
  if (path.includes("/rest/v1/")) return "rest";
  if (path.includes("/functions/v1/")) return "functions";
  if (path.includes("/auth/v1/")) return "auth";
  if (path.includes("/storage/v1/")) return "storage";
  return "other";
}

function pathOf(url) {
  const raw = typeof url === "string" ? url : url?.url ?? String(url ?? "");
  try { return new URL(raw, "http://local").pathname; } catch { return raw; }
}

/** A short label for the Sentry counts: "rpc/ops_work_list", "functions/x", "rest/table". */
export function pathLabel(url) {
  const path = pathOf(url);
  const rest = path.split("/rest/v1/")[1];
  if (rest !== undefined) return rest.split("?")[0].slice(0, 80) || "rest";
  const fn = path.split("/functions/v1/")[1];
  if (fn !== undefined) return `functions/${fn.split("/")[0].slice(0, 60)}`;
  return "other";
}

function timeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  return undefined;
}

export function createRequestCeiling({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  report = () => {},
  route = () => "",
  ceiling = REQUEST_CEILING,
  windowMs = REQUEST_CEILING_WINDOW_MS,
  pauseMs = CEILING_PAUSE_MS,
  restTimeoutMs = REST_TIMEOUT_MS,
} = {}) {
  const sent = []; // { t, label } of counted requests in the window
  let trippedUntil = 0;
  let trips = 0;
  let refused = 0;
  let failureSeq = 0;
  const listeners = new Set();

  const notify = () => { for (const fn of [...listeners]) { try { fn(); } catch (e) { console.error("[requestCeiling] listener failed:", e?.message || e); } } };

  function prune(t) {
    while (sent.length && t - sent[0].t >= windowMs) sent.shift();
  }

  function isTripped(t = now(), { silent = false } = {}) {
    if (trippedUntil && t >= trippedUntil) {
      trippedUntil = 0;
      sent.length = 0; // a fresh minute after the pause
      if (!silent) notify();
    }
    return trippedUntil > 0;
  }

  function trip(t, label) {
    trips += 1;
    trippedUntil = t + pauseMs;
    const counts = {};
    for (const s of sent) counts[s.label] = (counts[s.label] || 0) + 1;
    counts[label] = (counts[label] || 0) + 1;
    try {
      report(CEILING_MESSAGE, { level: "error", extra: { route: route(), counts, window_ms: windowMs, ceiling } });
    } catch (error) {
      console.error("[requestCeiling] could not report the trip:", error?.message || error);
    }
    console.error(`[requestCeiling] ${ceiling} requests in ${windowMs / 1000} s: refreshing paused for ${pauseMs / 1000} s.`, counts);
    notify();
  }

  async function governedFetch(input, init) {
    const kind = requestKind(input);
    if (kind !== "rest" && kind !== "functions") return fetchImpl(input, init);
    const t = now();
    const label = pathLabel(input);
    if (isTripped(t)) {
      refused += 1;
      failureSeq += 1;
      throw new Error("request_ceiling");
    }
    prune(t);
    if (sent.length >= ceiling) {
      refused += 1;
      failureSeq += 1;
      trip(t, label);
      throw new Error("request_ceiling");
    }
    sent.push({ t, label });
    let options = init;
    if (kind === "rest" && !init?.signal) {
      const signal = timeoutSignal(restTimeoutMs);
      if (signal) options = { ...(init || {}), signal };
    }
    try {
      const res = await fetchImpl(input, options);
      if (res && typeof res.status === "number" && res.status >= 500) failureSeq += 1;
      return res;
    } catch (error) {
      failureSeq += 1;
      throw error;
    }
  }

  return {
    governedFetch,
    transportFailureSeq: () => failureSeq,
    state() {
      const t = now();
      const tripped = isTripped(t, { silent: true }); // safe inside a render
      prune(t);
      return { tripped, resumeInMs: tripped ? trippedUntil - t : 0, inWindow: sent.length, ceiling, trips, refused };
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

// The tab's one ceiling. lib/supabase.js passes `tabCeiling.governedFetch` to
// createClient and sets the Sentry reporter.
let reporter = () => {};
export function setCeilingReporter(fn) { reporter = typeof fn === "function" ? fn : () => {}; }
export const tabCeiling = createRequestCeiling({
  report: (message, context) => reporter(message, context),
  route: () => (typeof window !== "undefined" ? String(window.location?.hash || "").split("?")[0].slice(0, 80) : ""),
});
