// ===========================================================================
// Issue #1790 (SPEC #1788 P-24) — venue-order-status.
//
// The anon-possession read: `POST { orderId, buyerStatusToken }`. No Supabase
// JWT is involved (verify_jwt = false) — the shipped `ticket-checkout-status`
// posture, where the plaintext token is hash-matched against the stored
// `buyer_status_token_hash`. The guest NEVER reads the order family directly;
// its RLS carries no anon policy at all.
//
// It never returns a token, an email, a phone, a payment intent id, a charge id,
// or another order's anything. 403 on a token mismatch; 404 on an unknown id —
// the ticket-status distinction, preserved, because collapsing them would make
// this endpoint an order-id oracle.
// ===========================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { wrapEdgeHandler } from "../_shared/structuredLog.ts";
import {
  jsonResponse,
  serviceClient,
  sha256Hex,
  ticketCorsHeaders,
} from "../_shared/ticketCheckout.ts";
import { venueOrderErrorCopy } from "../_shared/venueOrderPricing.ts";
import {
  confirmVenueOrderPaystackOnReturn,
  venueOrderReturnCheckPlan,
  isVenueOrderPaystackReference,
  type VenueOrderReturnCheck,
} from "../_shared/venueOrderWebhook.ts";
import { paystackVerifyTransaction } from "../_shared/paystack.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import { resolvePublishableKey } from "../_shared/stripeMode.ts";
import {
  resolveVenueOrderPaymentContinuation,
  stripeVenueOrderContinuationDependencies,
  type VenueOrderContinuationRow,
} from "../_shared/venueOrderPaymentContinuation.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Length-independent, byte-wise comparison. A naive `===` on hex digests leaks
 * a prefix-match timing signal; there is no reason to hand one out.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

