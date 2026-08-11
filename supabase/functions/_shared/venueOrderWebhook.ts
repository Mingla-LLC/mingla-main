// ===========================================================================
// Issue #1790 (SPEC #1788 P-28) — venue-order webhook branches.
//
// Co-located as a shared module (the stayPaymentWebhook.ts pattern) so the
// routers stay thin and this logic is unit-testable without importing a
// serve()-on-load entry.
//
// Stripe   — discriminated by `metadata.mingla_venue_order_id`, the same marker
//            shape the RSVP-contribution branch uses
//            (metadata.mingla_purpose === "rsvp_contribution",
//            _shared/stripeWebhookRouter.ts:154). Checked BEFORE the ticket
//            finalize path so the two money paths never cross.
// Paystack — discriminated by the `mingla_vo_` reference prefix, the way the
//            stay arm is discriminated.
//
// BOTH rails converge on ONE database function, pg_venue_order_finalize_payment,
// which is idempotent (FOR UPDATE + early return), gates amount + currency, and
// writes the payout fee snapshot in the SAME transaction as the paid flip. No
// finalize logic is duplicated here.
// ===========================================================================

// deno-lint-ignore-file no-explicit-any

// Issue #1791 — the moment a venue order becomes REAL is the moment staff must
// be told, and this is the only place in the codebase that knows it. `status`
// discriminates the real flip ('finalized') from a webhook replay ('replayed'),
// so a retried delivery cannot re-ring the pass.
import { fireVenueOrderPlacedForOrder } from "./venueOrderNotify.ts";

type ServiceClient = any;

export interface VenueOrderStripeEvent {
  id: string;
  type: string;
  account?: string | null;
  data: { object: Record<string, unknown> };
}

export interface VenueOrderFinalizeResult {
  matched: boolean;
  status: string;
  orderId?: string;
  brandId?: string | null;
}

function metadataOf(value: Record<string, unknown>): Record<string, unknown> {
  const metadata = value.metadata;
  return metadata && typeof metadata === "object"
    ? metadata as Record<string, unknown>
    : {};
}

function objectId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object") {
    const id = (value as Record<string, unknown>).id;
    return typeof id === "string" && id.length > 0 ? id : null;
  }
  return null;
}

