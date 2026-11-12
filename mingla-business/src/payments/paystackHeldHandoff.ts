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

const held = new Map<string, HeldPaystackHandoff>();

/**
 * The held page for this event when it belongs to the identical purchase and
 * has not expired; otherwise null. An expired page is deleted.
 */
export const readHeldHandoff = (
  eventId: string,
  fingerprint: string,
  now: number = Date.now(),
): HeldPaystackHandoff | null => {
  const entry = held.get(eventId);
  if (entry === undefined) return null;
  if (now - entry.cachedAt >= PAYSTACK_HANDOFF_TTL_MS) {
    held.delete(eventId);
    return null;
  }
  return entry.fingerprint === fingerprint ? entry : null;
};

export const holdHandoff = (
  eventId: string,
  entry: HeldPaystackHandoff,
): void => {
  held.set(eventId, entry);
};

/** The order finalized or the sale was refused: the page is spent. */
export const clearHeldHandoff = (eventId: string): void => {
  held.delete(eventId);
};

export const clearAllHeldHandoffs = (): void => {
  held.clear();
};

registerSignOutCleanup(clearAllHeldHandoffs);
