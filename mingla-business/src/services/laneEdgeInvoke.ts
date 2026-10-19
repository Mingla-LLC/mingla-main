/**
 * #3040 (2026-10-19) — every video-lane edge call, never stuck behind sign-in.
 *
 * `supabase.functions.invoke` runs through supabase-js's `fetchWithAuth`,
 * which awaits `auth.getSession()` BEFORE it sends anything — even when the
 * caller already passes an Authorization header. `getSession()` takes the
 * auth lock; while this tab already holds that lock (a `getUser()` probe or a
 * token refresh doing a network round trip), the call is queued in-process
 * with no time bound (the 2.3 s web lock bound in services/supabase.ts only
 * covers waiting for ANOTHER tab). Two rules hold here instead:
 *
 *   1. an access token that is still valid is reused at once — from the
 *      auth state events, never by asking the lock again;
 *   2. otherwise `getSession()` is given at most SESSION_ACQUIRE_TIMEOUT_MS.
 *      Past that, a token that has not expired yet is used; with none, the
 *      call fails fast as "finishing sign-in" (a retryable answer), never a
 *      wait.
 *
 * The request itself then goes straight to the functions endpoint with that
 * token. Its `{ data, error }` result has the same shape `invoke` returns
 * (an HTTP error carries the Response as `context`), so callers map errors
 * exactly as before.
 */
import { BusinessAuthNotReadyError } from "../utils/authReadiness";
import { laneEdgeEndpoint, supabase } from "./supabase";

export const SESSION_ACQUIRE_TIMEOUT_MS = 2_000;
/** A held token is reused while it has at least this long left. */
export const TOKEN_REUSE_MARGIN_MS = 30_000;

type SessionLike = { access_token?: string | null; expires_at?: number | null } | null | undefined;

let heldToken: { token: string; expiresAtMs: number } | null = null;
let listening = false;
let listenerActive = false;

/** Keep the newest session the auth client announced (null = signed out). */
export const rememberLaneSession = (session: SessionLike): void => {
  const token = session?.access_token;
  const expiresAt = session?.expires_at;
  heldToken = typeof token === "string" && token.length > 0 &&
      typeof expiresAt === "number" && Number.isFinite(expiresAt)
    ? { token, expiresAtMs: expiresAt * 1000 }
    : null;
};

const ensureSessionListener = (): void => {
  if (listening) return;
  listening = true;
  const auth = supabase.auth as unknown as {
    onAuthStateChange?: (callback: (event: string, session: SessionLike) => void) => unknown;
  };
  if (typeof auth.onAuthStateChange !== "function") return;
  try {
    auth.onAuthStateChange((_event, session) => rememberLaneSession(session));
    listenerActive = true;
  } catch {
    // No listener: every call falls back to the bounded getSession below.
  }
};

/** Test seam: forget the held token and the listener. */
export const resetLaneSessionForTests = (): void => {
  heldToken = null;
  listening = false;
  listenerActive = false;
};

const notReady = (): BusinessAuthNotReadyError =>
  new BusinessAuthNotReadyError("unauthenticated", "Finishing sign-in. Try again in a moment.");

const SESSION_TIMED_OUT = Symbol("session_timed_out");

/**
 * The access token for one lane call. Never waits on the auth lock for more
 * than SESSION_ACQUIRE_TIMEOUT_MS.
 */
export const resolveLaneAccessToken = async (): Promise<string> => {
  ensureSessionListener();
  if (heldToken !== null && heldToken.expiresAtMs - Date.now() > TOKEN_REUSE_MARGIN_MS) {
    return heldToken.token;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<typeof SESSION_TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(SESSION_TIMED_OUT), SESSION_ACQUIRE_TIMEOUT_MS);
  });
  let result: Awaited<ReturnType<typeof supabase.auth.getSession>> | typeof SESSION_TIMED_OUT;
  try {
    result = await Promise.race([supabase.auth.getSession(), timedOut]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
  if (result === SESSION_TIMED_OUT) {
    if (heldToken !== null && heldToken.expiresAtMs > Date.now()) return heldToken.token;
    throw notReady();
  }
  const session = result.data?.session;
  const token = session?.access_token;
  if (result.error || typeof token !== "string" || token.length === 0) throw notReady();
  if (listenerActive) rememberLaneSession(session);
  return token;
};

export type LaneInvokeResult<T> = { data: T | null; error: unknown };

type LaneInvokeOptions = {
  body?: unknown;
  /** A token the caller already resolved through `resolveLaneAccessToken`. */
  accessToken?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

const httpError = (name: string, message: string, response: Response): Error =>
  Object.assign(new Error(message), { name, context: response });

/**
 * Call one lane edge function. Same result shape as `supabase.functions.invoke`.
 * Without a configured endpoint (tests that replace services/supabase) it is
 * exactly `supabase.functions.invoke`.
 */
export const invokeLaneFunction = async <T>(
  name: string,
  options: LaneInvokeOptions = {},
): Promise<LaneInvokeResult<T>> => {
  const { accessToken, ...invokeOptions } = options;
  const endpoint = laneEdgeEndpoint;
  if (endpoint === null || endpoint === undefined) {
    return await supabase.functions.invoke<T>(
      name,
      invokeOptions as Parameters<typeof supabase.functions.invoke>[1],
    ) as LaneInvokeResult<T>;
  }
  const token = accessToken ?? await resolveLaneAccessToken();
  let response: Response;
  try {
    response = await fetch(`${endpoint.functionsUrl}/${name}`, {
      method: "POST",
      headers: {
        ...endpoint.headers,
        "Content-Type": "application/json",
        ...options.headers,
        apikey: endpoint.anonKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(options.body ?? {}),
      signal: options.signal,
    });
  } catch (fetchError) {
    if (options.signal?.aborted) throw fetchError;
    return {
      data: null,
      error: Object.assign(new Error("Failed to send a request to the Edge Function"), {
        name: "FunctionsFetchError",
        context: fetchError,
      }),
    };
  }
  if (response.headers.get("x-relay-error") === "true") {
    return { data: null, error: httpError("FunctionsRelayError", "Relay Error invoking the Edge Function", response) };
  }
  if (!response.ok) {
    return { data: null, error: httpError("FunctionsHttpError", "Edge Function returned a non-2xx status code", response) };
  }
  const contentType = (response.headers.get("Content-Type") ?? "text/plain").split(";")[0].trim();
  const data = contentType === "application/json"
    ? await response.json() as T
    : await response.text() as unknown as T;
  return { data, error: null };
};