serve(wrapEdgeHandler("venue-order-status", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({
      error: "invalid_json",
      message: venueOrderErrorCopy("invalid_json", "guest"),
    }, 400);
  }

  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  const token = typeof body.buyerStatusToken === "string"
    ? body.buyerStatusToken
    : "";
  const includePaymentContinuation = body.includePaymentContinuation === true;
  if (!UUID_RE.test(orderId) || token.length === 0) {
    return jsonResponse({ error: "not_authorized" }, 403);
  }

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("venue_orders")
    .select(
      "id, buyer_status_token_hash, payment_status, fulfillment_status, created_at, " +
        "acknowledged_at, ready_at, delivered_at, cancelled_at, refund_requested_at, " +
        "refund_decision, escalation_level, pickup_code, spot_label_at_order, " +
        "currency, subtotal_cents, service_charge_cents, buyer_subtotal_cents, " +
        "tax_amount_cents, tip_cents, total_cents, refunded_amount_cents, money_path, " +
        "brand_id, venue_id, buyer_name, provider, expires_at, stripe_payment_intent_id, " +
        "stripe_checkout_session_id, stripe_account_id, paystack_reference, metadata",
    )
    .eq("id", orderId)
    .maybeSingle();
  // The concatenated select string defeats supabase-js's compile-time column
  // inference; the runtime shape is exactly the list above.
  const order = data as Record<string, unknown> | null;
  if (error) {
    console.error("[venue-order-status] lookup failed", error.message);
    return jsonResponse({
      error: "internal_error",
      message: venueOrderErrorCopy("internal_error", "guest"),
    }, 500);
  }
  if (!order) return jsonResponse({ error: "not_found" }, 404);

  const presented = await sha256Hex(token);
  const stored = typeof order.buyer_status_token_hash === "string"
    ? order.buyer_status_token_hash
    : "";
  if (stored.length === 0 || !constantTimeEquals(presented, stored)) {
    return jsonResponse({ error: "not_authorized" }, 403);
  }

  // N140 (#4490): an unpaid Paystack order is checked with Paystack on every
  // read while it is pending (the guest's return and the page's poll) and
  // finalized through the webhook's own path when the charge succeeded.
  let paymentCheck: VenueOrderReturnCheck | null = null;
  if (
    order.payment_status === "pending" &&
    order.provider === "paystack" &&
    isVenueOrderPaystackReference(order.paystack_reference)
  ) {
    // N143: one Paystack call per reference per 30 s at most, and none after
    // a terminal "not_paid" (declined / abandoned) until a new payment starts
    // (a new reference). The last answer rides in the order's metadata.
    const reference = String(order.paystack_reference);
    const meta = (order.metadata !== null && typeof order.metadata === "object"
      ? order.metadata
      : {}) as Record<string, unknown>;
    // N144: a guest reopening the payment ("Try again") starts the check over:
    // the reopened checkout reuses this reference, so the remembered
    // "not_paid" is forgotten and nothing is asked of Paystack until they return.
    const plan = venueOrderReturnCheckPlan(
      meta.paystack_return_check,
      reference,
      Date.now(),
      includePaymentContinuation,
    );
    if (plan.forget) {
      const { paystack_return_check: _forgotten, ...rest } = meta;
      await supabase.from("venue_orders").update({ metadata: rest })
        .eq("id", order.id).eq("payment_status", "pending");
    }
    if (!plan.verify) {
      paymentCheck = plan.answer;
    } else {
      try {
        paymentCheck = await confirmVenueOrderPaystackOnReturn(
          supabase,
          reference,
          paystackVerifyTransaction,
        );
      } catch (err) {
        console.error("[venue-order-status] paystack verify on return failed", String(err));
        paymentCheck = "in_progress";
      }
      if (paymentCheck !== "confirmed") {
        await supabase.from("venue_orders").update({
          metadata: { ...meta, paystack_return_check: { reference, result: paymentCheck, at: new Date().toISOString() } },
        }).eq("id", order.id).eq("payment_status", "pending");
      }
    }
    if (paymentCheck === "confirmed") {
      const { data: fresh } = await supabase.from("venue_orders")
        .select("payment_status").eq("id", order.id).maybeSingle();
      if (fresh && typeof fresh.payment_status === "string") {
        order.payment_status = fresh.payment_status;
      }
    }
  }

  const [{ data: brand }, { data: venue }] = await Promise.all([
    supabase.from("brands").select("slug").eq("id", order.brand_id)
      .maybeSingle(),
    supabase.from("venues").select("slug").eq("id", order.venue_id)
      .maybeSingle(),
  ]);

  // D-7a — the guest ALWAYS has a way out, and the status card is where they
  // learn it. Cancel is legal only while nobody has picked the order up;
  // afterwards it becomes a REQUEST the venue decides, and no money moves on a
  // timer (I-PROPOSED-1767-NO-MONEY-ON-A-TIMER).
  const canCancel = order.fulfillment_status === "placed" &&
    order.acknowledged_at === null &&
    order.payment_status !== "refunded" &&
    order.payment_status !== "cancelled";
  const canRequestRefund = ["acknowledged", "in_progress", "ready"].includes(
    String(order.fulfillment_status),
  ) && order.refund_requested_at === null && order.money_path === "mingla";

  // #4490 spec 08 O5 (T16): a line that sold out after the guest paid, and
  // what the venue did about it (swapped, refunded, or still deciding). Read
  // only for a flagged order (the flag exists only once migration
  // 20281203724490 is in, so an older database never sees this read).
  const orderMeta = (order.metadata !== null && typeof order.metadata === "object"
    ? order.metadata
    : {}) as Record<string, unknown>;
  let soldOut: Array<Record<string, unknown>> = [];
  if (orderMeta.sold_out_after_payment === true) {
    const { data: lines, error: linesError } = await supabase
      .from("venue_order_items")
      .select("id, item_name_at_order, quantity, sold_out_resolution, sold_out_refund_minor, swapped_to_item_id, line_no")
      .eq("venue_order_id", order.id)
      .not("sold_out_at", "is", null)
      .order("line_no", { ascending: true });
    if (linesError) {
      console.error("[venue-order-status] sold-out lines read failed", linesError.code ?? "unknown");
    } else {
      const swapIds = (lines ?? []).map((l: Record<string, unknown>) => l.swapped_to_item_id)
        .filter((id: unknown): id is string => typeof id === "string");
      const names = new Map<string, string>();
      if (swapIds.length > 0) {
        const { data: swaps } = await supabase.from("venue_order_items")
          .select("id, item_name_at_order").in("id", swapIds);
        for (const row of (swaps ?? []) as Array<Record<string, unknown>>) {
          names.set(String(row.id), String(row.item_name_at_order));
        }
      }
      soldOut = ((lines ?? []) as Array<Record<string, unknown>>).map((l) => ({
        itemName: String(l.item_name_at_order),
        quantity: Number(l.quantity),
        soldOutAfterPayment: true,
        resolution: l.sold_out_resolution === "swap" || l.sold_out_resolution === "refund"
          ? l.sold_out_resolution
          : null,
        swappedToName: typeof l.swapped_to_item_id === "string"
          ? names.get(l.swapped_to_item_id) ?? null
          : null,
        refundedMinor: typeof l.sold_out_refund_minor === "number" ? l.sold_out_refund_minor : null,
      }));
    }
  }

  const paymentContinuation = includePaymentContinuation
    ? await resolveVenueOrderPaymentContinuation(
      order as unknown as VenueOrderContinuationRow,
      "web",
      stripeVenueOrderContinuationDependencies(
        stripeTicketCheckout,
        resolvePublishableKey,
      ),
    )
    : undefined;

  return jsonResponse({
    orderId: String(order.id),
    buyerName: typeof order.buyer_name === "string" ? order.buyer_name : "",
    brandSlug: typeof brand?.slug === "string" ? brand.slug : null,
    venueSlug: typeof venue?.slug === "string" ? venue.slug : null,
    paymentStatus: String(order.payment_status),
    // N140: null when no provider check applies (paid, Stripe, free).
    paymentCheck,
    fulfillmentStatus: String(order.fulfillment_status),
    placedAt: order.created_at,
    acknowledgedAt: order.acknowledged_at,
    readyAt: order.ready_at,
    deliveredAt: order.delivered_at,
    cancelledAt: order.cancelled_at,
    refundRequestedAt: order.refund_requested_at,
    refundDecision: order.refund_decision,
    escalationLevel: Number(order.escalation_level ?? 0),
    pickupCode: order.pickup_code,
    spotLabel: order.spot_label_at_order,
    canCancel,
    canRequestRefund,
    soldOut,
    ...(includePaymentContinuation ? { paymentContinuation } : {}),
    // Every charge the guest paid, itemised — the venue's service charge stays
    // its own line and the tip stays outside every fee
    // (I-PROPOSED-1767-EVERY-CHARGE-IS-VISIBLE).
    totals: {
      currency: String(order.currency),
      subtotalCents: Number(order.subtotal_cents),
      serviceChargeCents: Number(order.service_charge_cents),
      buyerSubtotalCents: Number(order.buyer_subtotal_cents),
      taxAmountCents: Number(order.tax_amount_cents),
      // Issue #1793 — the ONE combined "Fees & tax" line, computed HERE from
      // the row rather than by the receipt that renders it. The status card
      // shows the same four lines as the cart did, and neither of them adds a
      // single number up (P-20). Identity, from the persisted row:
      //   subtotal + serviceCharge + feesAndTax + tip === total
      feesAndTaxCents: Number(order.buyer_subtotal_cents) -
        Number(order.subtotal_cents) - Number(order.service_charge_cents) +
        Number(order.tax_amount_cents),
      tipCents: Number(order.tip_cents),
      totalCents: Number(order.total_cents),
      refundedAmountCents: Number(order.refunded_amount_cents),
    },
  });
}, {
  onError: (_err, requestId) =>
    jsonResponse({
      error: "internal_error",
      message: venueOrderErrorCopy("internal_error", "guest"),
      requestId,
    }, 500),
}));