/** The metadata marker Mingla sets at create. Never inferred from an amount. */
export function venueOrderIdFromStripeEvent(
  event: VenueOrderStripeEvent,
): string | null {
  const value = metadataOf(event.data.object).mingla_venue_order_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function isVenueOrderStripeEvent(event: VenueOrderStripeEvent): boolean {
  return venueOrderIdFromStripeEvent(event) !== null;
}

/**
 * The provider fee, when Stripe actually told us. `balance_transaction` is an
 * ID string unless expanded, and a fee we do not KNOW must stay unknown: a zero
 * placeholder would over-release the venue by exactly the processing cost. The
 * shipped payout-release-sweep fee-capture loop resolves it later
 * (list_missing_payout_source_fees), and until then the money simply waits.
 */
function providerFeeFromCharge(
  charge: Record<string, unknown> | null,
): { feeCents: number | null; balanceTransactionId: string | null } {
  if (charge === null) return { feeCents: null, balanceTransactionId: null };
  const bt = charge.balance_transaction;
  if (bt && typeof bt === "object") {
    const row = bt as Record<string, unknown>;
    const fee = Number(row.fee);
    return {
      feeCents: Number.isSafeInteger(fee) && fee >= 0 ? fee : null,
      balanceTransactionId: objectId(row.id),
    };
  }
  return { feeCents: null, balanceTransactionId: objectId(bt) };
}

export async function handleVenueOrderStripeEvent(
  client: ServiceClient,
  event: VenueOrderStripeEvent,
): Promise<string | null> {
  const orderId = venueOrderIdFromStripeEvent(event);
  if (orderId === null) return null;
  const object = event.data.object;

  if (
    event.type === "payment_intent.payment_failed" ||
    event.type === "payment_intent.canceled"
  ) {
    // NOTHING has been charged. The row is marked failed so the guest's status
    // card can say so honestly, and so a retry mints a fresh order rather than
    // resurrecting this one. Only a row still pending is touched — a paid order
    // is never un-paid by a late failure event.
    await client
      .from("venue_orders")
      .update({ payment_status: "failed", failed_at: new Date().toISOString() })
      .eq("id", orderId)
      .eq("payment_status", "pending");
    const { data } = await client.from("venue_orders").select("brand_id")
      .eq("id", orderId).maybeSingle();
    return typeof data?.brand_id === "string" ? data.brand_id : null;
  }

  let amountCents: number;
  let currency: string;
  let paymentIntentId: string | null;
  let chargeId: string | null = null;
  let feeCents: number | null = null;
  let balanceTransactionId: string | null = null;

  if (event.type === "payment_intent.succeeded") {
    const charges = object.charges as
      | { data?: Array<Record<string, unknown>> }
      | undefined;
    const latestChargeObject =
      (object.latest_charge && typeof object.latest_charge === "object"
        ? object.latest_charge as Record<string, unknown>
        : null) ?? charges?.data?.[0] ?? null;
    chargeId = objectId(object.latest_charge ?? charges?.data?.[0] ?? null);
    const fee = providerFeeFromCharge(latestChargeObject);
    feeCents = fee.feeCents;
    balanceTransactionId = fee.balanceTransactionId;
    amountCents = Number(object.amount_received ?? object.amount);
    currency = String(object.currency ?? "").toUpperCase();
    paymentIntentId = objectId(object.id);
  } else if (event.type === "checkout.session.completed") {
    amountCents = Number(object.amount_total);
    currency = String(object.currency ?? "").toUpperCase();
    paymentIntentId = objectId(object.payment_intent);
  } else {
    return null;
  }

  if (!Number.isSafeInteger(amountCents) || !/^[A-Z]{3}$/.test(currency)) {
    throw new Error("venue_order_provider_evidence_invalid");
  }

  const { data, error } = await client.rpc("pg_venue_order_finalize_payment", {
    p_order_id: orderId,
    p_provider: "stripe",
    p_paid_amount_cents: amountCents,
    p_currency: currency,
    p_payment_intent_id: paymentIntentId,
    p_charge_id: chargeId,
    p_provider_fee_cents: feeCents,
    p_provider_balance_transaction_id: balanceTransactionId,
  });
  if (error) {
    throw new Error(`venue_order_finalize_failed: ${error.message}`);
  }
  const result = (data ?? {}) as VenueOrderFinalizeResult;
  // Issue #1791 (P-53/P-54) — T0 of the alerting ladder. ONLY on the real flip:
  // 'replayed' means a webhook we already processed came back, and a second
  // "new order" push for one order is how staff learn to ignore them.
  if (result.status === "finalized") {
    await fireVenueOrderPlacedForOrder(client, orderId);
  }
  return typeof result.brandId === "string" ? result.brandId : null;
}

// ---------------------------------------------------------------------------
// Paystack. The reference is minted and PERSISTED before the Paystack call, and
// carries a UNIQUE index, exactly as the ticket path persists its reference
// first — Paystack accepts no idempotency key, so the reference IS the key.
// ---------------------------------------------------------------------------
export const VENUE_ORDER_PAYSTACK_PREFIX = "mingla_vo_";

export function isVenueOrderPaystackReference(reference: unknown): boolean {
  return typeof reference === "string" &&
    reference.startsWith(VENUE_ORDER_PAYSTACK_PREFIX);
}

export function venueOrderPaystackReference(orderId: string): string {
  return `${VENUE_ORDER_PAYSTACK_PREFIX}${orderId}_${
    Date.now().toString(36)
  }`;
}

/**
 * Finalize a verified Paystack charge for a venue order.
 *
 * `verified` is the VERIFY-BY-REFERENCE response, not the webhook body: the
 * webhook body is a hint, the verify call is the truth. Paystack returns the
 * real `fees`, so unlike the Stripe rail the payout fee snapshot lands here.
 */
export async function handleVenueOrderPaystackCharge(
  client: ServiceClient,
  reference: string,
  verified: Record<string, unknown>,
): Promise<VenueOrderFinalizeResult> {
  const { data: order, error: lookupError } = await client
    .from("venue_orders")
    .select("id, brand_id")
    .eq("paystack_reference", reference)
    .maybeSingle();
  if (lookupError) {
    throw new Error(`venue_order_paystack_lookup_failed: ${lookupError.message}`);
  }
  if (!order || typeof order.id !== "string") {
    return { matched: false, status: "not_found" };
  }

  const amount = Number(verified.amount);
  const currency = String(verified.currency ?? "").toUpperCase();
  const feesRaw = verified.fees;
  const fees = feesRaw === null || feesRaw === undefined ? null : Number(feesRaw);
  if (!Number.isSafeInteger(amount) || !/^[A-Z]{3}$/.test(currency)) {
    throw new Error("venue_order_provider_evidence_invalid");
  }

  const { data, error } = await client.rpc("pg_venue_order_finalize_payment", {
    p_order_id: order.id,
    p_provider: "paystack",
    p_paid_amount_cents: amount,
    p_currency: currency,
    p_payment_intent_id: reference,
    p_charge_id: verified.id === undefined || verified.id === null
      ? null
      : String(verified.id),
    p_provider_fee_cents: fees !== null && Number.isSafeInteger(fees) && fees >= 0
      ? fees
      : null,
    p_provider_balance_transaction_id: null,
  });
  if (error) {
    throw new Error(`venue_order_finalize_failed: ${error.message}`);
  }
  const result = (data ?? {}) as VenueOrderFinalizeResult;
  // Issue #1791 — same T0 alert on the Paystack rail, same replay guard. A
  // venue in Lagos must not be the one venue whose queue stays silent.
  if (result.status === "finalized") {
    await fireVenueOrderPlacedForOrder(client, order.id);
  }
  return {
    matched: true,
    status: String(result.status ?? "unknown"),
    orderId: order.id,
    brandId: typeof order.brand_id === "string" ? order.brand_id : null,
  };
}
