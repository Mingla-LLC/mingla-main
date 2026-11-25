// #4490 spec 08 O2 — door-tap-intent, scope "till": Tap to Pay on a Till
// payment. The event door flow (index.ts) is untouched; this module only runs
// for `{ scope: "till" }` bodies and for till rows in the unfinished sweep.
//
// Money rules:
// - The amount is the carrier's total_cents (venue-till priced it from what is
//   left on the check); nothing in the body is a money figure.
// - Direct charge on the brand's connected account, card_present, automatic
//   capture, application_fee_amount = the carrier's Mingla fee + platform fee.
//     https://docs.stripe.com/terminal/payments/collect-card-payment
// - T19: complete, record, the webhook and the sweep never need a PIN or a
//   live seller session: money that moved is always recorded.

import { jsonResponse } from "../_shared/ticketCheckout.ts";
import { tapToPayReleased } from "../_shared/doorPayServer.ts";
import {
  tillEnabledAtVenue,
  tillLocation,
  tillNotEnabledResponse,
} from "../_shared/venueTillTerminal.ts";
import { isUuid } from "../_shared/doorPay.ts";
import { isMissingTillPaymentColumn } from "../_shared/tillMigrationCompat.ts";
import { resolveTillActor } from "../_shared/venueTillStaffSession.ts";
import type { DoorTapIntentDeps } from "./index.ts";

type Body = Record<string, unknown>;
// deno-lint-ignore no-explicit-any
type Client = any;

const PI_RE = /^pi_[A-Za-z0-9]+$/;

/** The card brand and last four of a succeeded card_present charge (index.ts rule). */
export function tillCardDetails(
  // deno-lint-ignore no-explicit-any
  pi: any,
): { chargeId: string | null; brand: string | null; last4: string | null } {
  const charge = pi?.latest_charge;
  if (charge && typeof charge === "object") {
    const card = charge.payment_method_details?.card_present ?? null;
    return {
      chargeId: typeof charge.id === "string" ? charge.id : null,
      brand: typeof card?.brand === "string" ? card.brand : null,
      last4: typeof card?.last4 === "string" ? card.last4 : null,
    };
  }
  return {
    chargeId: typeof charge === "string" ? charge : null,
    brand: null,
    last4: null,
  };
}

async function canSell(
  supabase: Client,
  venueId: string,
  actorId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("issue_4490_can_sell", {
    p_venue_id: venueId,
    p_user_id: actorId,
  });
  if (error) throw new Error(`till_permission_lookup_failed:${error.message}`);
  return data === true;
}

/** The payment, its check and its carrier, only when the check is at venueId. */
async function loadTillPayment(
  supabase: Client,
  paymentId: string,
  venueId: string | null,
): Promise<
  | {
    payment: Record<string, unknown>;
    sale: Record<string, unknown>;
    carrier: Record<string, unknown>;
  }
  | null
> {
  const { data: payment } = await supabase.from("venue_till_payments")
    .select("id, sale_id, method, state, carrier_order_id, taken_by_user_id")
    .eq("id", paymentId).maybeSingle();
  if (!payment || payment.method !== "tap" || !payment.carrier_order_id) {
    return null;
  }
  const { data: sale } = await supabase.from("venue_till_sales")
    .select("id, venue_id, brand_id, check_label").eq("id", payment.sale_id)
    .maybeSingle();
  if (!sale || (venueId !== null && sale.venue_id !== venueId)) return null;
  const { data: carrier } = await supabase.from("venue_orders")
    .select(
      "id, total_cents, currency, stripe_account_id, mingla_fee_cents, platform_service_fee_cents, provider",
    )
    .eq("id", payment.carrier_order_id).maybeSingle();
  if (!carrier || carrier.provider !== "stripe" || !carrier.stripe_account_id) {
    return null;
  }
  return { payment, sale, carrier };
}

