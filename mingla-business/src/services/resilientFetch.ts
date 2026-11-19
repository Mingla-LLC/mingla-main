/**
 * resilientFetch — #4518 N3: a second road to the database for Host web.
 *
 * THE DEFECT. A buyer's phone could reach `host.usemingla.com` but not the
 * database host. Every call the browser made straight to that host failed, so
 * the page locked buying, and checkout itself could not have started either.
 *
 * THE FIX. Host web also serves the database under its own origin
 * (`/_sb/*`, a Vercel rewrite). A request goes DIRECT first, exactly as
 * before. When a direct request cannot connect, one probe checks that the
 * same-origin road really reaches the database; if it does, the rest of the
 * visit uses that road.
 *
 * WHAT IS REPLAYED. Only a request that is safe to send twice: GET / HEAD, and
 * the public read RPCs (`rpc/pg_*`, `rpc/get_*`). A write that failed in
 * flight (a checkout start, an auth call) is NOT replayed here, because the
 * server may already have acted on it; its own caller surfaces the error, and
 * the retry the buyer makes then travels the working road. Safe requests also
 * get a time limit on the direct road, because a blocked host often hangs
 * instead of failing.
 *
 * WHAT IT IS NOT. Not a cache, not a retry loop, not used on native (the apps
 * have no same-origin road), and not used for realtime sockets. Normal
 * traffic stays direct, so cost and rate limits are unchanged for buyers whose
 * connection is fine.
 */

export type DatabaseRoute = "direct" | "sameOrigin";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const SAME_ORIGIN_PREFIX = "/_sb";
/** How long a SAFE direct request may hang before the second road is tried. */
export const DIRECT_TIME_LIMIT_MS = 8000;
const PROBE_TIME_LIMIT_MS = 6000;
const PROBE_PATH = "/auth/v1/health";
const STORAGE_KEY = "mingla.dbRoute";

export interface RouteEvent {
  /** `rescued`: the second road works. `unreachable`: neither road answered. */
  outcome: "rescued" | "unreachable";
  /** The request path that failed first, with ids removed. */
  path: string;
}

type RouteListener = (event: RouteEvent) => void;

let route: DatabaseRoute = "direct";
let probing: Promise<boolean> | null = null;
let restored = false;
const listeners = new Set<RouteListener>();

/** #4518 N4 — the buyer-gate reporter and the query client subscribe here. */
export const onDatabaseRouteEvent = (listener: RouteListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const currentDatabaseRoute = (): DatabaseRoute => route;

/** Test seam. */
export const resetDatabaseRoute = (): void => {
  route = "direct";
  probing = null;
  restored = false;
};

const emit = (event: RouteEvent): void => {
  // #4518 N4 — counted in product analytics (sent only when analytics is on
  // for the visitor; no personal data). Imported on use: this module is
  // loaded off the boot path and must not pull analytics into it.
  void import("../analytics/webAnalytics")
    .then((analytics) =>
      analytics.captureWeb("buyer_database_route", {
        outcome: event.outcome,
        path: event.path,
      }),
    )
    .catch(() => {
      // Reporting is best-effort; the request outcome is unaffected.
    });
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A reporter must never break the request it is reporting on.
    }
  }
};

const sessionStore = (): Storage | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    // Private mode / blocked storage: the route is simply not remembered.
    return null;
  }
};

const restoreRoute = (): void => {
  if (restored) return;
  restored = true;
  try {
    if (sessionStore()?.getItem(STORAGE_KEY) === "sameOrigin") route = "sameOrigin";
  } catch {
    // Unreadable storage: start on the direct road.
  }
};

const rememberRoute = (): void => {
  try {
    sessionStore()?.setItem(STORAGE_KEY, route);
  } catch {
    // Unwritable storage: the route still holds for this page.
  }
};

/** `https://<project>.supabase.co/rest/v1/x` → `/_sb/rest/v1/x`. */
export const toSameOrigin = (url: string, directOrigin: string): string =>
  SAME_ORIGIN_PREFIX + url.slice(directOrigin.length);

const SAFE_RPC = /^\/rest\/v1\/rpc\/(?:pg_|get_)[a-z0-9_]*$/;

