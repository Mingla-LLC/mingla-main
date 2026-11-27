// Issue #4624 item 5a (D-5a) — a checkout that uses a capped discount keeps its
// discount hold for as long as the payment page can still take the payment.
//
// The session hold is 15 minutes, but a web Stripe Checkout page stays open 24
// hours by default and a native PaymentIntent never expires. A payment that
// lands after the hold lapsed could push a code past its cap. So, before any
// provider object exists:
//   1. the page end T is the door code's own end (door pay) or now + Stripe's
//      30-minute floor (STRIPE_CHECKOUT_MIN_EXPIRY_MS, 31 minutes so a slow
//      create still clears Stripe's minimum);
//   2. issue_4624_extend_discount_hold moves every limited discount hold of the
//      session to T + 2 minutes (never backwards);
//   3. if it moved any hold, the web Checkout Session closes at T.
// Checkouts with no capped discount make no extra call at all (the session's
// applied discounts carry `limited`) and keep today's 24-hour page. A failed
// extend fails closed: no provider session is created.

import { STRIPE_CHECKOUT_MIN_EXPIRY_MS } from "./doorPayCheckout.ts";

/** The hold outlives the page by this margin. */
export const DISCOUNT_HOLD_GRACE_MS = 2 * 60 * 1000;

export interface DiscountHoldRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export type DiscountHoldResult =
  | { ok: true; extended: boolean; pageEndsMs: number }
  | { ok: false; detail: string };

/** When the payment page must close (ms). Door pay keeps its own end. */
export function cappedDiscountPageEndsMs(
  doorExpiresAtSec: number | null,
  nowMs: number = Date.now(),
): number {
  return doorExpiresAtSec !== null
    ? doorExpiresAtSec * 1000
    : nowMs + STRIPE_CHECKOUT_MIN_EXPIRY_MS;
}

/** Stripe's `expires_at` (whole seconds) for a page that ends at `pageEndsMs`. */
export function discountPageExpiresAtSec(pageEndsMs: number): number {
  return Math.ceil(pageEndsMs / 1000);
}

/**
 * Extends the session's limited discount holds to the page end plus the grace
 * margin. `extended` is true when at least one hold moved, which is the signal
 * to close the web page at the same time.
 */
export async function extendCappedDiscountHold(
  client: DiscountHoldRpcClient,
  checkoutSessionId: string,
  pageEndsMs: number,
): Promise<DiscountHoldResult> {
  if (checkoutSessionId.length === 0) {
    return { ok: false, detail: "discount_hold_session_missing" };
  }
  const { data, error } = await client.rpc("issue_4624_extend_discount_hold", {
    p_checkout_session_id: checkoutSessionId,
    p_until: new Date(pageEndsMs + DISCOUNT_HOLD_GRACE_MS).toISOString(),
  });
  if (error) {
    const message = typeof error === "object" && error !== null &&
        "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
    return { ok: false, detail: `discount_hold_extend_failed:${message}` };
  }
  const moved = Number(data ?? 0);
  if (!Number.isFinite(moved) || moved < 0) {
    return { ok: false, detail: "discount_hold_extend_invalid_result" };
  }
  return { ok: true, extended: moved > 0, pageEndsMs };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * True when the session holds a discount with any limit (ticket cap, total
 * uses or per-buyer). Read from the session's own discounts, or from its
 * items' applied discounts on a replayed session.
 */
export function sessionHasCappedDiscount(session: Record<string, unknown>): boolean {
  const limited = (entry: unknown): boolean =>
    isRecord(entry) && entry.limited === true;
  if (Array.isArray(session.discounts) && session.discounts.some(limited)) {
    return true;
  }
  for (const key of ["lineItems", "items"] as const) {
    const items = session[key];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (isRecord(item) && Array.isArray(item.applied) && item.applied.some(limited)) {
        return true;
      }
    }
  }
  return false;
}

/** The result when nothing was asked of the database (no capped discount). */
export const NO_DISCOUNT_HOLD: DiscountHoldResult = {
  ok: true,
  extended: false,
  pageEndsMs: 0,
};