export async function handleTillCreate(
  body: Body,
  signedInId: string,
  deps: DoorTapIntentDeps,
  jwt = "",
): Promise<Response> {
  const { venueId, paymentId, clientRequestId } = body;
  if (!isUuid(venueId) || !isUuid(paymentId) || !isUuid(clientRequestId)) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  const supabase = deps.serviceClient();
  // #4490 O2 fix 1 (O2-T1): no new card read while the Till is switched off.
  if (!(await tillEnabledAtVenue(supabase, venueId))) {
    return tillNotEnabledResponse();
  }
  // #4490 O5: starting a card read on a Till device login needs a live PIN
  // session (staffSession in the body) and runs as that member. complete,
  // cancel, seen and the sweep never ask (T19: money that moved is recorded).
  const who = await resolveTillActor(supabase, {
    venueId,
    userId: signedInId,
    jwt,
    staffSession: body.staffSession,
  });
  if (!who.ok) return jsonResponse({ error: who.code }, who.status);
  const actorId = who.actor.actorUserId;
  if (!(await canSell(supabase, venueId, actorId))) {
    return jsonResponse({ error: "door_access_denied" }, 400);
  }
  const loaded = await loadTillPayment(supabase, paymentId, venueId);
  if (loaded === null) return jsonResponse({ error: "not_found" }, 404);
  const { payment, sale, carrier } = loaded;
  const brandId = String(sale.brand_id);
  if (!(await tapToPayReleased(supabase, brandId, body.platform))) {
    return jsonResponse(
      { error: "tap_not_available", reason: "not_released" },
      400,
    );
  }
  const stripe = deps.stripe();

  // #4490 08-O3 fix 5: a till request id is one card read for ONE payment. The
  // same id sent for another Till payment is refused before anything is
  // written or sent to Stripe (it used to fall through to the unique index
  // and answer server_error). Event-scope intents (till_payment_id NULL) never
  // match `not.eq`, so they are not looked at.
  const { data: reused } = await supabase.from("door_tap_intents")
    .select("till_payment_id")
    .eq("client_request_id", clientRequestId)
    .not("till_payment_id", "eq", paymentId)
    .maybeSingle();
  if (reused) {
    return jsonResponse({ error: "till_request_reused" }, 409);
  }
  // Replay: same payment, same PaymentIntent (never a second charge).
  const { data: existing } = await supabase.from("door_tap_intents")
    .select(
      "id, client_request_id, stripe_payment_intent_id, stripe_account_id, stripe_location_id, total_cents, currency, fee_cents, subtotal_cents",
    )
    .eq("till_payment_id", paymentId).maybeSingle();
  if (existing && existing.client_request_id !== clientRequestId) {
    return jsonResponse({ error: "not_found" }, 404);
  }
  if (existing?.stripe_payment_intent_id) {
    // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (GET; no mutation to dedupe)
    // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
    const pi = await stripe.paymentIntents.retrieve(
      existing.stripe_payment_intent_id,
      {},
      {
        stripeAccount: existing.stripe_account_id,
      },
    );
    return jsonResponse({
      paymentIntentId: pi.id,
      clientSecret: pi.client_secret,
      totalCents: existing.total_cents,
      subtotalCents: existing.subtotal_cents,
      feeCents: existing.fee_cents,
      currency: existing.currency,
      stripeAccountId: existing.stripe_account_id,
      locationId: existing.stripe_location_id,
    });
  }
  if (payment.state !== "pending") {
    return jsonResponse({ error: "payment_not_pending" }, 409);
  }
  const stripeAccountId = String(carrier.stripe_account_id);
  const location = await tillLocation(
    supabase,
    stripe,
    brandId,
    venueId,
    stripeAccountId,
  );
  if (!location.ok) return location.response;
  const totalCents = Number(carrier.total_cents);
  const applicationFeeCents = Number(carrier.mingla_fee_cents) +
    Number(carrier.platform_service_fee_cents);
  const intentRow = {
    brand_id: brandId,
    event_id: null,
    till_payment_id: paymentId,
    client_request_id: clientRequestId,
    lines: [{ kind: "till_payment", paymentId }],
    currency: String(carrier.currency),
    subtotal_cents: totalCents - applicationFeeCents >= 0
      ? totalCents - applicationFeeCents
      : 0,
    fee_cents: applicationFeeCents,
    total_cents: totalCents,
    application_fee_cents: applicationFeeCents,
    stripe_account_id: stripeAccountId,
    stripe_location_id: location.locationId,
    created_by: actorId,
  };
  const { data: intent, error: intentError } = existing
    ? await supabase.from("door_tap_intents")
      .update({ ...intentRow, updated_at: new Date().toISOString() })
      .eq("id", existing.id).is("stripe_payment_intent_id", null)
      .select("id").single()
    : await supabase.from("door_tap_intents").insert(intentRow).select("id")
      .single();
  if (intentError || !intent) {
    console.error(
      "[door-tap-intent] till intent insert failed",
      intentError?.message,
    );
    return jsonResponse({ error: "server_error" }, 500);
  }
  const piBody: Record<string, unknown> = {
    amount: totalCents,
    currency: String(carrier.currency).toLowerCase(),
    payment_method_types: ["card_present"],
    capture_method: "automatic",
    metadata: {
      mingla_venue_order_id: String(carrier.id),
      mingla_till_payment_id: paymentId,
      mingla_till_tap_intent_id: intent.id,
      mingla_brand_id: brandId,
    },
  };
  if (applicationFeeCents > 0) {
    piBody.application_fee_amount = applicationFeeCents;
  }
  // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
  const pi = await stripe.paymentIntents.create(piBody, {
    stripeAccount: stripeAccountId,
    idempotencyKey: `till_tap:${clientRequestId}`,
  });
  const nowIso = new Date().toISOString();
  const { error: piStoreError } = await supabase.from("door_tap_intents")
    .update({ stripe_payment_intent_id: pi.id, updated_at: nowIso }).eq(
      "id",
      intent.id,
    );
  // The carrier knows its PaymentIntent, so the finalizer matches the webhook.
  const { error: carrierError } = await supabase.from("venue_orders")
    .update({ stripe_payment_intent_id: pi.id }).eq("id", carrier.id)
    .is("stripe_payment_intent_id", null);
  if (piStoreError || carrierError) {
    console.error("[door-tap-intent] till payment intent store failed");
    return jsonResponse({ error: "server_error" }, 500);
  }
  return jsonResponse({
    paymentIntentId: pi.id,
    clientSecret: pi.client_secret,
    totalCents,
    subtotalCents: intentRow.subtotal_cents,
    feeCents: applicationFeeCents,
    currency: String(carrier.currency),
    stripeAccountId,
    locationId: location.locationId,
  });
}

