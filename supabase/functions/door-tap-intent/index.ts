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
  canTakeDoorPayment,
  loadDoorPricing,
  quoteDoorSale,
} from "../_shared/doorPayServer.ts";
import {
  ensureTerminalLocation,
  loadTapContext,
  terminalAddressFor,
} from "../_shared/doorTerminal.ts";
import { doorErrorFromDb, isUuid } from "../_shared/doorPay.ts";

export interface DoorTapIntentDeps {
  // deno-lint-ignore no-explicit-any
  serviceClient: () => any;
  userIdFromAuthHeader: (req: Request) => Promise<string | null>;
  // deno-lint-ignore no-explicit-any
  stripe: () => any;
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
  const stripe = deps.stripe();

  // Replay: same clientRequestId, same PaymentIntent (never a second charge).
  const { data: existing } = await supabase
    .from("door_tap_intents")
    .select(
      "id, stripe_payment_intent_id, stripe_account_id, stripe_location_id, total_cents, currency",
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
    currency: quote.money.currency,
    stripeAccountId: quote.stripeAccountId,
    locationId,
  });
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
    const actorId = await deps.userIdFromAuthHeader(req);
    if (actorId === null) return jsonResponse({ error: "door_access_denied" }, 401);
    switch (body.action) {
      case "create":
        return await handleCreate(body, actorId, deps);
      case "complete":
        return await handleComplete(body, actorId, deps);
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
