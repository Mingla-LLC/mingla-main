// ===========================================================================
// Issue #1790 (SPEC #1788 P-26, P-2a) — venue-order-staff: the STAFF order path
// and the SETTLEMENT paths.
//
// Phase 2 ships the money-bearing actions only:
//   create      — the waiter's order pad (same spots, same menu, same modifiers,
//                 same SERVER-SIDE pricing as the guest path; not one number is
//                 computed differently).
//   settle      — { bill_to_phone | venue_collected } for ONE order.
//   tab_open    — open a staff tab on a sitting.
//   tab_close   — { bill_to_phone | venue_collected } for a whole tab (P-2a).
// `transition`, `item_availability` and `pause` belong to #1791/#1789 and are
// deliberately ABSENT here rather than half-built.
//
// verify_jwt = false with a Bearer REQUIRED IN-CODE (the §S6 table): the token is
// verified via auth.getUser, then the brand-membership floor is checked, and the
// rank-gated mutations enforce their own floor INSIDE the SECURITY DEFINER RPC
// (biz_venue_tab_open / biz_venue_tab_close require >= event_manager).
//
// MONEY-PATH NOTE, stated rather than buried. P-26 says "money_path is chosen at
// SETTLE, not at create", and P-3 CHECK 4 says money_path='mingla' REQUIRES a
// provider. Those two cannot both be satisfied by writing 'mingla' at create.
// An unsettled staff order is therefore written in the `venue_collected` shape,
// which is what is literally true at that moment — no provider has been called,
// no fee has been taken, and Mingla holds nothing. `settle` then either leaves
// it (cash) or REWRITES it onto the Mingla rail with real fees. Nothing is
// widened, and the structural promise stays intact.
// ===========================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { wrapEdgeHandler } from "../_shared/structuredLog.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import { getPaymentMethodTypes } from "../_shared/stripePaymentMethods.ts";
import { resolvePublishableKey } from "../_shared/stripeMode.ts";
import {
  classifyStripePaymentIntentCreateFailure,
  jsonResponse,
  normalizePhoneE164,
  randomBuyerStatusToken,
  serviceClient,
  sha256Hex,
  ticketCorsHeaders,
  userClient,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import {
  MINGLA_SERVICE_FEE_BPS,
  type PricingRegion,
  type PricingSwitches,
} from "../_shared/allInPricingEngine.ts";
import {
  computeVenueOrderMoney,
  priceCart,
  type RequestedLine,
  venueOrderErrorCopy,
  type VenueOrderErrorCode,
  venueOrderErrorStatus,
} from "../_shared/venueOrderPricing.ts";
import {
  findReplayableVenueOrder,
  insertVenueOrderRow,
  loadMenuSnapshot,
  markVenueOrderFailed,
  resolveOrderContext,
} from "../_shared/venueOrderCore.ts";
import { paystackInitializeTransaction } from "../_shared/paystack.ts";
import {
  paystackChannelsForCountry,
  resolveProviderRouting,
} from "../_shared/paymentProvider.ts";
import { venueOrderPaystackReference } from "../_shared/venueOrderWebhook.ts";
import { venueOrderSplitFields } from "../venue-order-create/ngPaystackSplit.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENABLED_PRICING_REGIONS = ["GB", "US", "EU", "CH"] as const;

/** P-29 — the machine code AND the exact STAFF-facing copy, together. */
function fail(
  code: VenueOrderErrorCode,
  vars: { venue?: string; item?: string; group?: string } = {},
): Response {
  return jsonResponse(
    { error: code, message: venueOrderErrorCopy(code, "staff", vars) },
    venueOrderErrorStatus(code),
  );
}

// deno-lint-ignore no-explicit-any
type ServiceClient = any;

serve(wrapEdgeHandler("venue-order-staff", async (req) => {
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

  // Bearer REQUIRED in-code. verify_jwt=false only means the GATEWAY does not
  // check it; this function does, cryptographically, before anything else.
  const userId = await userIdFromAuthHeader(req);
  if (userId === null) return jsonResponse({ error: "not_authorized" }, 401);

  const supabase = serviceClient();
  const action = typeof body.action === "string" ? body.action : "";

  switch (action) {
    case "create":
      return await handleStaffCreate(supabase, req, body, userId);
    case "settle":
      return await handleSettle(supabase, body, userId);
    case "tab_open":
      return await handleTabOpen(req, body);
    case "tab_close":
      return await handleTabClose(supabase, req, body, userId);
    default:
      return jsonResponse({ error: "unknown_action" }, 400);
  }
}, {
  onError: (_err, requestId) =>
    jsonResponse({
      error: "internal_error",
      message: venueOrderErrorCopy("internal_error", "staff"),
      requestId,
    }, 500),
}));

/** The §S6 floor: brand MEMBERSHIP. Rank gates live inside the RPCs. */
async function callerIsBrandMember(
  supabase: ServiceClient,
  brandId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("brand_team_members")
    .select("id")
    .eq("brand_id", brandId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .not("accepted_at", "is", null)
    .maybeSingle();
  if (error) {
    // Fail CLOSED on an auth read. This is the one place where a broken read
    // must NOT fail open — the rate limiter's fail-open reasoning is about
    // losing a sale, this is about who may take one.
    console.error("[venue-order-staff] membership read failed", error.message);
    return false;
  }
  return data !== null;
}

// ---------------------------------------------------------------------------
// create — the waiter's order pad. Identical pricing to the guest path.
// ---------------------------------------------------------------------------
async function handleStaffCreate(
  supabase: ServiceClient,
  _req: Request,
  body: Record<string, unknown>,
  userId: string,
): Promise<Response> {
  const spotCode = typeof body.spotCode === "string" && body.spotCode.trim()
    ? body.spotCode.trim()
    : null;
  const venueId = typeof body.venueId === "string" && UUID_RE.test(body.venueId)
    ? body.venueId
    : null;
  const sessionId = typeof body.sessionId === "string" && UUID_RE.test(body.sessionId)
    ? body.sessionId
    : null;
  const buyer = (body.buyer ?? {}) as Record<string, unknown>;
  const buyerName = typeof buyer.name === "string" ? buyer.name.trim() : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" &&
      body.idempotencyKey.trim()
    ? body.idempotencyKey.trim().slice(0, 200)
    : null;

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const requested: RequestedLine[] = [];
  for (const raw of rawLines as Array<Record<string, unknown>>) {
    const menuItemId = typeof raw?.menuItemId === "string" ? raw.menuItemId : "";
    if (!UUID_RE.test(menuItemId)) return fail("order_total_invalid");
    requested.push({
      menuItemId,
      quantity: Number.isInteger(raw?.quantity) ? Number(raw.quantity) : NaN,
      modifierIds: Array.isArray(raw?.modifierIds)
        ? (raw.modifierIds as unknown[]).filter((m): m is string =>
          typeof m === "string" && UUID_RE.test(m)
        )
        : [],
      notes: typeof raw?.notes === "string" && raw.notes.trim()
        ? raw.notes.trim().slice(0, 140)
        : null,
    });
  }
  if (requested.length === 0) return fail("order_total_invalid");

  const resolved = await resolveOrderContext(supabase, { spotCode, venueId });
  if (!resolved.ok) {
    return fail(resolved.failure.code, { venue: resolved.failure.venue });
  }
  const ctx = resolved.context;
  if (!(await callerIsBrandMember(supabase, ctx.brandId, userId))) {
    return jsonResponse({ error: "not_authorized" }, 403);
  }

  const menu = await loadMenuSnapshot(supabase, {
    brandId: ctx.brandId,
    servingVenueId: ctx.servingVenueId,
    servingMenuId: ctx.servingMenuId,
    menuItemIds: [...new Set(requested.map((l) => l.menuItemId))],
  });
  const cart = priceCart({
    requested,
    itemsById: menu.itemsById,
    groupsByItemId: menu.groupsByItemId,
    modifiersById: menu.modifiersById,
    orderableItemIds: menu.orderableItemIds,
  });
  if (!cart.ok) {
    const f = cart.failure;
    if (f.code === "item_not_orderable") return fail("item_not_orderable", { item: f.item });
    if (f.code === "modifier_selection_invalid") {
      return fail("modifier_selection_invalid", { group: f.group });
    }
    return fail(f.code);
  }

  // The venue's service charge still applies to a staff-taken order — it is the
  // venue's revenue either way. Mingla's fees are ZERO until settle picks a
  // method, because at this moment Mingla has taken nothing.
  const serviceChargeCents = Math.round(
    (cart.subtotalCents * ctx.settings.service_charge_bps) / 10000,
  );

  if (ctx.spotId === null && buyerName.length < 2) {
    return fail("buyer_name_required");
  }

  let effectiveSessionId = sessionId;
  if (effectiveSessionId === null) {
    const { data: created, error } = await supabase
      .from("venue_order_sessions")
      .insert({
        brand_id: ctx.brandId,
        venue_id: ctx.servingVenueId,
        qr_spot_id: ctx.spotId,
        currency: cart.currency,
      })
      .select("id")
      .single();
    if (error || !created) return fail("internal_error");
    effectiveSessionId = String((created as Record<string, unknown>).id);
  }

  let pickupCode: string | null = null;
  if (ctx.spotId === null) {
    const { data: code, error } = await supabase.rpc(
      "pg_venue_order_next_pickup_code",
      { p_venue_id: ctx.servingVenueId },
    );
    if (error || typeof code !== "string") return fail("internal_error");
    pickupCode = code;
  }

  const orderRow: Record<string, unknown> = {
    session_id: effectiveSessionId,
    brand_id: ctx.brandId,
    venue_id: ctx.servingVenueId,
    qr_spot_id: ctx.spotId,
    spot_label_at_order: ctx.spotLabel,
    venue_table_id: ctx.venueTableId,
    stay_unit_id: ctx.stayUnitId,
    zone_at_order: ctx.zone,
    source: "staff",
    taken_by_user_id: userId,
    pickup_code: pickupCode,
    buyer_name: buyerName.length >= 2 ? buyerName : null,
    // Unsettled: no provider has been called and Mingla holds nothing.
    money_path: "venue_collected",
    currency: cart.currency,
    subtotal_cents: cart.subtotalCents,
    service_charge_bps: ctx.settings.service_charge_bps,
    service_charge_cents: serviceChargeCents,
    tip_cents: 0,
    effective_take_rate_bps: 0,
    service_fee_bps: 0,
    mingla_fee_cents: 0,
    platform_service_fee_cents: 0,
    pass_mingla_fee: false,
    pass_service_fee: false,
    pass_tax: false,
    buyer_subtotal_cents: cart.subtotalCents + serviceChargeCents,
    tax_amount_cents: 0,
    total_cents: cart.subtotalCents + serviceChargeCents,
    payment_status: "pending",
    idempotency_key: idempotencyKey ?? `venue_order_staff:${crypto.randomUUID()}`,
    metadata: { unsettled_staff_order: true },
  };

  let orderId: string;
  try {
    orderId = await insertVenueOrderRow(supabase, orderRow, cart.lines);
  } catch (err) {
    console.error("[venue-order-staff] create failed", err);
    return fail("order_total_invalid");
  }
  return jsonResponse({
    kind: "staff_order_created",
    orderId,
    sessionId: effectiveSessionId,
    pickupCode,
    currency: cart.currency,
    subtotalCents: cart.subtotalCents,
    serviceChargeCents,
    totalCents: orderRow.total_cents,
  });
}

// ---------------------------------------------------------------------------
// settle — ONE order. `venue_collected` never touches a provider.
// ---------------------------------------------------------------------------
async function handleSettle(
  supabase: ServiceClient,
  body: Record<string, unknown>,
  userId: string,
): Promise<Response> {
  const orderId = typeof body.orderId === "string" && UUID_RE.test(body.orderId)
    ? body.orderId
    : null;
  const method = body.method === "bill_to_phone" || body.method === "venue_collected"
    ? body.method
    : null;
  if (orderId === null || method === null) return fail("invalid_json");

  const { data: order, error } = await supabase
    .from("venue_orders")
    .select(
      "id, brand_id, venue_id, session_id, money_path, payment_status, currency, " +
        "subtotal_cents, service_charge_bps, service_charge_cents, tip_cents, taken_by_user_id",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) return fail("internal_error");
  if (!order) return jsonResponse({ error: "not_found" }, 404);
  if (!(await callerIsBrandMember(supabase, String(order.brand_id), userId))) {
    return jsonResponse({ error: "not_authorized" }, 403);
  }
  if (order.payment_status !== "pending") {
    return fail("transition_not_allowed");
  }

  if (method === "venue_collected") {
    // NO provider call, NO fee, NO payout row, NO refund rail. The row is
    // already in that shape; this only records that the guest has paid the
    // venue. It still counts fully in the venue's own numbers.
    const { error: updateError } = await supabase
      .from("venue_orders")
      .update({
        payment_status: "paid",
        confirmed_at: new Date().toISOString(),
        metadata: { settlement_method: "venue_collected" },
      })
      .eq("id", orderId)
      .eq("payment_status", "pending");
    if (updateError) return fail("internal_error");
    return jsonResponse({ kind: "settled_venue_collected", orderId });
  }

  // bill_to_phone — re-price the SNAPSHOT onto the Mingla rail. The subtotal
  // comes from the SNAPSHOTTED lines, never a fresh menu read: a price change
  // mid-service must not move an order that has already been taken
  // (I-PROPOSED-1767-PRICE-SNAPSHOT-AT-ORDER).
  return await billToPhone(supabase, {
    orderId,
    brandId: String(order.brand_id),
    venueId: String(order.venue_id),
    subtotalCents: Number(order.subtotal_cents),
    serviceChargeBps: Number(order.service_charge_bps),
    serviceChargeCents: Number(order.service_charge_cents),
    tipCents: Number(order.tip_cents),
    buyer: (body.buyer ?? {}) as Record<string, unknown>,
    userId,
  });
}

interface BillToPhoneInput {
  orderId: string;
  brandId: string;
  venueId: string;
  subtotalCents: number;
  serviceChargeBps: number;
  serviceChargeCents: number;
  tipCents: number;
  buyer: Record<string, unknown>;
  userId: string;
}

async function billToPhone(
  supabase: ServiceClient,
  input: BillToPhoneInput,
): Promise<Response> {
  const buyerName = typeof input.buyer.name === "string"
    ? input.buyer.name.trim()
    : "";
  const buyerEmail = typeof input.buyer.email === "string"
    ? input.buyer.email.trim().toLowerCase()
    : "";
  const buyerPhone = normalizePhoneE164(input.buyer.phone);
  // The contact triple is not optional here: the row becomes payment_status
  // 'paid' on a Mingla path, and venue_orders_paid_needs_contact makes a paid
  // Mingla order WITHOUT all three literally unwritable.
  if (buyerName.length < 2) return fail("buyer_name_required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) return fail("buyer_email_invalid");
  if (buyerPhone === null) return fail("buyer_phone_required");

  const { data: pricingRows, error: pricingError } = await supabase.rpc(
    "resolve_brand_pricing_inputs",
    { p_brand_id: input.brandId, p_venue_id: input.venueId },
  );
  if (pricingError || !Array.isArray(pricingRows) || pricingRows.length === 0) {
    return fail("order_total_invalid");
  }
  const pricing = pricingRows[0] as Record<string, unknown>;
  const settlementCurrency = typeof pricing.pricing_currency === "string"
    ? pricing.pricing_currency.trim().toUpperCase()
    : "";
  if (settlementCurrency.length !== 3) return fail("order_total_invalid");

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

  const money = computeVenueOrderMoney({
    subtotalCents: input.subtotalCents,
    serviceChargeBps: input.serviceChargeBps,
    tipBps: null,
    tipFlatCents: input.tipCents > 0 ? input.tipCents : null,
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
  if (money.totalCents <= 0) return fail("order_total_invalid");

  const stripeAccountId = typeof pricing.stripe_account_id === "string"
    ? pricing.stripe_account_id
    : null;
  const paystackSubaccount = typeof pricing.paystack_subaccount_code === "string"
    ? pricing.paystack_subaccount_code
    : null;
  const { data: cutoverRow } = await supabase
    .from("brands").select("payout_hold_cutover_at").eq("id", input.brandId).maybeSingle();
  const isCutover =
    ((cutoverRow as { payout_hold_cutover_at?: string | null } | null)
      ?.payout_hold_cutover_at ?? null) !== null;
  if (routing.provider === "paystack") {
    if (!isCutover && !paystackSubaccount) return fail("stripe_account_not_ready");
  } else if (!stripeAccountId || pricing.stripe_charges_enabled !== true) {
    return fail("stripe_account_not_ready");
  }

  const buyerStatusToken = randomBuyerStatusToken();
  // The row moves onto the Mingla rail IN ONE UPDATE, provider included, so it
  // is never momentarily a mingla order without a provider (CHECK 4).
  const { error: repriceError } = await supabase
    .from("venue_orders")
    .update({
      money_path: "mingla",
      provider: routing.provider,
      stripe_account_id: routing.provider === "stripe" ? stripeAccountId : null,
      currency: settlementCurrency,
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
      buyer_name: buyerName,
      buyer_email: buyerEmail,
      buyer_phone_e164: buyerPhone,
      buyer_status_token_hash: await sha256Hex(buyerStatusToken),
      metadata: { settlement_method: "bill_to_phone" },
    })
    .eq("id", input.orderId)
    .eq("payment_status", "pending");
  if (repriceError) {
    console.error("[venue-order-staff] reprice failed", repriceError.message);
    return fail("order_total_invalid");
  }

  if (routing.provider === "paystack") {
    const reference = venueOrderPaystackReference(input.orderId);
    await supabase.from("venue_orders").update({ paystack_reference: reference })
      .eq("id", input.orderId);
    const callbackBase = Deno.env.get("PAYSTACK_CALLBACK_BASE") ??
      "https://business.usemingla.com/pay/callback";
    try {
      const init = await paystackInitializeTransaction({
        email: buyerEmail,
        amountSubunits: money.totalCents,
        currency: "NGN",
        reference,
        callbackUrl: `${callbackBase}?vo=${encodeURIComponent(input.orderId)}&bst=${
          encodeURIComponent(buyerStatusToken)
        }`,
        channels: paystackChannelsForCountry("NG"),
        metadata: {
          mingla_venue_order_id: input.orderId,
          mingla_brand_id: input.brandId,
          mingla_buyer_email: buyerEmail,
        },
        ...venueOrderSplitFields(isCutover, paystackSubaccount, money.minglaFeeCents),
      });
      return jsonResponse({
        kind: "requires_paystack_redirect",
        orderId: input.orderId,
        buyerStatusToken,
        authorizationUrl: init.authorization_url,
        totalCents: money.totalCents,
        currency: "NGN",
      });
    } catch (err) {
      await markVenueOrderFailed(supabase, input.orderId, String((err as Error)?.message ?? err));
      return fail("internal_error");
    }
  }

  try {
    const stripe = stripeTicketCheckout();
    const piBody: Record<string, unknown> = {
      amount: money.totalCents,
      currency: settlementCurrency.toLowerCase(),
      payment_method_types: [...getPaymentMethodTypes()],
      metadata: {
        mingla_venue_order_id: input.orderId,
        mingla_brand_id: input.brandId,
        mingla_buyer_email: buyerEmail,
      },
    };
    if (money.minglaFeeCents > 0) {
      piBody.application_fee_amount = money.minglaFeeCents;
    }
    // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
    const paymentIntent = await stripe.paymentIntents.create(piBody, {
      idempotencyKey: `venue_order:${input.orderId}`,
      stripeAccount: stripeAccountId!,
    });
    await supabase.from("venue_orders")
      .update({ stripe_payment_intent_id: paymentIntent.id })
      .eq("id", input.orderId);
    return jsonResponse({
      kind: "requires_payment",
      orderId: input.orderId,
      buyerStatusToken,
      clientSecret: String(paymentIntent.client_secret ?? ""),
      publishableKey: resolvePublishableKey(),
      stripeAccountId,
      totalCents: money.totalCents,
      currency: settlementCurrency,
    });
  } catch (err) {
    const failure = classifyStripePaymentIntentCreateFailure(err);
    await markVenueOrderFailed(supabase, input.orderId, failure.detail);
    return fail("internal_error");
  }
}

// ---------------------------------------------------------------------------
// tab_open / tab_close — P-2a. Both ride SECURITY DEFINER RPCs called with the
// CALLER's JWT so auth.uid() resolves inside them and the >= event_manager
// floor is enforced by the database, not by this function's opinion.
// ---------------------------------------------------------------------------
async function handleTabOpen(
  req: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  const sessionId = typeof body.sessionId === "string" && UUID_RE.test(body.sessionId)
    ? body.sessionId
    : null;
  if (sessionId === null) return fail("invalid_json");
  const asUser = userClient(req);
  const { data, error } = await asUser.rpc("biz_venue_tab_open", {
    p_session_id: sessionId,
  });
  if (error) return mapTabRpcError(error.message);
  return jsonResponse({ kind: "tab_opened", ...(data as Record<string, unknown>) });
}

async function handleTabClose(
  supabase: ServiceClient,
  req: Request,
  body: Record<string, unknown>,
  userId: string,
): Promise<Response> {
  const sessionId = typeof body.sessionId === "string" && UUID_RE.test(body.sessionId)
    ? body.sessionId
    : null;
  const method = body.settlementMethod === "bill_to_phone" ||
      body.settlementMethod === "venue_collected"
    ? body.settlementMethod
    : null;
  if (sessionId === null || method === null) return fail("invalid_json");

  const asUser = userClient(req);
  const { data, error } = await asUser.rpc("biz_venue_tab_close", {
    p_session_id: sessionId,
    p_settlement_method: method,
  });
  if (error) return mapTabRpcError(error.message);
  const result = (data ?? {}) as Record<string, unknown>;

  if (method === "venue_collected") {
    // Closed already, with no provider call, no fee, and no payout row.
    return jsonResponse({ kind: "tab_closed", ...result });
  }

  // bill_to_phone — the tab sits at `settling` and ONE settlement order carries
  // the outstanding total onto the normal rail. The three sums arrive SEPARATE
  // so the tip never enters the settlement order's fee basis.
  const subtotal = Number(result.outstandingSubtotalCents ?? 0);
  const serviceCharge = Number(result.outstandingServiceChargeCents ?? 0);
  const tip = Number(result.outstandingTipCents ?? 0);
  if (subtotal + serviceCharge + tip <= 0) return fail("order_total_invalid");

  const { data: session } = await supabase
    .from("venue_order_sessions")
    .select("id, brand_id, venue_id, qr_spot_id, currency")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) return jsonResponse({ error: "not_found" }, 404);

  let pickupCode: string | null = null;
  if (session.qr_spot_id === null) {
    const { data: code } = await supabase.rpc("pg_venue_order_next_pickup_code", {
      p_venue_id: String(session.venue_id),
    });
    pickupCode = typeof code === "string" ? code : null;
  }
  const buyer = (body.buyer ?? {}) as Record<string, unknown>;
  const buyerName = typeof buyer.name === "string" ? buyer.name.trim() : "";
  if (pickupCode !== null && buyerName.length < 2) return fail("buyer_name_required");

  // The settlement order is a PAYMENT INSTRUMENT, not a sale: it carries no
  // lines, and `tab_settlement` marks it so a revenue rollup counts the CHILD
  // orders (which hold the items) and never double-counts this row.
  const { data: created, error: insertError } = await supabase
    .from("venue_orders")
    .insert({
      session_id: sessionId,
      brand_id: String(session.brand_id),
      venue_id: String(session.venue_id),
      qr_spot_id: session.qr_spot_id,
      source: "staff",
      taken_by_user_id: userId,
      pickup_code: pickupCode,
      buyer_name: buyerName.length >= 2 ? buyerName : null,
      money_path: "venue_collected",
      currency: String(session.currency),
      subtotal_cents: subtotal,
      service_charge_bps: 0,
      service_charge_cents: serviceCharge,
      tip_cents: tip,
      effective_take_rate_bps: 0,
      service_fee_bps: 0,
      mingla_fee_cents: 0,
      platform_service_fee_cents: 0,
      pass_mingla_fee: false,
      pass_service_fee: false,
      pass_tax: false,
      buyer_subtotal_cents: subtotal + serviceCharge,
      tax_amount_cents: 0,
      total_cents: subtotal + serviceCharge + tip,
      payment_status: "pending",
      idempotency_key: `venue_tab_settlement:${sessionId}`,
      metadata: { tab_settlement: true, settles_session_id: sessionId },
    })
    .select("id")
    .single();
  let settlementOrderId: string;
  if (insertError !== null || !created) {
    // ONE settlement order per tab, forever: the idempotency key is the session
    // id. A retried close (the tab is already `settling`) must resume the SAME
    // payment, never mint a second bill for the same table. Tenant-scoped like
    // every other read of this column (#1819 H-2) — a session id is already
    // unguessable, but the scope is the rule, not a case-by-case judgement.
    const existing = await findReplayableVenueOrder(supabase, {
      brandId: String(session.brand_id),
      venueId: String(session.venue_id),
      idempotencyKey: `venue_tab_settlement:${sessionId}`,
    });
    if (!existing) {
      console.error("[venue-order-staff] settlement order insert failed", insertError);
      return fail("internal_error");
    }
    settlementOrderId = String(existing.id);
  } else {
    settlementOrderId = String((created as Record<string, unknown>).id);
  }

  return await billToPhone(supabase, {
    orderId: settlementOrderId,
    brandId: String(session.brand_id),
    venueId: String(session.venue_id),
    subtotalCents: subtotal,
    serviceChargeBps: 0,
    serviceChargeCents: serviceCharge,
    tipCents: tip,
    buyer,
    userId,
  });
}

function mapTabRpcError(message: string): Response {
  if (message.includes("not_authorized")) {
    return jsonResponse({ error: "not_authorized" }, 403);
  }
  if (message.includes("tab_not_open")) return fail("tab_not_open");
  if (message.includes("tab_has_mingla_orders")) return fail("transition_not_allowed");
  if (message.includes("invalid_settlement_method")) return fail("invalid_json");
  if (message.includes("session_not_found")) {
    return jsonResponse({ error: "not_found" }, 404);
  }
  console.error("[venue-order-staff] tab rpc failed", message);
  return fail("internal_error");
}