export async function handleTillLocation(
  body: Body,
  actorId: string,
  deps: DoorTapIntentDeps,
): Promise<Response> {
  const venueId = body.venueId;
  if (!isUuid(venueId)) return jsonResponse({ error: "invalid_request" }, 400);
  const supabase = deps.serviceClient();
  // #4490 O2 fix 1 (O2-T1): no Till Location while the Till is switched off.
  if (!(await tillEnabledAtVenue(supabase, venueId))) {
    return tillNotEnabledResponse();
  }
  if (!(await canSell(supabase, venueId, actorId))) {
    return jsonResponse({ error: "door_access_denied" }, 400);
  }
  const { data: venue } = await supabase.from("venue_listings")
    .select("brand_id").eq("id", venueId).maybeSingle();
  if (!venue) return jsonResponse({ error: "not_found" }, 404);
  const brandId = String(venue.brand_id);
  if (!(await tapToPayReleased(supabase, brandId, body.platform))) {
    return jsonResponse(
      { error: "tap_not_available", reason: "not_released" },
      400,
    );
  }
  const { data: brand } = await supabase.from("brands")
    .select("stripe_connect_id, stripe_charges_enabled").eq("id", brandId)
    .maybeSingle();
  if (!brand?.stripe_connect_id || brand.stripe_charges_enabled !== true) {
    return jsonResponse({ error: "stripe_account_not_ready" }, 400);
  }
  const location = await tillLocation(
    supabase,
    deps.stripe(),
    brandId,
    venueId,
    String(brand.stripe_connect_id),
  );
  if (!location.ok) return location.response;
  return jsonResponse({ locationId: location.locationId });
}