/** Safe to send twice: reads only. */
export const isReplaySafe = (method: string, path: string): boolean => {
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD") return true;
  return verb === "POST" && SAFE_RPC.test(path);
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** A path fit for analytics: no query string, no ids. */
export const reportablePath = (path: string): string =>
  path.split("?")[0].replace(UUID, ":id").slice(0, 120);

const isCallerAbort = (signal: AbortSignal | null | undefined): boolean =>
  signal?.aborted === true;

/**
 * The same-origin road counts only if it really reaches the database: any
 * JSON answer from the auth health path. A dev server or a misrouted rewrite
 * answers that path with the HTML app shell, which must not count.
 */
const probeSameOrigin = async (fetchImpl: FetchLike): Promise<boolean> => {
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = setTimeout(() => controller?.abort(), PROBE_TIME_LIMIT_MS);
  try {
    const response = await fetchImpl(`${SAME_ORIGIN_PREFIX}${PROBE_PATH}`, {
      method: "GET",
      signal: controller?.signal,
    });
    const type = response.headers.get("content-type") ?? "";
    return type.toLowerCase().includes("json");
  } catch {
    // The second road is down too: stay on direct and report "unreachable".
    return false;
  } finally {
    clearTimeout(timer);
  }
};

const fetchWithTimeLimit = async (
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit | undefined,
  limitMs: number,
): Promise<Response> => {
  if (typeof AbortController === "undefined") return fetchImpl(url, init);
  const controller = new AbortController();
  const callerSignal = init?.signal ?? null;
  const onCallerAbort = (): void => controller.abort();
  if (callerSignal?.aborted === true) controller.abort();
  callerSignal?.addEventListener("abort", onCallerAbort);
  const timer = setTimeout(() => controller.abort(), limitMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
};

/**
 * A direct request failed to connect (or hung): find out whether the
 * same-origin road reaches the database, switch to it if so, and replay the
 * request only when it is safe to send twice. Otherwise rethrow `error`.
 */
export async function recoverDirectFailure(
  fetchImpl: FetchLike,
  directOrigin: string,
  input: string,
  init: RequestInit | undefined,
  error: unknown,
): Promise<Response> {
  // The caller cancelled it: not a connection failure.
  if (isCallerAbort(init?.signal)) throw error;
  const path = input.slice(directOrigin.length);
  probing ??= probeSameOrigin(fetchImpl);
  const reachable = await probing;
  probing = null;
  if (!reachable) {
    emit({ outcome: "unreachable", path: reportablePath(path) });
    throw error;
  }
  // Another request may have switched the road while this one waited.
  if (currentDatabaseRoute() !== "sameOrigin") {
    route = "sameOrigin";
    rememberRoute();
    emit({ outcome: "rescued", path: reportablePath(path) });
  }
  // A write is never sent twice from here; see the header.
  if (!isReplaySafe(init?.method ?? "GET", path.split("?")[0])) throw error;
  return fetchImpl(toSameOrigin(input, directOrigin), init);
}

export interface ResilientFetchOptions {
  /** The database origin, no trailing slash. */
  directOrigin: string;
  /** False on native and outside a browser: a plain pass-through. */
  enabled: boolean;
}

export function createResilientFetch(
  getFetch: () => FetchLike,
  options: ResilientFetchOptions,
): FetchLike {
  const directOrigin = options.directOrigin.replace(/\/+$/, "");
  if (!options.enabled || directOrigin.length === 0) {
    return (input, init) => getFetch()(input, init);
  }

  return async (input, init) => {
    const fetchImpl = getFetch();
    // supabase-js always passes a string URL. Anything else is not ours.
    if (typeof input !== "string" || !input.startsWith(`${directOrigin}/`)) {
      return fetchImpl(input, init);
    }
    restoreRoute();
    if (route === "sameOrigin") {
      return fetchImpl(toSameOrigin(input, directOrigin), init);
    }

    const path = input.slice(directOrigin.length);
    const safe = isReplaySafe(init?.method ?? "GET", path.split("?")[0]);
    try {
      return safe
        ? await fetchWithTimeLimit(fetchImpl, input, init, DIRECT_TIME_LIMIT_MS)
        : await fetchImpl(input, init);
    } catch (error) {
      return recoverDirectFailure(fetchImpl, directOrigin, input, init, error);
    }
  };
}
