// ===========================================================================
// Issue #1790 + #1791 (SPEC #1788 P-26, P-2a, P-15, P-16) — venue-order-staff:
// the STAFF order path, the SETTLEMENT paths, and the Orders queue's mutations.
//
// Phase 2 (#1790) shipped the money-bearing actions:
//   create      — the waiter's order pad (same spots, same menu, same modifiers,
//                 same SERVER-SIDE pricing as the guest path; not one number is
//                 computed differently).
//   settle      — { bill_to_phone | venue_collected } for ONE order.
//   tab_open    — open a staff tab on a sitting.
//   tab_close   — { bill_to_phone | venue_collected } for a whole tab (P-2a).
//
// Phase 3 (#1791) adds the queue's mutations, all of which run as the CALLING
// USER because each RPC behind them reads auth.uid() and enforces its own rank:
//   transition           — the ack state machine. `acknowledged` writes a human
//                          user id taken from the JWT, never from the body.
//   refund_decision      — the venue's approve-or-explain on a guest request.
//   item_availability    — one-tap 86 from the queue (same write as the menu).
//   pause                — the venue's OWN pause switch (D-7b). Mingla never
//                          writes it for them.
//   set_ordering_enabled — ruling OQ-7's gate: the ONLY route to
//                          ordering_enabled = true, shipped with the queue that
//                          watches what it lets in.
//
// verify_jwt = false with a Bearer REQUIRED IN-CODE (the §S6 table): the token is
// verified via auth.getUser, then the brand-membership floor is checked, and the
// rank-gated mutations enforce their own floor INSIDE the SECURITY DEFINER RPC
// (biz_venue_tab_open / biz_venue_tab_close require >= event_manager).
//
// Phase 3b (#1792) builds the surface a waiter actually touches, and hardens the
// four Phase-2 actions against what a real service does to them:
//   create   — gains `mode: "preview"` (the pad's running total is a SERVER
//              number, P-20), a checked `sessionId` (a foreign or closed sitting
//              is refused, not silently joined), and replay safety (a double-tap
//              at the pass returns the ticket that already exists).
//   settle   — refuses a round that belongs to an OPEN tab. A tab settles as a
//              tab; settling one round of one would bill it twice.
//   metadata — every write MERGES. `metadata.tab_settlement` is read by three
//              separate mechanisms and PostgREST jsonb writes replace the whole
//              column; the one line that forgot is the reason a tab could never
//              close (see billToPhone below).
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
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "../_shared/businessWebOrigin.ts";
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
  assertSessionAcceptsRound,
  findReplayableVenueOrder,
  insertVenueOrderRow,
  loadMenuSnapshot,
  markVenueOrderFailed,
  mergedVenueOrderMetadata,
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
    // ---- Issue #1791 (Phase 3) — the QUEUE's mutations. -------------------
    case "transition":
      return await handleTransition(req, body);
    case "refund_decision":
      return await handleRefundDecision(req, body);
    case "item_availability":
      return await handleItemAvailability(req, body);
    case "pause":
      return await handlePause(req, body);
    case "set_ordering_enabled":
      return await handleSetOrderingEnabled(req, body);
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

  // Issue #1792 — `preview` is how the pad shows a running total. P-20 says the
  // client never does money math, and a waiter still needs to read the table
  // what they are about to send, so the number comes back from HERE, priced by
  // the same `priceCart` the real create uses. Nothing is written and no
  // provider is touched: the two paths share one arithmetic by construction,
  // which is the only way a preview can be trusted.
  const previewOnly = body.mode === "preview";

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

  if (previewOnly) {
    // Priced, not persisted. The pad renders these numbers verbatim; it never
    // adds anything up itself. `serviceChargeLabel` rides along because D-9's
    // rule is that the venue's own charge is ALWAYS its own visible line, and a
    // label the surface invents is a different promise from the one configured.
    return jsonResponse({
      kind: "staff_order_preview",
      currency: cart.currency,
      subtotalCents: cart.subtotalCents,
      serviceChargeBps: ctx.settings.service_charge_bps,
      serviceChargeCents,
      serviceChargeLabel: ctx.settings.service_charge_label,
      totalCents: cart.subtotalCents + serviceChargeCents,
      spotLabel: ctx.spotLabel,
      venueName: ctx.venueName,
      staffTabsEnabled: ctx.settings.staff_tabs_enabled === true,
      lines: cart.lines.map((line) => ({
        lineNo: line.lineNo,
        menuItemId: line.menuItemId,
        name: line.itemNameAtOrder,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        modifiersTotalCents: line.modifiersTotalCents,
        lineTotalCents: line.lineTotalCents,
        modifiers: line.modifiers.map((m) => m.modifierNameAtOrder),
        notes: line.notes,
      })),
    });
  }

  if (ctx.spotId === null && buyerName.length < 2) {
    return fail("buyer_name_required");
  }

  // Issue #1792 — a waiter's second round joins the first, so the pad sends the
  // sitting's id back. It is checked, not trusted: a foreign session would
  // silently fold this round into a stranger's tab, and a CLOSED tab would take
  // a round nobody will ever be billed for.
  if (sessionId !== null) {
    const addable = await assertSessionAcceptsRound(supabase, {
      sessionId,
      brandId: ctx.brandId,
      venueId: ctx.servingVenueId,
    });
    if (!addable.ok) return fail(addable.code);
  }

  // Issue #1792 — a double-tap on "Send to kitchen" at a busy pass, or a retry
  // over a hotel wifi that dropped the response, must not fire two tickets. The
  // pad mints one key per gesture; a replay returns the ticket that already
  // exists. Tenant-scoped like every other read of this column (#1819 H-2).
  if (idempotencyKey !== null) {
    const existing = await findReplayableVenueOrder(supabase, {
      brandId: ctx.brandId,
      venueId: ctx.servingVenueId,
      idempotencyKey,
    });
    if (existing !== null) {
      return jsonResponse({
        kind: "staff_order_created",
        orderId: existing.id,
        sessionId: existing.session_id,
        replayed: true,
        currency: existing.currency,
        totalCents: existing.total_cents,
      });
    }
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

  // Issue #1792 — ONE round of an OPEN tab may not be settled on its own.
  // `biz_venue_tab_close` bills every pending venue_collected round of the
  // sitting; a round already settled here would be billed a second time, and a
  // round moved onto the Mingla rail here would trip `tab_has_mingla_orders` and
  // wedge the tab shut. A tab settles as a tab. The pad says so, and so does
  // this, because the pad is not the only caller this function will ever have.
  const { data: session } = await supabase
    .from("venue_order_sessions")
    .select("tab_state")
    .eq("id", String(order.session_id))
    .maybeSingle();
  const tabState = String(
    (session as { tab_state?: string } | null)?.tab_state ?? "none",
  );
  if (tabState === "open" || tabState === "settling") {
    return fail("order_on_open_tab");
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
        metadata: await mergedVenueOrderMetadata(supabase, orderId, {
          settlement_method: "venue_collected",
        }),
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
      // Issue #1792 — MERGED, never replaced. This single line used to erase
      // `metadata.tab_settlement` from the settlement order it had just been
      // written onto, which meant `pg_venue_order_finalize_payment` never
      // recognised the paid bill as a tab close: the tab stayed at `settling`
      // forever, its rounds stayed `pending` forever, a retried close raised
      // `tab_has_mingla_orders`, and Phase 6 would have counted the tab twice.
      // A `BEFORE UPDATE` trigger now carries the same promise independently
      // (20270318001792).
      metadata: await mergedVenueOrderMetadata(supabase, input.orderId, {
        settlement_method: "bill_to_phone",
      }),
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
    try {
      const init = await paystackInitializeTransaction({
        email: buyerEmail,
        amountSubunits: money.totalCents,
        currency: "NGN",
        reference,
        callbackUrl: `${PRODUCTION_BUSINESS_WEB_ORIGIN}/o/venue/${
          encodeURIComponent(input.orderId)
        }?bst=${
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
  if (message.includes("staff_tabs_disabled")) return fail("staff_tabs_disabled");
  if (message.includes("tab_not_open")) return fail("tab_not_open");
  // Issue #1792 — a bill already out on the guest's phone is its own answer,
  // not "that order has moved on": the venue has to finish it or let it lapse
  // before taking cash, and the copy has to say which.
  if (message.includes("tab_bill_already_sent")) return fail("tab_bill_already_sent");
  if (message.includes("tab_has_mingla_orders")) return fail("transition_not_allowed");
  if (message.includes("invalid_settlement_method")) return fail("invalid_json");
  if (message.includes("session_not_found")) {
    return jsonResponse({ error: "not_found" }, 404);
  }
  console.error("[venue-order-staff] tab rpc failed", message);
  return fail("internal_error");
}

// ===========================================================================
// Issue #1791 (SPEC #1788 P-26, P-15, P-16; rulings OQ-4, OQ-7) — the Orders
// queue's mutations. Every one of them runs as the CALLING USER
// (`userClient(req)`) rather than as service_role, because every one of the
// RPCs behind them reads `auth.uid()` and enforces its own rank floor inside
// the database. Calling them with the service key would hand the database a
// caller with no identity and no rank — and, for `transition`, would make the
// human tap unattributable, which is the whole point of the ack contract.
// ===========================================================================

/** The five states a human may drive an order into (P-26). */
const TRANSITION_TARGETS = [
  "acknowledged",
  "in_progress",
  "ready",
  "delivered",
  "cancelled",
] as const;

function mapQueueRpcError(message: string): Response {
  if (message.includes("not_authorized")) {
    return jsonResponse({ error: "not_authorized" }, 403);
  }
  if (message.includes("transition_not_allowed")) return fail("transition_not_allowed");
  if (message.includes("refund_window_closed")) return fail("refund_window_closed");
  if (message.includes("venue_not_orderable")) return fail("venue_not_orderable");
  // Issue #1846 C-1 — the two refusals that stop a double refund. Both are
  // states a second manager can genuinely walk into a second later, so they
  // get the honest sentence rather than "Something went wrong": an operator
  // who is told nothing taps again, and tapping again is how the double
  // happened in the first place.
  if (message.includes("already_refunded")) {
    return jsonResponse({
      error: "already_refunded",
      message: "This order has already been refunded — the guest has their money.",
    }, 409);
  }
  if (message.includes("no_refund_requested")) {
    return jsonResponse({
      error: "no_refund_requested",
      message: "Nobody has asked for a refund on this order.",
    }, 409);
  }
  if (
    message.includes("order_not_found") || message.includes("venue_not_found")
  ) {
    return jsonResponse({ error: "not_found" }, 404);
  }
  if (
    message.includes("invalid_decision") ||
    message.includes("decline_reason_required") ||
    message.includes("paused_required") ||
    message.includes("enabled_required")
  ) {
    return jsonResponse({
      error: "invalid_request",
      message: message.includes("decline_reason_required")
        ? "Tell the guest why — they read this."
        : venueOrderErrorCopy("invalid_json", "staff"),
    }, 400);
  }
  console.error("[venue-order-staff] queue rpc failed", message);
  return fail("internal_error");
}

/**
 * ACK / ADVANCE. `to: "acknowledged"` is the ONLY way an order gets an
 * `acknowledged_at`, and the user id on the row comes from the verified JWT
 * inside the RPC — never from this request body. A render can therefore never
 * imply that somebody saw a ticket (I-PROPOSED-1767-ACK-IS-A-HUMAN-TAP).
 */
async function handleTransition(
  req: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  const orderId = typeof body.orderId === "string" && UUID_RE.test(body.orderId)
    ? body.orderId
    : null;
  const to = typeof body.to === "string" ? body.to : "";
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 280) : null;
  if (orderId === null) return jsonResponse({ error: "not_found" }, 404);
  if (!(TRANSITION_TARGETS as readonly string[]).includes(to)) {
    return fail("transition_not_allowed");
  }

  const asUser = userClient(req);
  const { data, error } = await asUser.rpc("biz_venue_order_transition", {
    p_order_id: orderId,
    p_to: to,
    p_reason: reason,
  });
  if (error) return mapQueueRpcError(error.message);
  return jsonResponse({ kind: "transitioned", ...(data as Record<string, unknown>) });
}

/**
 * The venue's approve-or-explain decision on a guest refund request (P-25).
 * Approve mints the `source_refunds` row on the shipped rail; decline records
 * the reason the guest will read. Either way a PERSON decided.
 */
async function handleRefundDecision(
  req: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  const orderId = typeof body.orderId === "string" && UUID_RE.test(body.orderId)
    ? body.orderId
    : null;
  const decision = body.decision === "approved" || body.decision === "declined"
    ? body.decision
    : null;
  const note = typeof body.note === "string" ? body.note.slice(0, 280) : null;
  if (orderId === null) return jsonResponse({ error: "not_found" }, 404);
  if (decision === null) return jsonResponse({ error: "invalid_request" }, 400);

  const asUser = userClient(req);
  const { data, error } = await asUser.rpc("biz_venue_order_refund_decision", {
    p_order_id: orderId,
    p_decision: decision,
    p_note: note,
  });
  if (error) return mapQueueRpcError(error.message);
  return jsonResponse({ kind: "refund_decided", ...(data as Record<string, unknown>) });
}

/**
 * One-tap 86 from the QUEUE (P-15/P-26). Identical RLS floor to the menu
 * builder's row toggle — this is the same write, reachable from where the
 * person actually is when the kitchen runs out.
 */
async function handleItemAvailability(
  req: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  const menuItemId = typeof body.menuItemId === "string" && UUID_RE.test(body.menuItemId)
    ? body.menuItemId
    : null;
  const isAvailable = typeof body.isAvailable === "boolean" ? body.isAvailable : null;
  if (menuItemId === null) return jsonResponse({ error: "not_found" }, 404);
  if (isAvailable === null) return jsonResponse({ error: "invalid_request" }, 400);

  const asUser = userClient(req);
  const { data, error } = await asUser
    .from("menu_items")
    .update({ is_available: isAvailable })
    .eq("id", menuItemId)
    .select("id, is_available");
  if (error) return mapQueueRpcError(error.message);
  // RLS returns zero rows rather than an error when the caller lacks the write
  // grant. Reporting that as success would be the RLS-RETURNING-OWNER-GAP.
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length !== 1) return jsonResponse({ error: "not_authorized" }, 403);
  return jsonResponse({
    kind: "item_availability_set",
    menuItemId,
    isAvailable: rows[0].is_available === true,
  });
}

/**
 * D-7b — the venue's OWN pause switch, and the only writer of
 * `venue_ordering_settings.paused_at` in the system. Mingla never pauses a
 * venue's ordering for them: a slow venue is a service problem for that venue
 * to answer, not a reason for the platform to switch off their takings.
 */
async function handlePause(
  req: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  const venueId = typeof body.venueId === "string" && UUID_RE.test(body.venueId)
    ? body.venueId
    : null;
  const paused = typeof body.paused === "boolean" ? body.paused : null;
  if (venueId === null) return jsonResponse({ error: "not_found" }, 404);
  if (paused === null) return jsonResponse({ error: "invalid_request" }, 400);

  const asUser = userClient(req);
  const { data, error } = await asUser.rpc("biz_venue_ordering_pause", {
    p_venue_id: venueId,
    p_paused: paused,
  });
  if (error) return mapQueueRpcError(error.message);
  return jsonResponse({ kind: "pause_set", ...(data as Record<string, unknown>) });
}

/**
 * Ruling OQ-7 — the Phase-3 -> Phase-4 gate. This is the only route to
 * `ordering_enabled = true` anywhere in the product, and it ships in the same
 * change as the queue that watches the orders it lets in. Before this, no code
 * path existed to switch a venue on: money could not arrive unwatched by
 * absence, not by policy.
 */
async function handleSetOrderingEnabled(
  req: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  const venueId = typeof body.venueId === "string" && UUID_RE.test(body.venueId)
    ? body.venueId
    : null;
  const enabled = typeof body.enabled === "boolean" ? body.enabled : null;
  if (venueId === null) return jsonResponse({ error: "not_found" }, 404);
  if (enabled === null) return jsonResponse({ error: "invalid_request" }, 400);

  const asUser = userClient(req);
  const { data, error } = await asUser.rpc("biz_venue_ordering_set_enabled", {
    p_venue_id: venueId,
    p_enabled: enabled,
  });
  if (error) return mapQueueRpcError(error.message);
  return jsonResponse({ kind: "ordering_enabled_set", ...(data as Record<string, unknown>) });
}