async function loadTillIntent(
  supabase: Client,
  body: Body,
): Promise<Record<string, unknown> | null | "invalid"> {
  const paymentIntentId = body.paymentIntentId;
  if (
    typeof paymentIntentId !== "string" || !PI_RE.test(paymentIntentId) ||
    !isUuid(body.clientRequestId)
  ) {
    return "invalid";
  }
  const { data, error } = await supabase.from("door_tap_intents")
    .select(
      "id, till_payment_id, client_request_id, stripe_account_id, status, created_by",
    )
    .eq("stripe_payment_intent_id", paymentIntentId).maybeSingle();
  if (error) throw new Error(`till_intent_lookup_failed:${error.message}`);
  if (
    !data || !data.till_payment_id ||
    data.client_request_id !== body.clientRequestId
  ) return null;
  return data as Record<string, unknown>;
}

async function venueOfPayment(
  supabase: Client,
  paymentId: string,
): Promise<string | null> {
  const { data } = await supabase.from("venue_till_payments")
    .select("venue_till_sales!inner(venue_id)").eq("id", paymentId)
    .maybeSingle();
  const rel = data?.venue_till_sales;
  const sale = Array.isArray(rel) ? rel[0] : rel;
  return typeof sale?.venue_id === "string" ? sale.venue_id : null;
}

export async function handleTillComplete(
  body: Body,
  actorId: string,
  deps: DoorTapIntentDeps,
): Promise<Response> {
  if (body.clientError === "offline_pin_required") {
    return jsonResponse({ error: "offline_pin_required" }, 400);
  }
  const supabase = deps.serviceClient();
  const intent = await loadTillIntent(supabase, body);
  if (intent === "invalid" || intent === null) {
    return jsonResponse({ error: "payment_not_succeeded" }, 400);
  }
  // T19: the seller who started it, or anyone who may sell there (never a PIN).
  const venueId = await venueOfPayment(
    supabase,
    String(intent.till_payment_id),
  );
  if (
    intent.created_by !== actorId &&
    (venueId === null || !(await canSell(supabase, venueId, actorId)))
  ) {
    return jsonResponse({ error: "door_access_denied" }, 400);
  }
  const stripe = deps.stripe();
  // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (GET; no mutation to dedupe)
  // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
  const pi = await stripe.paymentIntents.retrieve(
    String(body.paymentIntentId),
    {
      expand: ["latest_charge"],
    },
    { stripeAccount: intent.stripe_account_id },
  );
  if (
    pi?.status !== "succeeded" ||
    pi?.metadata?.mingla_till_payment_id !== intent.till_payment_id
  ) {
    return jsonResponse({
      error: "payment_not_succeeded",
      status: pi?.status ?? null,
    }, 409);
  }
  const card = tillCardDetails(pi);
  const { data, error } = await supabase.rpc("issue_4490_till_tap_record", {
    p_payment_intent_id: String(body.paymentIntentId),
    p_charge_id: card.chargeId,
    p_amount: Number(pi.amount_received ?? pi.amount ?? 0),
    p_card_brand: card.brand,
    p_last4: card.last4,
  });
  if (error) {
    console.error("[door-tap-intent] till record failed", error.message);
    return jsonResponse({ error: "server_error" }, 500);
  }
  return jsonResponse({
    status: "recorded",
    ...(data as Record<string, unknown>),
  });
}

