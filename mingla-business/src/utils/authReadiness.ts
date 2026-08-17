export type BusinessAuthStatus =
  | "bootstrapping"
  | "signed_out"
  | "signed_in_ready"
  | "refreshing"
  | "error";

export type BusinessAuthErrorCode =
  | "auth_not_ready"
  | "signed_out"
  | "unauthenticated";

export interface MinimalAuthSession {
  access_token?: string | null;
}

export interface MinimalAuthUser {
  id?: string | null;
}

export class BusinessAuthNotReadyError extends Error {
  code: BusinessAuthErrorCode;
  authStatus?: BusinessAuthStatus;

  constructor(
    code: BusinessAuthErrorCode,
    message: string,
    authStatus?: BusinessAuthStatus,
  ) {
    super(message);
    this.name = "BusinessAuthNotReadyError";
    this.code = code;
    this.authStatus = authStatus;
  }
}

export const hasUsableBusinessSession = (
  session: MinimalAuthSession | null,
): boolean =>
  typeof session?.access_token === "string" &&
  session.access_token.trim().length > 0;

// META-ORCH-1235 (§5.2) — canonical stored-web-session predicate.
//
// Two readers used to decide "is there a stored web session?" with DIFFERENT
// acceptance criteria: AuthContext's `readStoredWebSession` (strict — requires
// a usable `access_token` via `hasUsableBusinessSession`) and `_layout.tsx`'s
// `hasStoredSupabaseWebSession` (loose — matched any value containing the
// substring "access_token"). When they disagreed on a stale/partial token, the
// loose reader kept `isWebAuthResolving` true while the strict reader rejected
// the session → lingering AuthResolvingScreen. This single predicate is the ONE
// source of truth, built on the SAME strict `hasUsableBusinessSession` check, so
// the two readers can no longer disagree. NEVER looser than the strict reader.
const SUPABASE_AUTH_STORAGE_KEY_RE = /^sb-.+-auth-token$/;

export const hasUsableStoredWebSession = (): boolean => {
  if (
    typeof window === "undefined" ||
    typeof window.localStorage === "undefined"
  ) {
    return false;
  }
  try {
    const { localStorage } = window;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key === null || !SUPABASE_AUTH_STORAGE_KEY_RE.test(key)) continue;
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      let parsed: MinimalAuthSession | null;
      try {
        parsed = JSON.parse(raw) as MinimalAuthSession;
      } catch {
        // Unparseable value can never be a usable session — keep scanning.
        continue;
      }
      if (hasUsableBusinessSession(parsed)) return true;
    }
  } catch {
    return false;
  }
  return false;
};

export const deriveBusinessAuthStatus = ({
  authError,
  loading,
  session,
  user,
}: {
  authError: Error | null;
  loading: boolean;
  session: MinimalAuthSession | null;
  user: MinimalAuthUser | null;
}): BusinessAuthStatus => {
  if (loading) {
    return hasUsableBusinessSession(session) && user !== null
      ? "refreshing"
      : "bootstrapping";
  }
  if (authError !== null) return "error";
  if (hasUsableBusinessSession(session) && typeof user?.id === "string") {
    return "signed_in_ready";
  }
  return "signed_out";
};

export const isBusinessAuthReady = (
  authStatus: BusinessAuthStatus,
  session: MinimalAuthSession | null,
): boolean =>
  authStatus === "signed_in_ready" && hasUsableBusinessSession(session);

