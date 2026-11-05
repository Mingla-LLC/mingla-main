// Issue #4271 — door-tap-intent. Tap to Pay at the door.
//
// create:   the server prices the sale (same engine as online checkout) and
//           creates a card_present PaymentIntent as a direct charge on the
//           brand's connected account, with Mingla's flat fee as
//           application_fee_amount. Idempotent on clientRequestId.
//             https://docs.stripe.com/terminal/payments/collect-card-payment
//             (payment_method_types must include card_present; capture_method
//             automatic authorizes and captures in one step)
// complete: the server retrieves the PaymentIntent from Stripe and records the
//           sale only when Stripe says it succeeded (biz_door_tap_record).
//           stripe-webhook payment_intent.succeeded with metadata
//           mingla_door_tap backstops a lost `complete`.
//
// verify_jwt = false at the gateway; the bearer is verified in code and the
// caller must be allowed to take door money for the event.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { wrapEdgeHandler } from "../_shared/structuredLog.ts";
import {
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import { resolveBuyerPhone } from "../_shared/buyerPhone.ts";
import {
  canTakeBrandDoorPayment,
  canTakeDoorPayment,
  loadDoorPricing,
  quoteDoorSale,
  tapToPayReleased,
} from "../_shared/doorPayServer.ts";
import {
  ensureBrandTerminalLocation,
  ensureTerminalLocation,
  loadBrandTapContext,
  loadTapContext,
  terminalAddressFor,
} from "../_shared/doorTerminal.ts";
import { doorErrorFromDb, isUuid } from "../_shared/doorPay.ts";
import { dispatchNotification } from "../_shared/stripeEdgeAuth.ts";

export interface DoorTapIntentDeps {
  // deno-lint-ignore no-explicit-any
  serviceClient: () => any;
  userIdFromAuthHeader: (req: Request) => Promise<string | null>;
  // deno-lint-ignore no-explicit-any
  stripe: () => any;
  /** Test seam: the sweep's bearer. */
  serviceRoleKey?: () => string | undefined;
  /** Test seam: the host's push. */
  notify?: typeof dispatchNotification;
}

const defaultDeps: DoorTapIntentDeps = {
  serviceClient,
  userIdFromAuthHeader,
  stripe: stripeTicketCheckout,
};

type Body = Record<string, unknown>;

async function handleCreate(
  body: Body,
  actorId: string,
  deps: DoorTapIntentDeps,
): Promise<Response> {
  const eventId = body.eventId;
  const eventDateId = body.eventDateId ?? null;
  const clientRequestId = body.clientRequestId;
  if (
    !isUuid(eventId) || !isUuid(clientRequestId) ||
    (eventDateId !== null && !isUuid(eventDateId))
  ) {
    return jsonResponse({ error: "invalid_lines" }, 400);
  }
  let buyerPhone: string | null = null;
  if (typeof body.buyerPhone === "string" && body.buyerPhone.trim() !== "") {
    const phone = resolveBuyerPhone(body.buyerPhone, body.phoneCountryIso);
    if (phone.e164 === null || phone.legacyNanpGuess) {
      return jsonResponse({ error: "buyer_phone_invalid", message: phone.message }, 400);
    }
    buyerPhone = phone.e164;
  }
  const supabase = deps.serviceClient();
  if (!(await canTakeDoorPayment(supabase, eventId, actorId))) {
    return jsonResponse({ error: "door_access_denied" }, 400);
  }
  const tap = await loadTapContext(supabase, eventId);
  if (!tap.ok) return jsonResponse({ error: tap.error }, 400);
  if (!(await tapToPayReleased(supabase, tap.brandId, body.platform))) {
    return jsonResponse({ error: "tap_not_available", reason: "not_released" }, 400);
  }
  const stripe = deps.stripe();

  // Replay: same clientRequestId, same PaymentIntent (never a second charge).
  const { data: existing } = await supabase
    .from("door_tap_intents")
    .select(
      "id, stripe_payment_intent_id, stripe_account_id, stripe_location_id, total_cents, currency, fee_cents, subtotal_cents",
    )
    .eq("event_id", eventId)
    .eq("client_request_id", clientRequestId)
    .maybeSingle();
  if (existing?.stripe_payment_intent_id) {
    // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (GET; no mutation to dedupe)
    // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
    const pi = await stripe.paymentIntents.retrieve(
      existing.stripe_payment_intent_id,
      {},
      { stripeAccount: existing.stripe_account_id },
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

  const quote = await quoteDoorSale(supabase, {
    eventId,
    eventDateId: eventDateId as string | null,
    lines: body.lines,
  });
  if (!quote.ok) return jsonResponse({ error: quote.error }, quote.status);
  if (quote.provider !== "stripe" || quote.stripeAccountId === null) {
    return jsonResponse({ error: "tap_not_available" }, 400);
  }
  const pricing = await loadDoorPricing(supabase, eventId);
  const address = terminalAddressFor({
    venueTaxAddress: pricing?.venueTaxAddress ?? null,
    brandAddress: tap.brandAddress,
    brandCity: tap.brandCity,
    country: tap.country,
  });
  if (address === null) {
    return jsonResponse({ error: "tap_not_available", reason: "address_missing" }, 400);
  }
  const locationId = await ensureTerminalLocation(supabase, stripe, {
    brandId: tap.brandId,
    brandName: tap.brandName,
    stripeAccountId: quote.stripeAccountId,
    country: tap.country,
    address,
  });

  const intentRow = {
    brand_id: quote.brandId,
    event_id: eventId,
    event_date_id: eventDateId,
    client_request_id: clientRequestId,
    lines: quote.lines,
    currency: quote.money.currency,
    subtotal_cents: quote.money.subtotalCents,
    fee_cents: quote.money.feeCents,
    total_cents: quote.money.totalCents,
    application_fee_cents: quote.money.applicationFeeCents,
    stripe_account_id: quote.stripeAccountId,
    stripe_location_id: locationId,
    buyer_phone_e164: buyerPhone,
    created_by: actorId,
  };
  // An earlier attempt stored the intent but never reached Stripe: re-price it.
  const { data: intent, error: intentError } = existing
    ? await supabase.from("door_tap_intents")
      .update({ ...intentRow, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .is("stripe_payment_intent_id", null)
      .select("id")
      .single()
    : await supabase.from("door_tap_intents")
      .insert(intentRow)
      .select("id")
      .single();
  if (intentError || !intent) {
    console.error("[door-tap-intent] intent insert failed", intentError?.message);
    return jsonResponse({ error: "server_error" }, 500);
  }

  const piBody: Record<string, unknown> = {
    amount: quote.money.totalCents,
    currency: quote.money.currency.toLowerCase(),
    payment_method_types: ["card_present"],
    capture_method: "automatic",
    metadata: {
      mingla_door_tap: "1",
      mingla_door_tap_intent_id: intent.id,
      mingla_event_id: eventId,
      mingla_brand_id: quote.brandId,
    },
  };
  // #3645 flat 4.5%: application fee = take rate + platform service fee.
  if (quote.money.applicationFeeCents > 0) {
    piBody.application_fee_amount = quote.money.applicationFeeCents;
  }
  // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
  const pi = await stripe.paymentIntents.create(piBody, {
    stripeAccount: quote.stripeAccountId,
    idempotencyKey: `door_tap:${clientRequestId}`,
  });
  const { error: piStoreError } = await supabase
    .from("door_tap_intents")
    .update({ stripe_payment_intent_id: pi.id, updated_at: new Date().toISOString() })
    .eq("id", intent.id);
  if (piStoreError) {
    console.error("[door-tap-intent] payment intent store failed", piStoreError.message);
    return jsonResponse({ error: "server_error" }, 500);
  }
  return jsonResponse({
    paymentIntentId: pi.id,
    clientSecret: pi.client_secret,
    totalCents: quote.money.totalCents,
    subtotalCents: quote.money.subtotalCents,
    feeCents: quote.money.feeCents,
    currency: quote.money.currency,
    stripeAccountId: quote.stripeAccountId,
    locationId,
  });
}

/**
 * Setup step: connect the phone's reader before the first sale. Creates or
 * reuses the brand's Terminal Location for its country. With no event in view
 * (the root host) `brandId` stands in, using the brand's own address only.
 */
async function handleLocation(
  body: Body,
  actorId: string,
  deps: DoorTapIntentDeps,
): Promise<Response> {
  const eventId = body.eventId;
  const supabase = deps.serviceClient();
  if (!isUuid(eventId) && isUuid(body.brandId)) {
    const brandId = body.brandId as string;
    if (!(await canTakeBrandDoorPayment(supabase, brandId, actorId))) {
      return jsonResponse({ error: "door_access_denied" }, 400);
    }
    const tap = await loadBrandTapContext(supabase, brandId);
    if (!tap.ok) return jsonResponse({ error: tap.error }, 400);
    if (!(await tapToPayReleased(supabase, tap.brandId, body.platform))) {
      return jsonResponse({ error: "tap_not_available", reason: "not_released" }, 400);
    }
    const brandLocationId = await ensureBrandTerminalLocation(supabase, deps.stripe(), tap);
    if (brandLocationId === null) {
      return jsonResponse({ error: "tap_not_available", reason: "address_missing" }, 400);
    }
    return jsonResponse({ locationId: brandLocationId });
  }
  if (!isUuid(eventId)) return jsonResponse({ error: "invalid_request" }, 400);
  if (!(await canTakeDoorPayment(supabase, eventId, actorId))) {
    return jsonResponse({ error: "door_access_denied" }, 400);
  }
  const tap = await loadTapContext(supabase, eventId);
  if (!tap.ok) return jsonResponse({ error: tap.error }, 400);
  if (!(await tapToPayReleased(supabase, tap.brandId, body.platform))) {
    return jsonResponse({ error: "tap_not_available", reason: "not_released" }, 400);
  }
  const pricing = await loadDoorPricing(supabase, eventId);
  if (pricing === null || pricing.stripeAccountId === null) {
    return jsonResponse({ error: "stripe_account_not_ready" }, 400);
  }
  const address = terminalAddressFor({
    venueTaxAddress: pricing.venueTaxAddress,
    brandAddress: tap.brandAddress,
    brandCity: tap.brandCity,
    country: tap.country,
  });
  if (address === null) {
    return jsonResponse({ error: "tap_not_available", reason: "address_missing" }, 400);
  }
  const locationId = await ensureTerminalLocation(supabase, deps.stripe(), {
    brandId: tap.brandId,
    brandName: tap.brandName,
    stripeAccountId: pricing.stripeAccountId,
    country: tap.country,
    address,
  });
  return jsonResponse({ locationId });
}

/**
 * The host switched to a pay code instead: cancel the unpaid PaymentIntent on
 * the connected account. Idempotent; a succeeded payment is never cancelled.
 *   https://docs.stripe.com/api/payment_intents/cancel
 */
async function handleCancel(
  body: Body,
  actorId: string,
  deps: DoorTapIntentDeps,
): Promise<Response> {
  const paymentIntentId = body.paymentIntentId;
  if (
    typeof paymentIntentId !== "string" || !/^pi_[A-Za-z0-9]+$/.test(paymentIntentId) ||
    !isUuid(body.clientRequestId)
  ) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  const supabase = deps.serviceClient();
  const { data: intent, error } = await supabase
    .from("door_tap_intents")
    .select("id, event_id, client_request_id, stripe_account_id, status, order_id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (error) return jsonResponse({ error: "server_error" }, 500);
  if (!intent || intent.client_request_id !== body.clientRequestId) {
    return jsonResponse({ error: "not_found" }, 404);
  }
  if (!(await canTakeDoorPayment(supabase, intent.event_id, actorId))) {
    return jsonResponse({ error: "door_access_denied" }, 400);
  }
  if (intent.order_id || intent.status === "recorded") {
    return jsonResponse({ error: "payment_succeeded" }, 409);
  }
  const stripe = deps.stripe();
  // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (GET; no mutation to dedupe)
  // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
  const pi = await stripe.paymentIntents.retrieve(
    paymentIntentId,
    {},
    { stripeAccount: intent.stripe_account_id },
  );
  if (pi?.status === "succeeded") {
    return jsonResponse({ error: "payment_succeeded" }, 409);
  }
  if (pi?.status !== "canceled") {
    // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
    await stripe.paymentIntents.cancel(paymentIntentId, {}, {
      stripeAccount: intent.stripe_account_id,
      idempotencyKey: `door_tap_cancel:${body.clientRequestId}`,
    });
  }
  await supabase.from("door_tap_intents")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", intent.id)
    .is("order_id", null);
  return jsonResponse({ status: "cancelled" });
}

/** The host saw how this tap ended. Same auth as cancel. */
async function handleSeen(
  body: Body,
  actorId: string,
  deps: DoorTapIntentDeps,
): Promise<Response> {
  const paymentIntentId = body.paymentIntentId;
  if (
    typeof paymentIntentId !== "string" || !/^pi_[A-Za-z0-9]+$/.test(paymentIntentId) ||
    !isUuid(body.clientRequestId)
  ) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  const supabase = deps.serviceClient();
  const { data: intent, error } = await supabase
    .from("door_tap_intents")
    .select("id, event_id, client_request_id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (error) return jsonResponse({ error: "server_error" }, 500);
  if (!intent || intent.client_request_id !== body.clientRequestId) {
    return jsonResponse({ error: "not_found" }, 404);
  }
  if (!(await canTakeDoorPayment(supabase, intent.event_id, actorId))) {
    return jsonResponse({ error: "door_access_denied" }, 400);
  }
  const { error: updateError } = await supabase.from("door_tap_intents")
    .update({ outcome_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", intent.id)
    .is("outcome_seen_at", null);
  if (updateError) return jsonResponse({ error: "server_error" }, 500);
  return jsonResponse({ status: "seen" });
}

// The host app stops waiting for a tap after 10 minutes on the ready screen
// (TAP_READY_LIMIT_MS in mingla-business tapToPayFlow.ts) and shows the host
// that the sale was cancelled. Sweeping only after 15 minutes means a screen
// that is still waiting for a tap is never cancelled or pushed about.
export const UNFINISHED_AFTER_MS = 15 * 60 * 1000;
const UNFINISHED_WITHIN_MS = 24 * 60 * 60 * 1000;

/**
 * Apple 5.12: a sale that ended while the app was closed. Every 5 minutes, for
 * tap intents nobody saw an outcome for: money that landed is recorded (no push);
 * anything else is cancelled at Stripe first, and only then is the host told no
 * money was taken. A step that can't be confirmed leaves the row for the next run.
 */
async function handleSweepUnfinished(
  req: Request,
  deps: DoorTapIntentDeps,
): Promise<Response> {
  const expected = (deps.serviceRoleKey ?? (() => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")))();
  if (!expected || req.headers.get("authorization") !== `Bearer ${expected}`) {
    return jsonResponse({ error: "not_authorized" }, 401);
  }
  const supabase = deps.serviceClient();
  const stripe = deps.stripe();
  const notify = deps.notify ?? dispatchNotification;
  const now = Date.now();
  const { data: rows, error } = await supabase
    .from("door_tap_intents")
    .select(
      "id, brand_id, event_id, stripe_payment_intent_id, stripe_account_id, created_by, events(title)",
    )
    .eq("status", "created")
    .lt("created_at", new Date(now - UNFINISHED_AFTER_MS).toISOString())
    .gt("created_at", new Date(now - UNFINISHED_WITHIN_MS).toISOString())
    .is("outcome_seen_at", null)
    .is("unfinished_notified_at", null)
    .not("stripe_payment_intent_id", "is", null)
    .limit(100);
  if (error) {
    console.error("[door-tap-intent] sweep read failed", error.message);
    return jsonResponse({ error: "server_error" }, 500);
  }
  const tally = { recorded: 0, notified: 0, skipped: 0, failed: 0 };
  for (const row of (rows ?? []) as Array<Record<string, unknown>>) {
    const paymentIntentId = row.stripe_payment_intent_id as string;
    const stripeAccount = row.stripe_account_id as string;
    try {
      // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (GET; no mutation to dedupe)
      // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
      const pi = await stripe.paymentIntents.retrieve(
        paymentIntentId,
        { expand: ["latest_charge"] },
        { stripeAccount },
      );
      if (pi?.status === "succeeded") {
        const card = cardPresentDetails(pi);
        const { error: recordError } = await supabase.rpc("biz_door_tap_record", {
          p_payment_intent_id: paymentIntentId,
          p_charge_id: card.chargeId,
          p_amount_received_cents: Number(pi.amount_received ?? pi.amount ?? 0),
          p_card_brand: card.brand,
          p_card_last4: card.last4,
        });
        if (recordError) throw new Error(recordError.message);
        tally.recorded += 1;
        continue;
      }
      // Being processed right now: only Stripe's answer can say no money moved.
      if (pi?.status === "processing") {
        tally.skipped += 1;
        continue;
      }
      if (pi?.status !== "canceled") {
        // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
        await stripe.paymentIntents.cancel(paymentIntentId, {}, {
          stripeAccount,
          idempotencyKey: `door_tap_sweep_cancel:${row.id}`,
        });
      }
      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabase.from("door_tap_intents")
        .update({ status: "cancelled", unfinished_notified_at: nowIso, updated_at: nowIso })
        .eq("id", row.id)
        .is("unfinished_notified_at", null);
      if (updateError) throw new Error(updateError.message);
      const rel = row.events as { title?: string } | Array<{ title?: string }> | null;
      const eventTitle = (Array.isArray(rel) ? rel[0]?.title : rel?.title) ?? "your event";
      const message =
        `A Tap to Pay sale for ${eventTitle} wasn't approved. No money was taken. Open door sales to take it again.`;
      await notify({
        userId: row.created_by as string,
        brandId: row.brand_id as string,
        type: "business.door_tap_not_completed",
        title: "Door payment not finished",
        body: message,
        data: { eventId: row.event_id, eventTitle },
        relatedId: row.id as string,
        relatedType: "door_tap_intent",
        idempotencyKey: `door_tap_not_completed:${row.id}`,
        deepLink: `mingla-business://event/${row.event_id}/door`,
      });
      tally.notified += 1;
    } catch (rowError) {
      tally.failed += 1;
      console.error(
        "[door-tap-intent] sweep row failed",
        row.id,
        rowError instanceof Error ? rowError.message : "unknown",
      );
    }
  }
  return jsonResponse({ swept: tally });
}

/** The card brand and last four of a succeeded card_present charge. */
export function cardPresentDetails(
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

async function handleComplete(
  body: Body,
  actorId: string,
  deps: DoorTapIntentDeps,
): Promise<Response> {
  if (body.clientError === "offline_pin_required") {
    return jsonResponse({ error: "offline_pin_required" }, 400);
  }
  const paymentIntentId = body.paymentIntentId;
  if (
    typeof paymentIntentId !== "string" || !/^pi_[A-Za-z0-9]+$/.test(paymentIntentId) ||
    !isUuid(body.clientRequestId)
  ) {
    return jsonResponse({ error: "payment_not_succeeded" }, 400);
  }
  const supabase = deps.serviceClient();
  const { data: intent, error } = await supabase
    .from("door_tap_intents")
    .select("id, event_id, client_request_id, stripe_account_id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (error) return jsonResponse({ error: "server_error" }, 500);
  if (!intent || intent.client_request_id !== body.clientRequestId) {
    return jsonResponse({ error: "payment_not_succeeded" }, 400);
  }
  if (!(await canTakeDoorPayment(supabase, intent.event_id, actorId))) {
    return jsonResponse({ error: "door_access_denied" }, 400);
  }
  const stripe = deps.stripe();
  // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (GET; no mutation to dedupe)
  // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
  const pi = await stripe.paymentIntents.retrieve(
    paymentIntentId,
    { expand: ["latest_charge"] },
    { stripeAccount: intent.stripe_account_id },
  );
  if (
    pi?.status !== "succeeded" ||
    pi?.metadata?.mingla_door_tap_intent_id !== intent.id
  ) {
    return jsonResponse({ error: "payment_not_succeeded", status: pi?.status ?? null }, 409);
  }
  const card = cardPresentDetails(pi);
  const { data: recorded, error: recordError } = await supabase.rpc(
    "biz_door_tap_record",
    {
      p_payment_intent_id: paymentIntentId,
      p_charge_id: card.chargeId,
      p_amount_received_cents: Number(pi.amount_received ?? pi.amount ?? 0),
      p_card_brand: card.brand,
      p_card_last4: card.last4,
    },
  );
  if (recordError) {
    const mapped = doorErrorFromDb(recordError.message);
    console.error("[door-tap-intent] record failed", recordError.message);
    return jsonResponse({ error: mapped.error }, mapped.status);
  }
  return jsonResponse(recorded);
}

export const createDoorTapIntentHandler = (
  deps: DoorTapIntentDeps = defaultDeps,
): (req: Request) => Promise<Response> =>
  wrapEdgeHandler("door-tap-intent", async (req) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") return jsonResponse({ error: "invalid_request" }, 405);
    let body: Body;
    try {
      const parsed = await req.json();
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return jsonResponse({ error: "invalid_request" }, 400);
      }
      body = parsed as Body;
    } catch {
      return jsonResponse({ error: "invalid_request" }, 400);
    }
    if (body.action === "sweep_unfinished") return await handleSweepUnfinished(req, deps);
    const actorId = await deps.userIdFromAuthHeader(req);
    if (actorId === null) return jsonResponse({ error: "door_access_denied" }, 401);
    switch (body.action) {
      case "create":
        return await handleCreate(body, actorId, deps);
      case "complete":
        return await handleComplete(body, actorId, deps);
      case "location":
        return await handleLocation(body, actorId, deps);
      case "cancel":
        return await handleCancel(body, actorId, deps);
      case "seen":
        return await handleSeen(body, actorId, deps);
      default:
        return jsonResponse({ error: "invalid_request" }, 400);
    }
  }, {
    onError: (_err, requestId) =>
      jsonResponse({ error: "server_error", requestId }, 500),
  });

if (import.meta.main) {
  serve(createDoorTapIntentHandler());
}
