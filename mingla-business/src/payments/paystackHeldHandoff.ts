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
 * Every held page is dropped on sign-out (Constitution #6): this module loads
 * on demand with checkout, so it registers with the sign-out cleanup registry.
 */

import { registerSignOutCleanup } from "../utils/signOutCleanups";

export interface HeldPaystackHandoff {
  fingerprint: string;
  authorizationUrl: string;
  checkoutSessionId: string;
  buyerStatusToken: string;
  cachedAt: number;
}

/**
 * `ticket-checkout-create` gives the session 15 minutes from when it writes the
 * row. The hold is timed from just before the create call and stops a minute
 * early, so it never outlives the session it pays into.
 */
export const PAYSTACK_HANDOFF_TTL_MS = 14 * 60 * 1000;

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
  now: number = Date.now(),
): HeldPaystackHandoff | null => {
  const forEvent = held.get(eventId);
  if (forEvent === undefined) return null;
  for (const [key, entry] of forEvent) {
    if (now - entry.cachedAt >= PAYSTACK_HANDOFF_TTL_MS) forEvent.delete(key);
  }
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

export const clearAllHeldHandoffs = (): void => {
  held.clear();
  generation += 1;
};

registerSignOutCleanup(clearAllHeldHandoffs);