// ─────────────────────────────────────────────────────────────────────
// issue #2181 [anon checkout gate] — IDENTITY SETTLED, which is NOT the
// same question as `isBusinessAuthReady`.
//
// `isBusinessAuthReady` asks "is there a usable bearer token attached?".
// For a signed-out visitor that is `false` in EVERY reachable phase and
// FOREVER — `deriveBusinessAuthStatus` terminates such a visitor at
// `signed_out`, and no code path carries `signed_out` to `signed_in_ready`
// without a sign-in. It is a steady state, not a pending one.
//
// Gating an ANON-TOLERANT public read on it is therefore not "slow", it is
// "never": the query stays `enabled: false`, its `loading` never clears, and
// a fail-closed consumer disables its purchase entry permanently. That is
// exactly how a signed-out guest lost the ability to buy a ticket (#2181) —
// every internal check was made from a signed-in session, where the
// predicate is true and the bug is invisible.
//
// This predicate asks the question an anon-tolerant reader actually needs:
// "do we positively KNOW who is looking?" — true for a ready signed-in
// session AND for a resolved signed-out visitor, false only while the
// identity is genuinely undetermined (`bootstrapping`, `refreshing`) or the
// auth bootstrap itself failed (`error`). Those three stay fail-closed.
//
// Use `isBusinessAuthReady` to gate reads that REQUIRE a token.
// Use this to gate reads that merely need to know WHICH identity they are
// reading for.
//
// It takes the provider's ALREADY-DERIVED `isAuthReady` rather than
// recomputing it from `(authStatus, session)`, so `AuthContext` remains the
// one owner of that derivation (Constitution #2) and the two can never drift.
// ─────────────────────────────────────────────────────────────────────
export const isBusinessAuthScopeResolved = (
  authStatus: BusinessAuthStatus,
  isAuthReady: boolean,
): boolean => isAuthReady || authStatus === "signed_out";

export const businessAuthErrorCodeForStatus = (
  authStatus: BusinessAuthStatus,
): BusinessAuthErrorCode =>
  authStatus === "signed_out" ? "signed_out" : "auth_not_ready";

export const requireBusinessAuthReady = (
  authStatus: BusinessAuthStatus,
  session: MinimalAuthSession | null,
): void => {
  if (isBusinessAuthReady(authStatus, session)) return;
  const code = businessAuthErrorCodeForStatus(authStatus);
  throw new BusinessAuthNotReadyError(
    code,
    code === "signed_out"
      ? "Sign in before continuing."
      : "Finishing sign-in. Try again in a moment.",
    authStatus,
  );
};

export const isSupabaseAuthSessionMissingError = (error: unknown): boolean => {
  if (error === null || typeof error !== "object") return false;
  const record = error as { name?: unknown; message?: unknown; code?: unknown };
  const name = typeof record.name === "string" ? record.name : "";
  const message = typeof record.message === "string" ? record.message : "";
  const code = typeof record.code === "string" ? record.code : "";
  return (
    name === "AuthSessionMissingError" ||
    code === "session_not_found" ||
    /auth session missing/i.test(message)
  );
};

// ─────────────────────────────────────────────────────────────────────
// ORCH-1106 [native authenticated, no-brand degraded shell] — boot-probe
// auth-error classifier.
//
// On cold start, `supabase.auth.getSession()` returns a truthy `user` from
// the cached token WITHOUT any server validation (auth-js `__loadSession`
// returns a non-expired stored session as-is, no network call). If that
// session was killed server-side (revoked / signed-out-elsewhere / password
// change) but the cached access token has not yet locally expired, the app
// believes the user is signed in and strands them on a brand-less degraded
// shell (no `SIGNED_OUT` ever fires). To detect this, AuthContext performs
// ONE authenticated probe (`getUser()` — a real `GET /user` network call)
// after a locally-trusted session. This function classifies the probe's
// error so we sign out ONLY on an explicit auth/token invalidation and
// NEVER on a transport failure (offline / timeout / DNS / 5xx), which must
// keep the user signed in.
//
// DANGER: get this wrong in the permissive direction and you log everyone
// out on a flaky network. The default for ANY ambiguous / unrecognized
// error is `keep_session` (fail-OPEN toward staying signed in). Only a
// POSITIVELY-identified auth invalidation returns `invalid_session`.
// ─────────────────────────────────────────────────────────────────────

