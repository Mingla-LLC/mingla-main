/**
 * issue #4522 E-2 / E-3 — a trip checkout coming back from the provider page.
 *
 * The provider's Back button (or a refresh, or reopening the checkout link)
 * reloads the Review & pay step, which wipes the in-memory cart. Two things
 * went wrong after that reload:
 *
 * - E-2: the lines came back with their "Pay over time" choice but the
 *   cart-level choice the quote is asked for stayed "full", so the total, the
 *   banner and the Pay button showed the full price while the schedule (and the
 *   provider page) said today's deposit. Each line's choice is now restored
 *   through `setLinePaymentPlanChoice`, the one rule that keeps the quoted
 *   choice following the lines (#4522 W-4), so every amount comes from one
 *   quote for the choice on screen.
 * - E-3: the attempt id and the provider page the cart was handed lived only
 *   in memory, so the next Pay opened a SECOND provider session while the
 *   first stayed payable. Both are now saved with the resume payload (the
 *   #3281 `providerHandoff`, which the event checkout already keeps) and taken
 *   back here; `tripResumeDecision` then re-follows the still-open page, sends
 *   the same attempt id (the server answers with the same checkout), or — when
 *   that checkout is over — forgets it before a new one is opened.
 *
 * Pure (no React, no network): the screen passes the cart setters and the
 * status call, and tests drive it with the real `CartProvider`.
 */
import type {
  CheckoutAddOnPaymentMode,
  CheckoutAddOnRequest,
  CheckoutLinePlanChoice,
  HeldCheckoutAttempt,
} from "@mingla/offering-rendering/ticketCheckoutContract";

import type { BuyerDetails } from "./CartContext";
import type { CheckoutResumePayload } from "./checkoutPersistence";

/**
 * A bank-transfer (second provider) page the buyer opened and left is
 * "abandoned" at the provider, which the status check reports as a failed
 * verify — but that page can still be paid, and the provider has no way to
 * close it. It is never forgotten: forgetting it would open a second payable
 * page for the same cart.
 */
export const STILL_PAYABLE_FAILURE_CODES: ReadonlySet<string> = new Set([
  "paystack_charge_abandoned",
]);

/** The session statuses whose provider page can still be paid. */
export const RESUMABLE_TRIP_SESSION_STATUSES: ReadonlySet<string> = new Set([
  "awaiting_web_redirect",
  "requires_payment",
  "processing_payment",
]);

export interface TripResumeCart {
  setLineQuantity: (params: {
    ticketTypeId: string;
    ticketName: string;
    unitPrice: number;
    unitPriceGbp?: number;
    currency: string;
    isFree: boolean;
    quantity: number;
    paymentPlanChoice?: CheckoutLinePlanChoice;
    addOns?: readonly CheckoutAddOnRequest[];
    addonPaymentMode?: CheckoutAddOnPaymentMode;
  }) => void;
  setLinePaymentPlanChoice: (
    ticketTypeId: string,
    choice: CheckoutLinePlanChoice,
  ) => void;
  setBuyer: (patch: Partial<BuyerDetails>) => void;
  restoreCheckoutAttempt: (attempt: HeldCheckoutAttempt) => void;
}

/** The checkout this cart was already handed, as saved before the redirect. */
export interface ResumedTripCheckout {
  checkoutSessionId: string;
  buyerStatusToken: string;
  /** The Review & pay cart fingerprint the checkout was opened for. */
  fingerprint: string | null;
  /** Only an https provider page is ever followed back out of storage. */
  redirectUrl: string | null;
}

/**
 * Restores the cart (only when it is empty: a reload) and, always, the attempt
 * and checkout it was handed. Returns that checkout, or null when none.
 */
