// ===========================================================================
// Issue #1790 (SPEC #1788 P-22, P-23, P-29) — venue-order-create.
//
// The SINGLE guest order write path, on the `venue-reservation-create`
// anon-capable pattern: verify_jwt = false, auth OPTIONAL via
// userIdFromAuthHeader, so ONE function serves an authenticated app user AND an
// anonymous web guest.
//
// It NEVER hand-rolls fee/tax math — it imports the shared all-in engine
// through _shared/venueOrderPricing.ts (Constitution #2, the
// orch-1147-allin-single-owner gate family). A price sent by a client is
// IGNORED; if present it is a validation error, not a hint (P-20).
//
// DARK IN THIS PHASE: `venue_ordering_settings.ordering_enabled` defaults FALSE
// for every venue and no surface flips it until #1791's Orders queue exists, so
// gate 3 refuses every real request today. That is the whole rollback story.
//
// Deploy from MERGED origin/main only.
// ===========================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { wrapEdgeHandler } from "../_shared/structuredLog.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import { resolvePublishableKey } from "../_shared/stripeMode.ts";
import { getPaymentMethodTypes } from "../_shared/stripePaymentMethods.ts";
import {
  classifyStripeCheckoutSessionCreateFailure,
  classifyStripePaymentIntentCreateFailure,
  jsonResponse,
  normalizePhoneE164,
  randomBuyerStatusToken,
  serviceClient,
  sha256Hex,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import {
  paystackChannelsForCountry,
  resolveProviderRouting,
} from "../_shared/paymentProvider.ts";
import { paystackInitializeTransaction } from "../_shared/paystack.ts";
import { MINGLA_SERVICE_FEE_BPS, type PricingRegion, type PricingSwitches } from "../_shared/allInPricingEngine.ts";
import {
  computeVenueOrderMoney,
  priceCart,
  type RequestedLine,
  venueOrderErrorCopy,
  type VenueOrderErrorCode,
  venueOrderErrorStatus,
  venueOrderIdempotencyKey,
} from "../_shared/venueOrderPricing.ts";
import {
  checkOrderRateLimit,
  insertVenueOrderRow,
  loadMenuSnapshot,
  markVenueOrderFailed,
  resolveOrderContext,
} from "../_shared/venueOrderCore.ts";
import { venueOrderPaystackReference } from "../_shared/venueOrderWebhook.ts";
import { venueOrderSplitFields } from "./ngPaystackSplit.ts";

const ENABLED_PRICING_REGIONS = ["GB", "US", "EU", "CH"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** P-29 — the machine code AND the exact user-visible copy, together. */
function fail(
  code: VenueOrderErrorCode,
  vars: { venue?: string; item?: string; group?: string } = {},
): Response {
  return jsonResponse(
    { error: code, message: venueOrderErrorCopy(code, "guest", vars) },
    venueOrderErrorStatus(code),
  );
}

serve(wrapEdgeHandler("venue-order-create", async (req) => {
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
    return fail("invalid_json");
  }

  const spotCode = typeof body.spotCode === "string" && body.spotCode.trim()
    ? body.spotCode.trim()
    : null;
  const bodyVenueId = typeof body.venueId === "string" && UUID_RE.test(body.venueId)
    ? body.venueId
    : null;
  const bodySessionId =
    typeof body.sessionId === "string" && UUID_RE.test(body.sessionId)
      ? body.sessionId
      : null;
  const surface = body.surface === "web" || body.surface === "mobile-web"
    ? "web"
    : "native";
  const mode = body.mode === "preview" ? "preview" : "create";
  const buyer = (body.buyer ?? {}) as Record<string, unknown>;
  const buyerName = typeof buyer.name === "string" ? buyer.name.trim() : "";
  const buyerEmail = typeof buyer.email === "string"
    ? buyer.email.trim().toLowerCase()
    : "";
  const buyerPhoneE164 = normalizePhoneE164(buyer.phone);
  const partySizeClaimed = Number.isInteger(body.partySizeClaimed)
    ? Number(body.partySizeClaimed)
    : null;
  const tipBps = Number.isInteger(body.tipBps) ? Number(body.tipBps) : null;
  const tipFlatCents = Number.isInteger(body.tipFlatCents)
    ? Number(body.tipFlatCents)
    : null;
  const clientIdempotencyKey =
    typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim().slice(0, 200)
      : null;
  const entrySource = typeof body.src === "string" && body.src.trim()
    ? body.src.trim().slice(0, 40)
    : null;

  // ── P-20 — a price in the request body is a VALIDATION ERROR, not a hint. ──
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const PRICE_KEYS = [
    "unitPriceCents",
    "priceCents",
    "lineTotalCents",
    "amountCents",
    "subtotalCents",
    "totalCents",
    "price",
    "amount",
  ];
  for (const raw of rawLines as Array<Record<string, unknown>>) {
    for (const key of PRICE_KEYS) {
      if (raw !== null && typeof raw === "object" && key in raw) {
        return fail("order_total_invalid");
      }
    }
  }
  for (const key of PRICE_KEYS) {
    if (key in body) return fail("order_total_invalid");
  }

  const requested: RequestedLine[] = [];
  for (const raw of rawLines as Array<Record<string, unknown>>) {
    const menuItemId = typeof raw?.menuItemId === "string" ? raw.menuItemId : "";
    if (!UUID_RE.test(menuItemId)) return fail("order_total_invalid");
    const quantity = Number.isInteger(raw?.quantity) ? Number(raw.quantity) : NaN;
    const modifierIds = Array.isArray(raw?.modifierIds)
      ? (raw.modifierIds as unknown[]).filter((m): m is string =>
        typeof m === "string" && UUID_RE.test(m)
      )
      : [];
    const notes = typeof raw?.notes === "string" && raw.notes.trim()
      ? raw.notes.trim().slice(0, 140)
      : null;
    requested.push({ menuItemId, quantity, modifierIds, notes });
  }
  if (requested.length === 0) return fail("order_total_invalid");

  const userId = await userIdFromAuthHeader(req);
  const supabase = serviceClient();

  // ── Gates 1-3 ────────────────────────────────────────────────────────────
  const resolved = await resolveOrderContext(supabase, {
    spotCode,
    venueId: bodyVenueId,
  });
  if (!resolved.ok) {
    return fail(resolved.failure.code, { venue: resolved.failure.venue });
  }
  const ctx = resolved.context;

  // ── OQ-5 — the limiter. Soft + retryable when exceeded; fail-OPEN when the
  //    limiter itself breaks (structured log inside checkOrderRateLimit).
  const rateScope = ctx.spotId !== null
    ? `spot:${ctx.spotId}`
    : `venue-counter:${ctx.servingVenueId}`;
  if (mode === "create" && !(await checkOrderRateLimit(supabase, rateScope, 10))) {
    return fail("too_many_orders");
  }

  // ── Gate 7 — counter pickup ──────────────────────────────────────────────
  if (ctx.spotId === null) {
    if (ctx.settings.counter_pickup_enabled !== true) {
      return fail("counter_pickup_unavailable");
    }
    if (buyerName.length < 2) return fail("buyer_name_required");
  }

  // ── Gates 4-6 — orderability, modifiers, single currency ─────────────────
  const menu = await loadMenuSnapshot(supabase, {
    brandId: ctx.brandId,
    servingVenueId: ctx.servingVenueId,
    servingMenuId: ctx.servingMenuId,
    menuItemIds: [...new Set(requested.map((line) => line.menuItemId))],
  });
  const cart = priceCart({
    requested,
    itemsById: menu.itemsById,
    groupsByItemId: menu.groupsByItemId,
    modifiersById: menu.modifiersById,
    orderableItemIds: menu.orderableItemIds,
  });
  if (!cart.ok) {
    const failure = cart.failure;
    if (failure.code === "item_not_orderable") {
      return fail("item_not_orderable", { item: failure.item });
    }
    if (failure.code === "modifier_selection_invalid") {
      return fail("modifier_selection_invalid", { group: failure.group });
    }
    return fail(failure.code);
  }

  // ── Gate 9 — pricing. resolve_brand_pricing_inputs needs NO event; it is
  //    venue-scoped and deterministic when the venue is passed explicitly. ────
  const { data: pricingRows, error: pricingError } = await supabase.rpc(
    "resolve_brand_pricing_inputs",
    { p_brand_id: ctx.brandId, p_venue_id: ctx.servingVenueId },
  );
  if (pricingError || !Array.isArray(pricingRows) || pricingRows.length === 0) {
    console.error("[venue-order-create] resolve_brand_pricing_inputs failed", pricingError);
    return fail("order_total_invalid");
  }
  const pricing = pricingRows[0] as Record<string, unknown>;
  const settlementCurrency = typeof pricing.pricing_currency === "string"
    ? pricing.pricing_currency.trim().toUpperCase()
    : "";
  if (settlementCurrency.length !== 3) return fail("order_total_invalid");
  // I-PROPOSED-1767-NEVER-CROSS-SUM-CURRENCIES — the menu's currency and the
  // brand's settlement currency must agree, or we would charge in one currency
  // and price in another.
  if (cart.currency !== settlementCurrency) return fail("mixed_currency");

  const routing = resolveProviderRouting({
    payment_provider: pricing.payment_provider as string | null,
    payment_country: pricing.payment_country as string | null,
    pricing_currency: pricing.pricing_currency as string | null,
  });
  const rawRegion = typeof pricing.pricing_region === "string"
    ? pricing.pricing_region.trim().toUpperCase()
    : "";
  const region: PricingRegion = routing.provider === "paystack"
    ? "NG"
    : ((ENABLED_PRICING_REGIONS as readonly string[]).includes(rawRegion)
      ? rawRegion as PricingRegion
      : "GB");
  const switches: PricingSwitches = {
    pass_tax: pricing.pass_tax === true,
    pass_mingla_fee: pricing.pass_mingla_fee === true,
    pass_service_fee: pricing.pass_service_fee === true,
  };

  // The sitting's remembered tip (P-18 / OQ-2): asked on the FIRST round and
  // remembered thereafter, changeable at any round, never re-asked unprompted.
  let session: Record<string, unknown> | null = null;
  if (bodySessionId !== null) {
    const { data } = await supabase
      .from("venue_order_sessions")
      .select("id, brand_id, venue_id, qr_spot_id, currency, tip_bps_choice, reservation_id, tab_state")
      .eq("id", bodySessionId)
      .maybeSingle();
    if (data && String(data.venue_id) === ctx.servingVenueId) {
      session = data as Record<string, unknown>;
    }
  }
  const effectiveTipBps = tipBps !== null
    ? tipBps
    : (session?.tip_bps_choice === null || session?.tip_bps_choice === undefined
      ? null
      : Number(session.tip_bps_choice));

  const money = computeVenueOrderMoney({
    subtotalCents: cart.subtotalCents,
    serviceChargeBps: ctx.settings.service_charge_bps,
    // D-9: where a service charge is set, the tip selector DEFAULTS TO NONE
    // rather than stacking. An EXPLICIT tip is always honoured.
    tipBps: ctx.settings.tips_enabled === false ? null : effectiveTipBps,
    tipFlatCents: ctx.settings.tips_enabled === false ? null : tipFlatCents,
    switches,
    region,
    currency: settlementCurrency,
    effectiveTakeRateBps: Number(pricing.effective_take_rate_bps ?? 0),
    takeRateSource:
      (pricing.take_rate_source as "brand_override" | "platform_default") ??
        "platform_default",
    serviceFeeBps: MINGLA_SERVICE_FEE_BPS,
    vatRateBps: pricing.vat_rate_bps === null ? 0 : Number(pricing.vat_rate_bps),
  });

  // ── mode:"preview" — the cart's totals come from the SERVER. No row, no
  //    provider call, nothing charged. ───────────────────────────────────────
  if (mode === "preview") {
    return jsonResponse({
      kind: "preview",
      currency: settlementCurrency,
      subtotalCents: money.subtotalCents,
      serviceChargeCents: money.serviceChargeCents,
      serviceChargeLabel: ctx.settings.service_charge_label,
      feeBasisCents: money.feeBasisCents,
      buyerSubtotalCents: money.buyerSubtotalCents,
      taxAmountCents: money.taxAmountCents,
      tipCents: money.tipCents,
      totalCents: money.totalCents,
      pricingBreakdown: money.pricingBreakdown,
      lines: cart.lines,
    });
  }

  // ── Gate 8 — the contact triple, validated server-side and E.164-normalised.
  //    UNCONDITIONAL, on purpose. A zero-total order still lands as
  //    money_path='mingla' + payment_status='paid' (there is nothing to wait
  //    for), and venue_orders_paid_needs_contact makes that row UNWRITABLE
  //    without all three — so conditioning this on "does money move" would turn
  //    a legitimate free order into an opaque `order_total_invalid` at INSERT
  //    time instead of a clear "we need a phone number" at the gate. It is also
  //    what the ticket path enforces: the guest needs a receipt and a status
  //    link whether or not the number happened to be zero. ──────────────────
  const movesMoney = money.totalCents > 0;
  if (buyerName.length < 2) return fail("buyer_name_required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    return fail("buyer_email_invalid");
  }
  if (buyerPhoneE164 === null) return fail("buyer_phone_required");

  // ── Gate 9b — charge readiness, BEFORE any row is written. ───────────────
  const stripeAccountId = typeof pricing.stripe_account_id === "string"
    ? pricing.stripe_account_id
    : null;
  const paystackSubaccount = typeof pricing.paystack_subaccount_code === "string"
    ? pricing.paystack_subaccount_code
    : null;
  const { data: cutoverRow } = await supabase
    .from("brands")
    .select("payout_hold_cutover_at")
    .eq("id", ctx.brandId)
    .maybeSingle();
  const isCutover =
    ((cutoverRow as { payout_hold_cutover_at?: string | null } | null)
      ?.payout_hold_cutover_at ?? null) !== null;
  if (movesMoney) {
    if (routing.provider === "paystack") {
      if (!isCutover && !paystackSubaccount) {
        return fail("stripe_account_not_ready", { venue: ctx.venueName });
      }
    } else if (!stripeAccountId || pricing.stripe_charges_enabled !== true) {
      return fail("stripe_account_not_ready", { venue: ctx.venueName });
    }
  }

  // ── P-23 layer 1 — idempotency. The client MUST send a per-tap key; the
  //    derived composite is the CRASH-SAFETY FLOOR beneath it. ──────────────
  const sessionKeyPart = session !== null ? String(session.id) : (bodySessionId ?? "new");
  const idempotencyKey = clientIdempotencyKey ??
    await venueOrderIdempotencyKey(
      { sessionId: sessionKeyPart, lines: requested, tipBps: effectiveTipBps },
      sha256Hex,
    );
  {
    const { data: existing } = await supabase
      .from("venue_orders")
      .select("id, total_cents, currency, payment_status, buyer_status_token_hash")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing) {
      // A replayed submit returns the EXISTING order, never a second one. The
      // plaintext status token is held only by the first response — a replay
      // legitimately cannot re-mint it, and saying so is honest.
      return jsonResponse({
        kind: "already_created",
        orderId: String(existing.id),
        totalCents: Number(existing.total_cents),
        currency: String(existing.currency),
        paymentStatus: String(existing.payment_status),
      });
    }
  }

  // ── The sitting. Minted only when the guest did not continue one. ────────
  let sessionId: string;
  if (session !== null) {
    sessionId = String(session.id);
    const sessionUpdate: Record<string, unknown> = {};
    if (partySizeClaimed !== null && session.party_size_claimed == null) {
      sessionUpdate.party_size_claimed = partySizeClaimed;
    }
    if (tipBps !== null) sessionUpdate.tip_bps_choice = tipBps;
    if (Object.keys(sessionUpdate).length > 0) {
      await supabase.from("venue_order_sessions").update(sessionUpdate).eq("id", sessionId);
    }
  } else {
    const { data: created, error: sessionError } = await supabase
      .from("venue_order_sessions")
      .insert({
        brand_id: ctx.brandId,
        venue_id: ctx.servingVenueId,
        qr_spot_id: ctx.spotId,
        party_size_claimed: partySizeClaimed !== null && partySizeClaimed >= 1 &&
            partySizeClaimed <= 100
          ? partySizeClaimed
          : null,
        currency: settlementCurrency,
        tip_bps_choice: tipBps,
      })
      .select("id")
      .single();
    if (sessionError || !created) {
      console.error("[venue-order-create] session insert failed", sessionError);
      return fail("internal_error");
    }
    sessionId = String((created as Record<string, unknown>).id);
  }

  // Counter pickup mints a server-side code. A client-composed code would
  // collide two guests onto one number.
  let pickupCode: string | null = null;
  if (ctx.spotId === null) {
    const { data: code, error: codeError } = await supabase.rpc(
      "pg_venue_order_next_pickup_code",
      { p_venue_id: ctx.servingVenueId },
    );
    if (codeError || typeof code !== "string") {
      console.error("[venue-order-create] pickup code mint failed", codeError);
      return fail("internal_error");
    }
    pickupCode = code;
  }

  const buyerStatusToken = randomBuyerStatusToken();
  const guestCancelToken = randomBuyerStatusToken();

  // ── Gate 10 — the row is written BEFORE the provider call, so a charge can
  //    never exist without a row to flip. The atomicity contract. ───────────
  const orderRow: Record<string, unknown> = {
    session_id: sessionId,
    brand_id: ctx.brandId,
    venue_id: ctx.servingVenueId,
    qr_spot_id: ctx.spotId,
    spot_label_at_order: ctx.spotLabel,
    venue_table_id: ctx.venueTableId,
    stay_unit_id: ctx.stayUnitId,
    zone_at_order: ctx.zone,
    reservation_id: session?.reservation_id ?? null,
    source: ctx.spotId !== null ? "guest_qr" : "guest_page",
    entry_source: entrySource,
    pickup_code: pickupCode,
    buyer_user_id: userId,
    buyer_name: buyerName,
    buyer_email: buyerEmail,
    buyer_phone_e164: buyerPhoneE164,
    money_path: "mingla",
    currency: settlementCurrency,
    subtotal_cents: money.subtotalCents,
    service_charge_bps: money.serviceChargeBps,
    service_charge_cents: money.serviceChargeCents,
    tip_cents: money.tipCents,
    effective_take_rate_bps: Number(pricing.effective_take_rate_bps ?? 0),
    service_fee_bps: MINGLA_SERVICE_FEE_BPS,
    mingla_fee_cents: money.minglaFeeCents,
    platform_service_fee_cents: money.platformServiceFeeCents,
    pass_mingla_fee: switches.pass_mingla_fee,
    pass_service_fee: switches.pass_service_fee,
    pass_tax: switches.pass_tax,
    buyer_subtotal_cents: money.buyerSubtotalCents,
    tax_amount_cents: money.taxAmountCents,
    total_cents: money.totalCents,
    pricing_breakdown: money.pricingBreakdown,
    provider: routing.provider,
    stripe_account_id: routing.provider === "stripe" ? stripeAccountId : null,
    // A zero-total order is complete on arrival: nothing to charge, so nothing
    // to wait for. total_cents = 0 keeps it out of the payout sweep by predicate.
    payment_status: movesMoney ? "pending" : "paid",
    confirmed_at: movesMoney ? null : new Date().toISOString(),
    buyer_status_token_hash: await sha256Hex(buyerStatusToken),
    guest_cancel_token_hash: `v1:${await sha256Hex(guestCancelToken)}`,
    idempotency_key: idempotencyKey,
    metadata: movesMoney ? {} : { zero_total: true },
    expires_at: movesMoney
      ? new Date(Date.now() + 30 * 60 * 1000).toISOString()
      : null,
  };

  let orderId: string;
  try {
    orderId = await insertVenueOrderRow(supabase, orderRow, cart.lines);
  } catch (err) {
    console.error("[venue-order-create] order insert failed", err);
    return fail("order_total_invalid");
  }

  if (!movesMoney) {
    return jsonResponse({
      kind: "free_completed",
      orderId,
      sessionId,
      buyerStatusToken,
      guestCancelToken,
      pickupCode,
      totalCents: 0,
      currency: settlementCurrency,
      pricingBreakdown: money.pricingBreakdown,
    });
  }

  // ── PAYSTACK ARM (NG). The reference is PERSISTED before the call — Paystack
  //    accepts no idempotency key, so the reference IS the key. ─────────────
  if (routing.provider === "paystack") {
    const reference = venueOrderPaystackReference(orderId);
    const { error: refError } = await supabase
      .from("venue_orders")
      .update({ paystack_reference: reference })
      .eq("id", orderId);
    if (refError) {
      await markVenueOrderFailed(supabase, orderId, refError.message);
      return fail("payment_intent_create_failed");
    }
    const callbackBase = Deno.env.get("PAYSTACK_CALLBACK_BASE") ??
      "https://business.usemingla.com/pay/callback";
    const callbackUrl = `${callbackBase}?vo=${encodeURIComponent(orderId)}&bst=${
      encodeURIComponent(buyerStatusToken)
    }`;
    try {
      const init = await paystackInitializeTransaction({
        email: buyerEmail,
        amountSubunits: money.totalCents,
        currency: "NGN",
        reference,
        callbackUrl,
        channels: paystackChannelsForCountry("NG"),
        metadata: {
          mingla_venue_order_id: orderId,
          mingla_brand_id: ctx.brandId,
          mingla_buyer_email: buyerEmail,
        },
        // P-50 — NG partner share is ZERO at launch, so nothing partner-shaped
        // rides here; the subaccount split is the shipped unstamped-brand rail.
        ...venueOrderSplitFields(isCutover, paystackSubaccount, money.minglaFeeCents),
      });
      return jsonResponse({
        kind: "requires_paystack_redirect",
        orderId,
        sessionId,
        buyerStatusToken,
        guestCancelToken,
        authorizationUrl: init.authorization_url,
        reference: init.reference,
        totalCents: money.totalCents,
        currency: "NGN",
        pricingBreakdown: money.pricingBreakdown,
      });
    } catch (err) {
      await markVenueOrderFailed(supabase, orderId, String((err as Error)?.message ?? err));
      return fail("payment_intent_create_failed");
    }
  }

  // ── STRIPE WEB → hosted Checkout Session. ────────────────────────────────
  if (surface === "web") {
    const baseUrl = Deno.env.get("BUSINESS_WEB_ORIGIN") ??
      Deno.env.get("MINGLA_PUBLIC_WEB_BASE_URL");
    if (!baseUrl || !/^https:\/\/[^\s]+$/.test(baseUrl)) {
      await markVenueOrderFailed(supabase, orderId, "web_base_url_missing");
      return fail("internal_error");
    }
    try {
      const stripeWeb = stripeTicketCheckout();
      // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
      const checkoutSession = await stripeWeb.checkout.sessions.create({
        mode: "payment",
        currency: settlementCurrency.toLowerCase(),
        line_items: [{
          price_data: {
            currency: settlementCurrency.toLowerCase(),
            unit_amount: money.totalCents,
            product_data: { name: `Order at ${ctx.venueName}` },
          },
          quantity: 1,
        }],
        payment_intent_data: {
          metadata: {
            mingla_venue_order_id: orderId,
            mingla_brand_id: ctx.brandId,
            mingla_buyer_email: buyerEmail,
          },
          ...(money.minglaFeeCents > 0
            ? { application_fee_amount: money.minglaFeeCents }
            : {}),
          statement_descriptor_suffix: "MINGLA",
        },
        customer_email: buyerEmail,
        success_url:
          `${baseUrl}/o/venue/${orderId}?bst=${buyerStatusToken}&cs={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/b`,
        metadata: {
          mingla_venue_order_id: orderId,
          mingla_brand_id: ctx.brandId,
        },
      }, {
        idempotencyKey: `venue_order_web:${orderId}`,
        stripeAccount: stripeAccountId!,
      });
      if (!checkoutSession.url) {
        await markVenueOrderFailed(supabase, orderId, "checkout_session_url_missing");
        return fail("payment_intent_create_failed");
      }
      await supabase
        .from("venue_orders")
        .update({ stripe_checkout_session_id: checkoutSession.id })
        .eq("id", orderId);
      return jsonResponse({
        kind: "requires_web_redirect",
        orderId,
        sessionId,
        buyerStatusToken,
        guestCancelToken,
        url: checkoutSession.url,
        totalCents: money.totalCents,
        currency: settlementCurrency,
        pricingBreakdown: money.pricingBreakdown,
      });
    } catch (err) {
      const failure = classifyStripeCheckoutSessionCreateFailure(err);
      await markVenueOrderFailed(supabase, orderId, failure.detail);
      return fail("payment_intent_create_failed");
    }
  }

  // ── STRIPE NATIVE → PaymentIntent on the connected account. ──────────────
  try {
    const stripe = stripeTicketCheckout();
    const piBody: Record<string, unknown> = {
      amount: money.totalCents,
      currency: settlementCurrency.toLowerCase(),
      payment_method_types: [...getPaymentMethodTypes()],
      metadata: {
        mingla_venue_order_id: orderId,
        mingla_brand_id: ctx.brandId,
        mingla_buyer_email: buyerEmail,
      },
    };
    // application_fee_amount is ALWAYS the Mingla fee — a function of the fee
    // basis, which cannot contain a tip. Under direct charges the connected
    // account receives everything else, so the TIP LANDS IN THE VENUE'S BALANCE
    // UNTOUCHED, by arithmetic rather than by policy.
    if (money.minglaFeeCents > 0) {
      piBody.application_fee_amount = money.minglaFeeCents;
    }
    // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
    const paymentIntent = await stripe.paymentIntents.create(piBody, {
      idempotencyKey: `venue_order:${orderId}`,
      stripeAccount: stripeAccountId!,
    });
    const { error: persistError } = await supabase
      .from("venue_orders")
      .update({ stripe_payment_intent_id: paymentIntent.id })
      .eq("id", orderId);
    if (persistError) {
      return fail("payment_intent_create_failed");
    }
    return jsonResponse({
      kind: "requires_payment",
      orderId,
      sessionId,
      buyerStatusToken,
      guestCancelToken,
      clientSecret: String(paymentIntent.client_secret ?? ""),
      paymentIntentId: paymentIntent.id,
      publishableKey: resolvePublishableKey(),
      stripeAccountId,
      totalCents: money.totalCents,
      currency: settlementCurrency,
      pricingBreakdown: money.pricingBreakdown,
    });
  } catch (err) {
    const failure = classifyStripePaymentIntentCreateFailure(err);
    await markVenueOrderFailed(supabase, orderId, failure.detail);
    return fail("payment_intent_create_failed");
  }
}, {
  onError: (_err, requestId) =>
    jsonResponse({
      error: "internal_error",
      message: venueOrderErrorCopy("internal_error", "guest"),
      requestId,
    }, 500),
}));