export type BootSessionProbeVerdict = "invalid_session" | "keep_session";

// HTTP statuses that, for an authenticated `GET /user`, mean the token is
// not accepted by the auth server (the session is dead). 403 is included
// because GoTrue returns it for some revoked/forbidden-token cases.
const INVALID_SESSION_HTTP_STATUSES = new Set<number>([401, 403]);

// auth-js error `code` values that positively indicate an invalid/expired
// session or token (NOT a transport problem).
const INVALID_SESSION_AUTH_CODES = new Set<string>([
  "session_not_found",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_expired",
  "bad_jwt",
  "no_authorization",
]);

// auth-js error `name` values that positively indicate an invalid session.
const INVALID_SESSION_AUTH_NAMES = new Set<string>([
  "AuthSessionMissingError",
  "AuthInvalidTokenResponseError",
  "AuthInvalidJwtError",
]);

const readErrorField = (error: unknown, key: string): unknown => {
  if (error === null || typeof error !== "object") return undefined;
  return (error as Record<string, unknown>)[key];
};

/**
 * Classify the error returned by the boot-time `supabase.auth.getUser()`
 * probe. `null`/`undefined` error (the probe succeeded — valid session) →
 * `keep_session`. A POSITIVELY-identified auth invalidation → `invalid_session`.
 * Everything else (network / timeout / 5xx / retryable / unknown) →
 * `keep_session` (fail-open: never sign out on transport failure).
 */
export const classifyBootSessionProbe = (
  error: unknown,
): BootSessionProbeVerdict => {
  // No error → the server accepted the token → genuinely valid session.
  if (error === null || error === undefined) return "keep_session";

  // A retryable fetch error is auth-js's explicit transport-failure class
  // (offline, DNS, timeout, 5xx, aborted). NEVER sign out on this.
  const name = readErrorField(error, "name");
  if (name === "AuthRetryableFetchError") return "keep_session";

  // Plain network failures surface as a TypeError ("Network request failed"
  // on RN / "Failed to fetch" on web) — not an auth signal. Keep the session.
  if (name === "TypeError") return "keep_session";

  // Positively-identified invalid-session error names.
  if (typeof name === "string" && INVALID_SESSION_AUTH_NAMES.has(name)) {
    return "invalid_session";
  }

  // Reuse the existing AuthSessionMissingError matcher (covers message-only
  // shapes too).
  if (isSupabaseAuthSessionMissingError(error)) return "invalid_session";

  // Positively-identified invalid-session error codes.
  const code = readErrorField(error, "code");
  if (typeof code === "string" && INVALID_SESSION_AUTH_CODES.has(code)) {
    return "invalid_session";
  }

  // HTTP status: 401/403 from the auth server = token rejected. 5xx / 408 /
  // 429 / 0 (network) are transport — keep the session.
  const status = readErrorField(error, "status");
  if (typeof status === "number" && INVALID_SESSION_HTTP_STATUSES.has(status)) {
    return "invalid_session";
  }

  // Anything else (unknown error shape, 5xx, server hiccup) — fail OPEN:
  // keep the user signed in and let the normal retry paths handle it.
  return "keep_session";
};

export const isBusinessAuthNotReadyError = (
  error: unknown,
): error is BusinessAuthNotReadyError =>
  error instanceof BusinessAuthNotReadyError ||
  (error !== null &&
    typeof error === "object" &&
    (error as { name?: unknown }).name === "BusinessAuthNotReadyError" &&
    typeof (error as { code?: unknown }).code === "string");

export const toBusinessAuthNotReadyError = (
  error: unknown,
): BusinessAuthNotReadyError | null => {
  if (isBusinessAuthNotReadyError(error)) return error;
  if (isSupabaseAuthSessionMissingError(error)) {
    return new BusinessAuthNotReadyError(
      "auth_not_ready",
      "Finishing sign-in. Try again in a moment.",
    );
  }
  return null;
};