export async function handleTillCancel(
  body: Body,
  actorId: string,
  deps: DoorTapIntentDeps,
): Promise<Response> {
  const supabase = deps.serviceClient();
  const intent = await loadTillIntent(supabase, body);
  if (intent === "invalid") {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  if (intent === null) return jsonResponse({ error: "not_found" }, 404);
  const venueId = await venueOfPayment(
    supabase,
    String(intent.till_payment_id),
  );
  if (venueId === null || !(await canSell(supabase, venueId, actorId))) {
    return jsonResponse({ error: "door_access_denied" }, 400);
  }
  if (intent.status === "recorded") {
    return jsonResponse({ error: "payment_succeeded" }, 409);
  }
  const stripe = deps.stripe();
  // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (GET; no mutation to dedupe)
  // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
  const pi = await stripe.paymentIntents.retrieve(
    String(body.paymentIntentId),
    {},
    {
      stripeAccount: intent.stripe_account_id,
    },
  );
  if (pi?.status === "succeeded") {
    return jsonResponse({ error: "payment_succeeded" }, 409);
  }
  if (pi?.status !== "canceled") {
    // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
    await stripe.paymentIntents.cancel(String(body.paymentIntentId), {}, {
      stripeAccount: intent.stripe_account_id,
      idempotencyKey: `till_tap_cancel:${body.clientRequestId}`,
    });
  }
  await supabase.from("door_tap_intents")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", intent.id).in("status", ["created", "cancelled"]);
  const { data, error } = await supabase.rpc("issue_4490_till_card_cancel", {
    p_payment_id: intent.till_payment_id,
    p_actor: actorId,
  });
  if (error) {
    // A payment that landed meanwhile is recorded by complete or the webhook.
    if (/till_payment_already_paid/.test(error.message)) {
      return jsonResponse({ error: "payment_succeeded" }, 409);
    }
    console.error("[door-tap-intent] till cancel failed", error.message);
    return jsonResponse({ error: "server_error" }, 500);
  }
  return jsonResponse({
    status: "cancelled",
    sale: (data as Record<string, unknown>)?.sale ?? null,
  });
}

export async function handleTillSeen(
  body: Body,
  actorId: string,
  deps: DoorTapIntentDeps,
): Promise<Response> {
  const supabase = deps.serviceClient();
  const intent = await loadTillIntent(supabase, body);
  if (intent === "invalid") {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  if (intent === null) return jsonResponse({ error: "not_found" }, 404);
  const venueId = await venueOfPayment(
    supabase,
    String(intent.till_payment_id),
  );
  if (
    intent.created_by !== actorId &&
    (venueId === null || !(await canSell(supabase, venueId, actorId)))
  ) {
    return jsonResponse({ error: "door_access_denied" }, 400);
  }
  const nowIso = new Date().toISOString();
  const { error } = await supabase.from("door_tap_intents")
    .update({ outcome_seen_at: nowIso, updated_at: nowIso })
    .eq("id", intent.id).is("outcome_seen_at", null);
  if (error) return jsonResponse({ error: "server_error" }, 500);
  return jsonResponse({ status: "seen" });
}

export const TILL_UNFINISHED_AFTER_MS = 15 * 60 * 1000;
const TILL_UNFINISHED_WITHIN_MS = 24 * 60 * 60 * 1000;

/**
 * Till taps nobody saw end: money that landed is recorded (and the seller
 * told once, so they don't take it again); anything else is cancelled at
 * Stripe first, then the payment is cancelled and the seller told no money
 * was taken. A step that can't be confirmed waits for the next run.
 */
export async function sweepTillUnfinished(
  supabase: Client,
  // deno-lint-ignore no-explicit-any
  stripe: any,
  notify: NonNullable<DoorTapIntentDeps["notify"]>,
  now: number,
): Promise<
  { recorded: number; notified: number; skipped: number; failed: number }
> {
  const tally = { recorded: 0, notified: 0, skipped: 0, failed: 0 };
  const { data: rows, error } = await supabase.from("door_tap_intents")
    .select(
      "id, brand_id, till_payment_id, stripe_payment_intent_id, stripe_account_id, created_by, status",
    )
    .not("till_payment_id", "is", null)
    .in("status", ["created", "recorded"])
    .lt("created_at", new Date(now - TILL_UNFINISHED_AFTER_MS).toISOString())
    .gt("created_at", new Date(now - TILL_UNFINISHED_WITHIN_MS).toISOString())
    .is("outcome_seen_at", null)
    .is("unfinished_notified_at", null)
    .not("stripe_payment_intent_id", "is", null)
    .limit(100);
  if (error) {
    // [TRANSITIONAL] #4490 O2 fix 1 (O2-T5 class): until the #4490 migrations
    // are applied in production, door_tap_intents has no till_payment_id
    // (42703). The event sweep runs this on every call, so that one answer is
    // "no Till rows" (not a failure); any other error still counts and logs.
    // Exit: migration 20281203564490 applied in production (see
    // _shared/tillMigrationCompat.ts), then delete this branch.
    if (isMissingTillPaymentColumn(error)) return tally;
    console.error("[door-tap-intent] till sweep read failed", error.message);
    tally.failed += 1;
    return tally;
  }
  for (const row of (rows ?? []) as Array<Record<string, unknown>>) {
    // Defensive: only Till rows (an event row is never touched here).
    if (typeof row.till_payment_id !== "string") continue;
    const paymentIntentId = String(row.stripe_payment_intent_id);
    const stripeAccount = String(row.stripe_account_id);
    try {
      const venueId = await venueOfPayment(
        supabase,
        String(row.till_payment_id),
      );
      let paid = row.status === "recorded";
      if (!paid) {
        // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (GET; no mutation to dedupe)
        // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
          expand: ["latest_charge"],
        }, {
          stripeAccount,
        });
        if (pi?.status === "succeeded") {
          const card = tillCardDetails(pi);
          const { error: recordError } = await supabase.rpc(
            "issue_4490_till_tap_record",
            {
              p_payment_intent_id: paymentIntentId,
              p_charge_id: card.chargeId,
              p_amount: Number(pi.amount_received ?? pi.amount ?? 0),
              p_card_brand: card.brand,
              p_last4: card.last4,
            },
          );
          if (recordError) throw new Error(recordError.message);
          tally.recorded += 1;
          paid = true;
        } else if (pi?.status === "processing") {
          tally.skipped += 1;
          continue;
        } else {
          if (pi?.status !== "canceled") {
            // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
            await stripe.paymentIntents.cancel(paymentIntentId, {}, {
              stripeAccount,
              idempotencyKey: `till_tap_sweep_cancel:${row.id}`,
            });
          }
          const { error: closeError } = await supabase.rpc(
            "issue_4490_till_card_close",
            {
              p_payment_id: row.till_payment_id,
            },
          );
          if (closeError) throw new Error(closeError.message);
        }
      }
      const nowIso = new Date().toISOString();
      const { data: claimed, error: claimError } = await supabase.from(
        "door_tap_intents",
      )
        .update({
          ...(paid ? {} : { status: "cancelled" }),
          unfinished_notified_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", row.id).is("outcome_seen_at", null).is(
          "unfinished_notified_at",
          null,
        )
        .select("id");
      if (claimError) throw new Error(claimError.message);
      if (Array.isArray(claimed) && claimed.length === 0) continue;
      await notify({
        userId: String(row.created_by),
        brandId: String(row.brand_id),
        type: paid
          ? "business.venue_till_tap_paid_unseen"
          : "business.venue_till_tap_not_completed",
        title: paid
          ? "Till card payment went through"
          : "Till payment not finished",
        body: paid
          ? "A Tap to Pay payment on the Till went through. It's on the check. Don't take this payment again."
          : "A Tap to Pay payment on the Till wasn't approved. No money was taken. Open the Till to take it again.",
        data: { venueId, paymentId: row.till_payment_id },
        relatedId: String(row.id),
        relatedType: "door_tap_intent",
        idempotencyKey: `${
          paid ? "till_tap_paid_unseen" : "till_tap_not_completed"
        }:${row.id}`,
        deepLink: venueId
          ? `mingla-business://venue/${venueId}/till`
          : "mingla-business://home",
      });
      tally.notified += 1;
    } catch (rowError) {
      tally.failed += 1;
      console.error(
        "[door-tap-intent] till sweep row failed",
        row.id,
        rowError instanceof Error ? rowError.message : "unknown",
      );
    }
  }
  return tally;
}