export function restoreTripCheckout(
  payload: CheckoutResumePayload | null,
  cart: TripResumeCart,
  cartIsEmpty: boolean,
): ResumedTripCheckout | null {
  if (payload === null) return null;
  if (cartIsEmpty) {
    for (const line of payload.lines) {
      const choice = line.paymentPlanChoice ?? "full";
      cart.setLineQuantity({
        ticketTypeId: line.ticketTypeId,
        ticketName: line.ticketName,
        unitPrice: line.unitPrice,
        unitPriceGbp: line.unitPriceGbp,
        currency: line.currency,
        isFree: line.isFree,
        quantity: line.quantity,
        paymentPlanChoice: choice,
        addOns: line.addOns,
        addonPaymentMode: line.addonPaymentMode,
      });
      // E-2 — the quoted (cart-level) choice follows the restored lines.
      cart.setLinePaymentPlanChoice(line.ticketTypeId, choice);
    }
    cart.setBuyer(payload.buyer);
  }
  const attempt = payload.checkoutAttempt as Record<string, unknown> | undefined;
  if (
    attempt !== undefined && attempt !== null &&
    typeof attempt.fingerprint === "string" && typeof attempt.id === "string"
  ) {
    cart.restoreCheckoutAttempt({ fingerprint: attempt.fingerprint, id: attempt.id });
  }
  const handoff = payload.providerHandoff as Record<string, unknown> | undefined;
  const fingerprint = handoff !== undefined && handoff !== null &&
      typeof handoff.fingerprint === "string"
    ? handoff.fingerprint
    : null;
  const redirectUrl = fingerprint !== null && typeof handoff?.redirectUrl === "string" &&
      handoff.redirectUrl.startsWith("https://")
    ? handoff.redirectUrl
    : null;
  return {
    checkoutSessionId: payload.checkoutSessionId,
    buyerStatusToken: payload.buyerStatusToken,
    fingerprint,
    redirectUrl,
  };
}

export type TripResumeDecision =
  /** The held checkout was paid: go to the confirmation. */
  | { kind: "confirm" }
  /** The held provider page is still open for this cart: follow it. */
  | { kind: "follow"; url: string }
  /**
   * Ask the server. `forget` — the held checkout is over (expired, failed):
   * drop it and its attempt first, so a new checkout is opened. Otherwise the
   * same attempt id goes again and the server answers with the same checkout.
   */
  | { kind: "create"; forget: boolean };

export async function tripResumeDecision(
  resumed: ResumedTripCheckout | null,
  cartFingerprint: string,
  getStatus: (
    checkoutSessionId: string,
    buyerStatusToken: string,
  ) => Promise<{ status: string; order: unknown; error?: string | null }>,
): Promise<TripResumeDecision> {
  // No held checkout, or the cart changed since: a different purchase.
  if (resumed === null || resumed.fingerprint !== cartFingerprint) {
    return { kind: "create", forget: false };
  }
  let status: { status: string; order: unknown; error?: string | null };
  try {
    status = await getStatus(resumed.checkoutSessionId, resumed.buyerStatusToken);
  } catch {
    // No answer: the provider page itself says whether it can still pay; with
    // no page, the same attempt lets the server answer.
    return resumed.redirectUrl !== null
      ? { kind: "follow", url: resumed.redirectUrl }
      : { kind: "create", forget: false };
  }
  if (status.order !== null && status.order !== undefined) return { kind: "confirm" };
  if (status.status === "paid_completed") return { kind: "confirm" };
  if (
    RESUMABLE_TRIP_SESSION_STATUSES.has(status.status) ||
    (typeof status.error === "string" && STILL_PAYABLE_FAILURE_CODES.has(status.error))
  ) {
    return resumed.redirectUrl !== null
      ? { kind: "follow", url: resumed.redirectUrl }
      : { kind: "create", forget: false };
  }
  return { kind: "create", forget: true };
}

/**
 * issue #4522 E-3 — the checkout to close before a new one is opened: the one
 * this cart was handed (in memory, or restored after a reload) when the cart
 * has CHANGED since. An unchanged cart re-follows or replays it instead.
 */
export function checkoutToSupersede(
  held: {
    fingerprint: string;
    handoff: { checkoutSessionId: string; buyerStatusToken: string };
  } | null,
  resumed: ResumedTripCheckout | null,
  cartFingerprint: string,
): { checkoutSessionId: string; buyerStatusToken: string } | null {
  if (held !== null && held.fingerprint !== cartFingerprint) {
    return {
      checkoutSessionId: held.handoff.checkoutSessionId,
      buyerStatusToken: held.handoff.buyerStatusToken,
    };
  }
  if (resumed !== null && resumed.fingerprint !== cartFingerprint) {
    return {
      checkoutSessionId: resumed.checkoutSessionId,
      buyerStatusToken: resumed.buyerStatusToken,
    };
  }
  return null;
}

/**
 * issue #4522 E-3 — the confirmation of the checkout this cart was handed.
 * The confirm screen starts only from a provider return (`?cs=`) and reads
 * the checkout from the resume payload, or from `csi` / `bst` when that is
 * gone; without them it rendered nothing.
 */
export function heldCheckoutConfirmPath(
  tripEventId: string,
  held: { checkoutSessionId: string; buyerStatusToken: string },
): string {
  const query = new URLSearchParams({
    cs: "held",
    csi: held.checkoutSessionId,
    bst: held.buyerStatusToken,
  });
  return `/checkout-trip/${tripEventId}/confirm?${query.toString()}`;
}
