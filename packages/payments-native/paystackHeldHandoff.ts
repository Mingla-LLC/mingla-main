/**
 * issue #3281 (bundle 6b) — the Paystack page a Host-app buyer was already
 * sent to, so tapping Pay again on the SAME purchase reopens that page.
 *
 * Without it, a buyer who closed the page before paying was told to "reopen the
 * payment page to finish", but the next tap asked the server for a new checkout
 * and the server (rightly) refused it with 409 `checkout_in_progress`: the buyer
 * was stuck until the session expired. This is the Host-app mirror of
 * Explorer's #2227 cache (`app-mobile/src/payments/nativeCheckoutFlow.ts`).
 *
 * MEMORY ONLY: never AsyncStorage, never a persisted store. A Paystack
 * authorization URL is a bearer capability to a live payment page.
 *
 * Keyed by event and matched on the fingerprint of the exact create request
 * (attempt id, buyer, lines, dates, extras, code, quote). A page is only ever
 * reopened for the identical purchase; any change is a different purchase and
 * runs a fresh create.
 *
 * Shared by both apps (issue #3281 bundle 6d). Pure: each app wires
 * `clearAllHeldHandoffs` into its own sign-out funnel (Constitution #6).
 * Keep this module free of async/await: Explorer's jest compiles packages/
 * with babel-preset-expo, and async pulls in an unresolvable runtime helper.
 */

export interface HeldPaystackHandoff {
  fingerprint: string;
  authorizationUrl: string;
  checkoutSessionId: string;
  buyerStatusToken: string;
  /** Wall clock, taken just before the create call. */
  cachedAt: number;
  /**
   * issue #3281 (bundle 6c) — the same moment on the monotonic clock. A
   * phone's wall clock can be moved back; elapsed time is the larger of the
   * two readings, so neither a clock change nor deep sleep can stretch a hold.
   */
  cachedAtMono: number;
  /**
   * issue #3281 (bundle 6c) — how long the page may be reopened, from the
   * server's own seconds-left on the session (`handoffLifetimeMs`).
   */
  lifetimeMs: number;
}

/** Stop reopening a page this long before the server's session ends. */
export const PAYSTACK_HANDOFF_EXPIRY_MARGIN_MS = 60 * 1000;

/**
 * `ticket-checkout-create` gives the session 15 minutes from when it writes the
 * row. The hold is timed from just before the create call and stops a minute
 * early, so it never outlives the session it pays into.
 */
export const PAYSTACK_HANDOFF_TTL_MS = 14 * 60 * 1000;

/**
 * How long a page created by a request sent just before the hold may be
 * reopened, given the server's seconds-left on the session (any non-number or
 * negative value is ignored, and the 14-minute bound always applies). Counted
 * from before the request, so it can only be shorter than the truth.
 */
export const handoffLifetimeMs = (expiresInSeconds: unknown): number =>
  typeof expiresInSeconds === "number" &&
  Number.isFinite(expiresInSeconds) &&
  expiresInSeconds >= 0
    ? Math.min(
        PAYSTACK_HANDOFF_TTL_MS,
        expiresInSeconds * 1000 - PAYSTACK_HANDOFF_EXPIRY_MARGIN_MS,
      )
    : PAYSTACK_HANDOFF_TTL_MS;

/** Milliseconds on a clock that never goes backwards (wall clock if absent). */
export const monotonicNow = (): number => {
  const performance = (globalThis as { performance?: { now?: () => number } })
    .performance;
  return typeof performance?.now === "function"
    ? performance.now()
    : Date.now();
};

/**
 * Whether the page may still be reopened. Elapsed time is the larger of the
 * wall-clock and monotonic readings: a wall clock moved back cannot extend
 * the hold, and a monotonic clock that pauses in deep sleep cannot either.
 */
export const isHandoffLive = (entry: HeldPaystackHandoff): boolean =>
  Math.max(Date.now() - entry.cachedAt, monotonicNow() - entry.cachedAtMono) <
  entry.lifetimeMs;

/**
 * Held pages per event, then per purchase fingerprint. More than one per event
 * on purpose: a buyer who leaves cart A for cart B and comes back to A must
 * reopen A's page, because A's server session is still live and a new create
 * for it is refused as in progress.
 */
const held = new Map<string, Map<string, HeldPaystackHandoff>>();

/**
 * Bumped by every sign-out. A checkout captures it before its network calls
 * and refuses to hold or open a page if it moved: that page and its status
 * token belong to the session that just ended.
 */
let generation = 0;

export const handoffGeneration = (): number => generation;

/**
 * The held page for this purchase when it has not expired; otherwise null.
 * Expired pages for the event are deleted.
 */
export const readHeldHandoff = (
  eventId: string,
  fingerprint: string,
): HeldPaystackHandoff | null => {
  const forEvent = held.get(eventId);
  if (forEvent === undefined) return null;
  // Map.forEach, not `for…of` destructuring: no babel runtime helper (see
  // the header). Deleting the visited entry during forEach is safe.
  forEvent.forEach((entry, key) => {
    if (!isHandoffLive(entry)) forEvent.delete(key);
  });
  if (forEvent.size === 0) held.delete(eventId);
  return forEvent.get(fingerprint) ?? null;
};

export const holdHandoff = (
  eventId: string,
  entry: HeldPaystackHandoff,
): void => {
  const forEvent = held.get(eventId) ?? new Map<string, HeldPaystackHandoff>();
  forEvent.set(entry.fingerprint, entry);
  held.set(eventId, forEvent);
};

/**
 * The event was bought, or a sale on it was refused: every page held for it
 * is spent. `sinceGeneration` is the sign-out generation the caller captured
 * before its network calls.
 */
export const clearHeldHandoff = (
  eventId: string,
  sinceGeneration: number,
): void => {
  // A check that started before a sign-out must never delete a page the next
  // account has since been given for the same event.
  if (sinceGeneration !== generation) return;
  held.delete(eventId);
};

/**
 * issue #3281 (bundle 6c) — drop ONE purchase's page (it ran out), leaving the
 * event's other carts' pages alone. Ignored after a sign-out, like
 * `clearHeldHandoff`.
 */
export const dropHeldHandoff = (
  eventId: string,
  fingerprint: string,
  sinceGeneration: number,
): void => {
  if (sinceGeneration !== generation) return;
  const forEvent = held.get(eventId);
  if (forEvent === undefined) return;
  forEvent.delete(fingerprint);
  if (forEvent.size === 0) held.delete(eventId);
};

export const clearAllHeldHandoffs = (): void => {
  held.clear();
  generation += 1;
};
