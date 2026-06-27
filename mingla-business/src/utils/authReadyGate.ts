/**
 * META-ORCH-1232 (C2) — await-until-ready guard for imperative brand mutations.
 *
 * Root cause this closes: `useBrands` (the read) gates on `isAuthReady`, but the
 * brand MUTATION hooks (`useCreateBrand` / `useUpdateBrand` / `useCreateVenueBrand`)
 * do not. On web the Supabase JWT can attach late (fresh sign-in / token refresh);
 * an insert fired pre-JWT runs as `anon`, `auth.uid()` is NULL, and the `brands`
 * INSERT RLS `WITH CHECK (account_id = auth.uid())` rejects it — surfacing as a
 * swallowed toast indistinguishable from "nothing happened".
 *
 * A React Query mutation is imperative (no `enabled` flag), so the read-side gate
 * has no direct equivalent. This helper provides the agreed mechanism: before the
 * service write, AWAIT a short, bounded readiness wait (poll a readiness getter,
 * cap 5s). If auth becomes ready in the window, proceed (now correctly authed).
 * If the cap elapses still-not-ready, THROW `AuthNotReadyError` so H1 surfaces it
 * as a visible, retryable error — NEVER silently drop the user's intent.
 */

/** Default readiness wait cap (ms) — matches SPEC §2 C2 "cap e.g. 5 seconds". */
export const AUTH_READY_WAIT_CAP_MS = 5000;

/** Poll interval while waiting for auth to settle. */
export const AUTH_READY_POLL_INTERVAL_MS = 100;

/**
 * Thrown when auth is still not ready after the bounded wait. The caller (H1)
 * renders this with distinct, retryable copy ("Finishing sign-in… tap Retry in a
 * moment.") — it is a preserved, explicit, retryable failure, not a silent drop.
 */
export class AuthNotReadyError extends Error {
  constructor(message = "Auth not ready: finishing sign-in. Retry in a moment.") {
    super(message);
    this.name = "AuthNotReadyError";
  }
}

export const isAuthNotReadyError = (error: unknown): error is AuthNotReadyError =>
  error instanceof AuthNotReadyError ||
  (error instanceof Error && error.name === "AuthNotReadyError");

export interface AwaitAuthReadyOptions {
  /**
   * Returns the CURRENT auth-ready state. Must be a fresh read each call (e.g. a
   * ref-backed getter that the hook keeps in sync with `isAuthReady`) so the loop
   * observes auth flipping true mid-flight.
   *
   * META-ORCH-1232 follow-up (fresh-signup gap): may be ASYNC. The authoritative
   * readiness signal for a brand WRITE is the presence of a real attached access
   * token (`supabase.auth.getSession()` → `session.access_token`), which is an
   * async local read. Returning a `Promise<boolean>` lets the same bounded-poll
   * loop verify the REAL session — not merely the `isAuthReady` flag, which on a
   * fresh signup flips true a beat BEFORE the Supabase client attaches the token
   * to outgoing PostgREST requests (so the insert would still go out as anon).
   */
  isReady: () => boolean | Promise<boolean>;
  /** Total wait cap before throwing (ms). Defaults to AUTH_READY_WAIT_CAP_MS. */
  capMs?: number;
  /** Poll interval (ms). Defaults to AUTH_READY_POLL_INTERVAL_MS. */
  pollMs?: number;
  /** Injectable sleep (tests). Defaults to a real setTimeout-backed delay. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock (tests). Defaults to Date.now. */
  now?: () => number;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolve once `isReady()` returns true within `capMs`; otherwise throw
 * `AuthNotReadyError`. Returns immediately (no delay) when already ready.
 *
 * `isReady` may be sync or async (it is always `await`ed) so callers can use the
 * REAL attached-session check (the authoritative write-gate signal) as well as
 * the cheap `isAuthReady` flag.
 */
export const awaitAuthReady = async (
  options: AwaitAuthReadyOptions,
): Promise<void> => {
  const {
    isReady,
    capMs = AUTH_READY_WAIT_CAP_MS,
    pollMs = AUTH_READY_POLL_INTERVAL_MS,
    sleep = realSleep,
    now = Date.now,
  } = options;

  if (await isReady()) return;

  const deadline = now() + capMs;
  while (now() < deadline) {
    await sleep(pollMs);
    if (await isReady()) return;
  }

  throw new AuthNotReadyError();
};

/**
 * META-ORCH-1232 follow-up (fresh-signup brand-create gap).
 *
 * The flag-only gate (`awaitAuthReady({ isReady: isAuthReadyGetter })`) closed
 * brand-create for EXISTING accounts but NOT for brand-new signups: on a fresh
 * signup `isAuthReady` flips true a beat BEFORE the Supabase client attaches the
 * access token to outgoing PostgREST requests, so a brand insert fired on that
 * flag still goes out as the anon role with no JWT — the DB throws
 * `permission denied for table brands` + `new row violates row-level security
 * policy for table "creator_accounts"` and nothing persists.
 *
 * The READ path (`brandsService.getBrands`, H3) already does the RIGHT thing: it
 * calls `supabase.auth.getSession()` and refuses to proceed without a real
 * session. This is the WRITE-path equivalent: bounded-poll (≤cap) the SAME
 * Supabase client singleton the brand service uses for the insert until
 * `getSession()` returns a session with a NON-EMPTY `access_token`. If the cap
 * elapses still without a token, `awaitAuthReady` throws `AuthNotReadyError` so
 * H1 surfaces it as a visible, retryable error — NEVER a silent drop.
 *
 * It is the SESSION-TOKEN presence (not the flag) that must pass before the
 * insert: it is impossible for a brand insert to be issued without an attached
 * access token. The `getSession()` call is a LOCAL read (no network round-trip).
 *
 * @param getSession the client's `auth.getSession` (bound to the SAME singleton
 *   that issues the write). Injectable for tests.
 */
export const awaitSessionAttached = async (
  getSession: () => Promise<{
    data: { session: { access_token?: string | null } | null };
  }>,
  options?: Omit<AwaitAuthReadyOptions, "isReady">,
): Promise<void> => {
  const hasToken = async (): Promise<boolean> => {
    const {
      data: { session },
    } = await getSession();
    return (
      session !== null &&
      typeof session.access_token === "string" &&
      session.access_token.length > 0
    );
  };
  await awaitAuthReady({ isReady: hasToken, ...options });
};
