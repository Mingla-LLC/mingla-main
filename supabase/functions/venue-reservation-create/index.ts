// ===========================================================================
// META-ORCH-1148 sub-ORCH 2.2a — venue-reservation-create
// ---------------------------------------------------------------------------
// The SINGLE guest reservation write path, mirroring ticket-checkout-create's
// shape (SPEC §4.B). Serves BOTH an authenticated app user AND an anonymous web
// guest (verify_jwt = false; auth is OPTIONAL via userIdFromAuthHeader, exactly
// like ticket-checkout-create). It NEVER hand-rolls fee/tax math — it imports
// the shared all-in engine (Constitution #2 / the no-buyer-tax-form gate).
//
//   FREE path  → mint the reservations row directly via pg_create_guest_reservation
//                (service-role) → return { kind: "free_completed", ... }.
//   FEE path   → ride the shared all-in engine to compute the UPFRONT charge →
//                write a reservation_checkout_sessions row (status 'pending') →
//                native: create a PaymentIntent on the connected account →
//                { kind: "requires_payment", ... }; web: create a hosted Stripe
//                Checkout Session → { kind: "requires_web_redirect", ... };
//                NG: Paystack arm → { kind: "requires_paystack_redirect", ... }.
//                The reservations row is minted on payment SUCCESS by
//                venue-reservation-confirm (the atomicity contract: no charge
//                without a session record to flip; no confirmed reservation
//                without a verified charge).
//
// Fee model = CHARGE UPFRONT, forfeit after cutoff (DECISIONS LOCKED). The
// cancel-before-cutoff → refund seam reuses refund-order (wired in 2.2b/2.2c);
// the policy fields (cancel_cutoff_hours / fee_refundable) live on
// venue_reservation_settings and thread onto the row at confirm.
//
// Deploy from MERGED origin/main ONLY (COMMS-0015). verify_jwt = false
// (config.toml registration is added on deploy by the orchestrator).
// ===========================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { wrapEdgeHandler } from "../_shared/structuredLog.ts";
import { STRIPE_API_VERSION, stripeTicketCheckout } from "../_shared/stripe.ts";
import { getPaymentMethodTypes } from "../_shared/stripePaymentMethods.ts";
import {
  cancelPaymentIntentIfClientAvailable,
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
// SHARED all-in money engine — the SINGLE owner of fee/tax math (never forked).
import {
  buildPricingBreakdown,
  computeBuyerSubtotal,
  computeConfigVat,
  inclusiveVatDivisorForRegion,
  MINGLA_SERVICE_FEE_BPS,
  taxBehaviorForRegion,
  type ComputeAllInInput,
  type PricingBreakdown,
  type PricingRegion,
  type PricingSwitches,
  type TaxBasis,
} from "../_shared/allInPricingEngine.ts";
// META-ORCH-1076 Paystack routing — same provider-neutral arm ticket-checkout
// uses; activates only for NG/paystack brands (no NEW Paystack work — reuse).
import {
  paystackChannelsForCountry,
  resolveProviderRouting,
} from "../_shared/paymentProvider.ts";
import { paystackInitializeTransaction } from "../_shared/paystack.ts";

type ReserveSurface = "native" | "web";

interface BrandPricingRow {
  pass_tax: boolean;
  pass_mingla_fee: boolean;
  pass_service_fee: boolean;
  pricing_region: string | null;
  pricing_currency: string | null;
  effective_take_rate_bps: number;
  take_rate_source: "brand_override" | "platform_default";
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean | null;
  payment_provider: string | null;
  payment_country: string | null;
  paystack_subaccount_code: string | null;
  vat_rate_bps: number | null;
}

interface ReservationSettingsRow {
  reservations_enabled: boolean;
  fee_enabled: boolean;
  fee_amount_cents: number | null;
  fee_currency: string | null;
  fee_refundable: boolean;
  cancel_cutoff_hours: number;
  no_show_fee_policy: string;
}

const ENABLED_PRICING_REGIONS = ["GB", "US", "EU", "CH"] as const;

serve(wrapEdgeHandler("venue-reservation-create", async (req) => {
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
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  // ── Input validation (mirror ticket-checkout-create's buyer gates) ──────────
  const brandId = typeof body.brandId === "string" ? body.brandId : "";
  const surface: ReserveSurface = body.surface === "web" ? "web" : "native";
  const reservedForUtc = typeof body.reservedForUtc === "string"
    ? body.reservedForUtc
    : "";
  const partySize = Number.isInteger(body.partySize)
    ? Number(body.partySize)
    : NaN;
  const buyer = (body.buyer ?? {}) as Record<string, unknown>;
  const buyerName = typeof buyer.name === "string" ? buyer.name.trim() : "";
  const buyerEmail = typeof buyer.email === "string"
    ? buyer.email.trim().toLowerCase()
    : "";
  const buyerPhoneE164 = normalizePhoneE164(buyer.phone);
  const marketingOptIn = buyer.marketingOptIn === true;
  const occasion = typeof body.occasion === "string" && body.occasion.trim()
    ? body.occasion.trim()
    : null;
  const guestNotes = typeof body.guestNotes === "string" && body.guestNotes.trim()
    ? body.guestNotes.trim()
    : null;

  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(brandId)) {
    return jsonResponse({ error: "brand_id_required" }, 400);
  }
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 100) {
    return jsonResponse({ error: "party_size_invalid" }, 400);
  }
  if (buyerName.length < 2) {
    return jsonResponse({ error: "buyer_name_required" }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    return jsonResponse({ error: "buyer_email_invalid" }, 400);
  }
  if (buyerPhoneE164 === null) {
    return jsonResponse({ error: "buyer_phone_required" }, 400);
  }
  const reservedForMs = Date.parse(reservedForUtc);
  if (Number.isNaN(reservedForMs)) {
    return jsonResponse({ error: "reserved_for_invalid" }, 400);
  }
  if (reservedForMs <= Date.now()) {
    return jsonResponse({ error: "reserved_for_in_past" }, 400);
  }
  const reservedForIso = new Date(reservedForMs).toISOString();

  const userId = await userIdFromAuthHeader(req);
  // app (authed) → consumer + consumer_user_id; anon web → guest.
  const createdVia: "consumer" | "guest" = userId ? "consumer" : "guest";
  const reservationSource = surface === "web" ? "website" : "mingla";
  const supabase = serviceClient();

  // ── (1) The venue must be reservable. ───────────────────────────────────────
  const { data: settingsRows, error: settingsErr } = await supabase
    .from("venue_reservation_settings")
    .select(
      "reservations_enabled, fee_enabled, fee_amount_cents, fee_currency, fee_refundable, cancel_cutoff_hours, no_show_fee_policy",
    )
    .eq("brand_id", brandId)
    .maybeSingle();
  if (settingsErr !== null) {
    console.error("[venue-reservation-create] settings lookup failed", settingsErr);
    return jsonResponse(
      { error: "venue_lookup_failed", detail: settingsErr.message },
      500,
    );
  }
  const settings = settingsRows as ReservationSettingsRow | null;
  if (settings === null || settings.reservations_enabled !== true) {
    return jsonResponse({ error: "venue_not_reservable" }, 409);
  }

  // ── (2) Re-validate the slot against the engine (anti-double-book). ──────────
  // The reserved instant must be a currently-available, non-full slot for this
  // party. The engine only emits slots a reservable table can seat → this also
  // covers party_fit. (The DB writer re-validates again under an advisory lock
  // at INSERT time; this is the early 409 so the buyer never proceeds to pay
  // for an unavailable slot.) We pass the venue-local date; the engine derives
  // the IANA tz. To avoid a tz round-trip here we ask the engine for the date
  // of the instant in BOTH the UTC-day and ±1 to catch the local-date boundary.
  const slotOk = await reservedSlotIsAvailable(
    supabase,
    brandId,
    reservedForIso,
    partySize,
  );
  if (!slotOk) {
    return jsonResponse({ error: "slot_unavailable" }, 409);
  }

  // ── (3) Evaluate the deposit_threshold capacity rule (fee may be REQUIRED). ──
  const { data: ruleRows } = await supabase
    .from("venue_capacity_rules")
    .select("kind, params, is_active")
    .eq("brand_id", brandId)
    .eq("is_active", true)
    .eq("kind", "deposit_threshold");
  let depositRuleAmountCents: number | null = null;
  let depositRequired = false;
  for (const r of (ruleRows ?? []) as Array<Record<string, unknown>>) {
    const params = (r.params ?? {}) as Record<string, unknown>;
    const minParty = Number(params.min_party_for_fee ?? 1);
    if (Number.isFinite(minParty) && minParty <= partySize) {
      depositRequired = true;
      const amt = Number(params.fee_cents ?? params.amount_cents ?? NaN);
      if (Number.isFinite(amt) && amt > 0) {
        depositRuleAmountCents = Math.round(amt);
      }
    }
  }

  // The effective fee: a configured reservation fee, OR a deposit-threshold fee.
  const settingsFeeCents = settings.fee_enabled && (settings.fee_amount_cents ?? 0) > 0
    ? Number(settings.fee_amount_cents)
    : 0;
  const baseFeeCents = depositRequired
    ? (depositRuleAmountCents ?? settingsFeeCents)
    : settingsFeeCents;
  const hasFee = baseFeeCents > 0;

  // A deposit is required but no fee amount is configured anywhere → misconfig.
  if (depositRequired && baseFeeCents <= 0) {
    return jsonResponse({ error: "deposit_amount_unconfigured" }, 409);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FREE PATH — no fee, no deposit threshold. Mint the reservation directly.
  // ════════════════════════════════════════════════════════════════════════════
  if (!hasFee) {
    const guestCancelToken = surface === "web" ? randomBuyerStatusToken() : null;
    const { data: created, error: createErr } = await supabase.rpc(
      "pg_create_guest_reservation",
      {
        p_brand_id: brandId,
        p_reserved_for: reservedForIso,
        p_party_size: partySize,
        p_source: reservationSource,
        p_created_via: createdVia,
        p_consumer_user_id: userId ?? null,
        p_guest_name: buyerName,
        p_guest_phone_e164: buyerPhoneE164,
        p_guest_email: buyerEmail,
        p_fee_cents: null,
        p_fee_currency: null,
        p_payment_intent_id: null,
        p_payment_status: "none",
        p_guest_cancel_token: guestCancelToken,
        p_occasion: occasion,
        p_guest_notes: guestNotes,
        p_status: "confirmed",
      },
    );
    if (createErr !== null || !created) {
      return classifyRpcError(createErr, "free reservation create");
    }
    const row = (Array.isArray(created) ? created[0] : created) as
      Record<string, unknown>;
    const reservationId = String(row.id ?? "");
    return jsonResponse({
      kind: "free_completed",
      reservationId,
      reservedForUtc: reservedForIso,
      partySize,
      brandId,
      guestCancelToken: guestCancelToken ?? undefined,
      receiptUrl: reservationId ? `/o/${reservationId}` : undefined,
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FEE PATH — ride the SHARED all-in engine, charge UPFRONT.
  // ════════════════════════════════════════════════════════════════════════════
  const { data: pricingRows, error: pricingErr } = await supabase.rpc(
    "resolve_brand_pricing_inputs",
    { p_brand_id: brandId },
  );
  if (pricingErr !== null || !Array.isArray(pricingRows) || pricingRows.length === 0) {
    console.error("[venue-reservation-create] resolve_brand_pricing_inputs failed", pricingErr);
    return jsonResponse(
      { error: "pricing_config_unavailable", detail: pricingErr?.message },
      409,
    );
  }
  const pricing = pricingRows[0] as BrandPricingRow;

  const settlementCurrencyRaw = typeof pricing.pricing_currency === "string"
    ? pricing.pricing_currency.trim()
    : "";
  if (settlementCurrencyRaw.length === 0) {
    return jsonResponse(
      { error: "pricing_config_unavailable", detail: "pricing_currency_missing" },
      409,
    );
  }
  const currency = settlementCurrencyRaw.toLowerCase();

  const providerRouting = resolveProviderRouting({
    payment_provider: pricing.payment_provider,
    payment_country: pricing.payment_country,
    pricing_currency: pricing.pricing_currency,
  });

  const buyerStatusToken = randomBuyerStatusToken();
  const guestCancelToken = surface === "web" ? randomBuyerStatusToken() : null;

  // ── PAYSTACK ARM (NG) — same provider-neutral reuse as ticket-checkout. ──────
  if (providerRouting.provider === "paystack") {
    const psCurrency = (providerRouting.currency || "NGN").toUpperCase();
    if (psCurrency !== "NGN") {
      return jsonResponse(
        { error: "pricing_config_unavailable", detail: "paystack_currency_must_be_ngn" },
        409,
      );
    }
    if (!pricing.paystack_subaccount_code) {
      // a fee venue on Paystack with no payout subaccount is not charge-ready.
      return jsonResponse({ error: "stripe_account_not_ready" }, 409);
    }
    const psSwitches: PricingSwitches = {
      pass_tax: pricing.pass_tax,
      pass_mingla_fee: pricing.pass_mingla_fee,
      pass_service_fee: pricing.pass_service_fee,
    };
    const psEngineInput: ComputeAllInInput = {
      baseCents: baseFeeCents,
      switches: psSwitches,
      region: "NG",
      currency: "NGN",
      effectiveTakeRateBps: pricing.effective_take_rate_bps,
      takeRateSource: pricing.take_rate_source,
      serviceFeeBps: MINGLA_SERVICE_FEE_BPS,
    };
    const psSubtotal = computeBuyerSubtotal(psEngineInput);
    const { taxCents: psTaxCents, buyerTotalCents: psBuyerTotalCents } =
      computeConfigVat(
        psSubtotal.buyerSubtotalCents,
        pricing.vat_rate_bps ?? 0,
        psSwitches.pass_tax,
      );
    const psBreakdown: PricingBreakdown = buildPricingBreakdown({
      input: psEngineInput,
      amountTotalCents: psBuyerTotalCents,
      taxCents: psTaxCents,
      taxBasis: "config_vat",
      stripeTaxCalculationId: null,
    });

    const sessionId = await insertReservationSession(supabase, {
      brandId,
      reservedForIso,
      partySize,
      buyerName,
      buyerEmail,
      buyerPhoneE164,
      occasion,
      guestNotes,
      marketingOptIn,
      amountCents: psBuyerTotalCents,
      currency: "NGN",
      createdVia: surface === "web" ? "web" : "app",
      consumerUserId: userId,
      guestCancelToken,
      buyerStatusTokenHash: await sha256Hex(buyerStatusToken),
    });
    if (sessionId === null) {
      return jsonResponse({ error: "reservation_session_failed" }, 500);
    }

    const psReference = `mingla_resv_${sessionId}_${Date.now().toString(36)}`;
    await supabase
      .from("reservation_checkout_sessions")
      .update({ paystack_reference: psReference, updated_at: new Date().toISOString() })
      .eq("id", sessionId);

    const callbackBase = Deno.env.get("PAYSTACK_CALLBACK_BASE") ??
      "https://business.usemingla.com/pay/callback";
    const callbackUrl =
      `${callbackBase}?rcs=${encodeURIComponent(sessionId)}&bst=${encodeURIComponent(buyerStatusToken)}`;

    let psInit: { authorization_url: string; reference: string };
    try {
      psInit = await paystackInitializeTransaction({
        email: buyerEmail,
        amountSubunits: psBuyerTotalCents,
        currency: "NGN",
        reference: psReference,
        callbackUrl,
        channels: paystackChannelsForCountry("NG"),
        metadata: {
          mingla_reservation_session_id: sessionId,
          mingla_brand_id: brandId,
          mingla_buyer_email: buyerEmail,
        },
        subaccount: pricing.paystack_subaccount_code,
        transactionChargeSubunits: psSubtotal.miglaFeeCents,
      });
    } catch (err) {
      await failReservationSession(supabase, sessionId, String((err as Error)?.message ?? err));
      return jsonResponse(
        { error: "paystack_initialize_failed", detail: String((err as Error)?.message ?? err) },
        502,
      );
    }
    return jsonResponse({
      kind: "requires_paystack_redirect",
      reservationDraftId: sessionId,
      buyerStatusToken,
      authorizationUrl: psInit.authorization_url,
      reference: psInit.reference,
      totalCents: psBuyerTotalCents,
      currency: "NGN",
      pricingBreakdown: psBreakdown,
      guestCancelToken: guestCancelToken ?? undefined,
    });
  }

  // ── STRIPE ARM — charge-readiness gate (ORCH-1073 lineage). ──────────────────
  const stripeAccountId = pricing.stripe_account_id;
  if (!stripeAccountId || pricing.stripe_charges_enabled !== true) {
    return jsonResponse({ error: "stripe_account_not_ready" }, 409);
  }

  // region behavior (no buyer tax form — venue-sourced via the brand region).
  const rawRegion = typeof pricing.pricing_region === "string"
    ? pricing.pricing_region.trim().toUpperCase()
    : "";
  const regionIsEnabled =
    (ENABLED_PRICING_REGIONS as readonly string[]).includes(rawRegion);
  const pricingRegion = (regionIsEnabled ? rawRegion : "GB") as PricingRegion;
  const regionUnmappedForceFlatAbsorb = !regionIsEnabled;

  const pricingSwitches: PricingSwitches = {
    pass_tax: pricing.pass_tax,
    pass_mingla_fee: pricing.pass_mingla_fee,
    pass_service_fee: pricing.pass_service_fee,
  };
  const engineInput: ComputeAllInInput = {
    baseCents: baseFeeCents,
    switches: pricingSwitches,
    region: pricingRegion,
    currency,
    effectiveTakeRateBps: pricing.effective_take_rate_bps,
    takeRateSource: pricing.take_rate_source,
    serviceFeeBps: MINGLA_SERVICE_FEE_BPS,
  };
  const buyerSubtotal = computeBuyerSubtotal(engineInput);
  const applicationFeeAmountCents = buyerSubtotal.miglaFeeCents;

  // Tax: the reservation has no venue_tax_address (that lives on events). We
  // degrade to flat-absorb (one clean number, NO buyer tax form) UNLESS the
  // brand passes tax in an enabled region — in which case the inclusive VAT is
  // re-derived deterministically from the region divisor (the buyer is never
  // asked for an address; the basis is the venue's own region). This is the
  // WYSIWYP all-in.
  const taxBehavior = taxBehaviorForRegion(pricingRegion);
  let taxBasis: TaxBasis = "unresolved_flat_absorb";
  let amountTotalCents = buyerSubtotal.buyerSubtotalCents;
  let taxCents = 0;
  if (pricing.pass_tax && !regionUnmappedForceFlatAbsorb && taxBehavior === "inclusive") {
    // inclusive region (GB/EU/CH): the VAT is inside the subtotal; extract the
    // display portion via the region divisor (the engine owns the amount math).
    const divisor = inclusiveVatDivisorForRegion(pricingRegion);
    taxCents = buyerSubtotal.buyerSubtotalCents -
      Math.round(buyerSubtotal.buyerSubtotalCents / divisor);
    taxBasis = "venue_resolved";
    amountTotalCents = buyerSubtotal.buyerSubtotalCents;
  }
  const pricingBreakdown: PricingBreakdown = buildPricingBreakdown({
    input: engineInput,
    amountTotalCents,
    taxCents,
    taxBasis,
    stripeTaxCalculationId: null,
  });
  const totalCents = pricingBreakdown.buyer_total_cents;

  // Persist the in-flight session FIRST (the durable charge record).
  const sessionId = await insertReservationSession(supabase, {
    brandId,
    reservedForIso,
    partySize,
    buyerName,
    buyerEmail,
    buyerPhoneE164,
    occasion,
    guestNotes,
    marketingOptIn,
    amountCents: totalCents,
    currency,
    createdVia: surface === "web" ? "web" : "app",
    consumerUserId: userId,
    guestCancelToken,
    buyerStatusTokenHash: await sha256Hex(buyerStatusToken),
    stripeAccountId,
  });
  if (sessionId === null) {
    return jsonResponse({ error: "reservation_session_failed" }, 500);
  }

  // ── WEB → hosted Stripe Checkout Session. ────────────────────────────────────
  if (surface === "web") {
    const baseUrl = Deno.env.get("MINGLA_PUBLIC_WEB_BASE_URL");
    if (!baseUrl || !/^https:\/\/[^\s]+$/.test(baseUrl)) {
      return jsonResponse({ error: "web_base_url_missing" }, 500);
    }
    const successUrl =
      `${baseUrl}/reserve/${brandId}/confirm?cs={CHECKOUT_SESSION_ID}&rcs=${sessionId}&bst=${buyerStatusToken}`;
    const cancelUrl = `${baseUrl}/reserve/${brandId}`;
    let checkoutSession: { id: string; url: string | null };
    try {
      const stripeWeb = stripeTicketCheckout();
      const piData: Record<string, unknown> = {
        metadata: {
          mingla_reservation_session_id: sessionId,
          mingla_brand_id: brandId,
          mingla_buyer_email: buyerEmail,
        },
        statement_descriptor_suffix: "MINGLA",
      };
      if (applicationFeeAmountCents > 0) {
        piData.application_fee_amount = applicationFeeAmountCents;
      }
      // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
      checkoutSession = await stripeWeb.checkout.sessions.create(
        {
          mode: "payment",
          currency,
          line_items: [
            {
              price_data: {
                currency,
                unit_amount: buyerSubtotal.buyerSubtotalCents,
                product_data: { name: "Reservation deposit" },
              },
              quantity: 1,
            },
          ],
          payment_intent_data: piData,
          automatic_tax: { enabled: true },
          customer_email: buyerEmail,
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            mingla_reservation_session_id: sessionId,
            mingla_brand_id: brandId,
          },
        },
        {
          idempotencyKey: `venue_reservation_web:${sessionId}`,
          stripeAccount: stripeAccountId,
        },
      );
    } catch (err) {
      const failure = classifyStripeCheckoutSessionCreateFailure(err);
      await failReservationSession(supabase, sessionId, failure.detail);
      return jsonResponse(
        { error: "checkout_session_create_failed", detail: failure.detail },
        failure.httpStatus,
      );
    }
    if (!checkoutSession.url) {
      return jsonResponse({ error: "checkout_session_url_missing" }, 502);
    }
    await supabase
      .from("reservation_checkout_sessions")
      .update({
        stripe_checkout_session_id: checkoutSession.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
    return jsonResponse({
      kind: "requires_web_redirect",
      reservationDraftId: sessionId,
      buyerStatusToken,
      hostedCheckoutUrl: checkoutSession.url,
      totalCents,
      currency: currency.toUpperCase(),
      pricingBreakdown,
      guestCancelToken: guestCancelToken ?? undefined,
    });
  }

  // ── NATIVE → PaymentIntent on the connected account + Customer/ephemeral key. ─
  let customerId: string | null = null;
  let customerEphemeralKeySecret: string | null = null;
  try {
    const stripeForCustomer = stripeTicketCheckout();
    // orch-strict-grep-allow stripe-no-idempotency-key — read-only search; idempotency-key on Stripe search calls is rejected by the API.
    const searchResult = await stripeForCustomer.customers.search(
      { query: `email:'${buyerEmail.replace(/'/g, "\\'")}'`, limit: 1 },
      { stripeAccount: stripeAccountId },
    );
    let customer = searchResult.data[0] ?? null;
    if (customer === null) {
      const customerIdemKey =
        `mingla_resv_customer:${stripeAccountId}:${await sha256Hex(buyerEmail)}`;
      customer = await stripeForCustomer.customers.create(
        {
          email: buyerEmail,
          metadata: { mingla_buyer_email: buyerEmail, mingla_origin: "venue_reservation_create_native" },
        },
        { idempotencyKey: customerIdemKey, stripeAccount: stripeAccountId },
      );
    }
    customerId = customer.id;
    const ephemeralKey = await stripeForCustomer.ephemeralKeys.create(
      { customer: customerId },
      {
        apiVersion: STRIPE_API_VERSION,
        stripeAccount: stripeAccountId,
        idempotencyKey: `mingla_resv_ephkey:${stripeAccountId}:${customerId}:${Date.now()}`,
      },
    );
    customerEphemeralKeySecret = String(ephemeralKey.secret ?? "");
    if (customerEphemeralKeySecret.length === 0) {
      customerId = null;
      customerEphemeralKeySecret = null;
    }
  } catch (customerErr) {
    // Full-pay fee: fall back to guest-mode PaymentSheet (ORCH-0844 behavior).
    console.warn(
      "[venue-reservation-create] customer+ephemeralKey creation failed; guest mode",
      customerErr instanceof Error ? customerErr.message : customerErr,
    );
    customerId = null;
    customerEphemeralKeySecret = null;
  }

  let paymentIntent: { id: string; client_secret?: string | null };
  let stripe: ReturnType<typeof stripeTicketCheckout> | null = null;
  try {
    stripe = stripeTicketCheckout();
    const piCreateBody: Record<string, unknown> = {
      amount: totalCents,
      currency,
      payment_method_types: [...getPaymentMethodTypes()],
      metadata: {
        mingla_reservation_session_id: sessionId,
        mingla_brand_id: brandId,
        mingla_buyer_email: buyerEmail,
      },
    };
    if (applicationFeeAmountCents > 0) {
      piCreateBody.application_fee_amount = applicationFeeAmountCents;
    }
    // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
    paymentIntent = await stripe.paymentIntents.create(
      piCreateBody,
      { idempotencyKey: `venue_reservation:${sessionId}`, stripeAccount: stripeAccountId },
    );
  } catch (err) {
    const failure = classifyStripePaymentIntentCreateFailure(err);
    await failReservationSession(supabase, sessionId, failure.detail);
    return jsonResponse(
      { error: "payment_intent_create_failed", detail: failure.detail },
      failure.httpStatus,
    );
  }

  const clientSecret = String(paymentIntent.client_secret ?? "");
  const { error: persistErr } = await supabase
    .from("reservation_checkout_sessions")
    .update({
      stripe_payment_intent_id: paymentIntent.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
  if (persistErr) {
    if (stripe !== null) {
      try {
        await cancelPaymentIntentIfClientAvailable(stripe, paymentIntent.id);
      } catch { /* best-effort */ }
    }
    return jsonResponse({ error: "payment_session_persist_failed", detail: persistErr.message }, 500);
  }

  return jsonResponse({
    kind: "requires_payment",
    reservationDraftId: sessionId,
    buyerStatusToken,
    totalCents,
    currency: currency.toUpperCase(),
    clientSecret,
    paymentIntentId: paymentIntent.id,
    pricingBreakdown,
    publishableKey: Deno.env.get("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY") ??
      Deno.env.get("STRIPE_PUBLISHABLE_KEY") ?? null,
    stripeAccountId,
    customerId,
    customerEphemeralKeySecret,
    guestCancelToken: guestCancelToken ?? undefined,
  });
}, {
  onError: (_err, requestId) =>
    jsonResponse({ error: "internal_error", requestId }, 500),
}));

// ── helpers ──────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function reservedSlotIsAvailable(
  supabase: any,
  brandId: string,
  reservedForIso: string,
  partySize: number,
): Promise<boolean> {
  // The engine takes a venue-LOCAL date; we don't know the venue tz client-side,
  // so probe the UTC date and its neighbours (±1 day) to catch the local-date
  // boundary, then match the exact instant. The DB writer re-validates again
  // under a lock — this is the early reject.
  const baseDate = new Date(reservedForIso);
  const dates = new Set<string>();
  for (const deltaDays of [-1, 0, 1]) {
    const d = new Date(baseDate.getTime() + deltaDays * 86400000);
    dates.add(d.toISOString().slice(0, 10));
  }
  for (const d of dates) {
    const { data, error } = await supabase.rpc("pg_venue_available_slots", {
      p_brand_id: brandId,
      p_date: d,
      p_party_size: partySize,
    });
    if (error !== null || !Array.isArray(data)) continue;
    const target = new Date(reservedForIso).getTime();
    for (const slot of data as Array<Record<string, unknown>>) {
      const slotMs = Date.parse(String(slot.slot_start_utc ?? ""));
      if (
        slotMs === target && slot.is_full === false &&
        Number(slot.remaining ?? 0) > 0
      ) {
        return true;
      }
    }
  }
  return false;
}

interface SessionInsert {
  brandId: string;
  reservedForIso: string;
  partySize: number;
  buyerName: string;
  buyerEmail: string;
  buyerPhoneE164: string;
  occasion: string | null;
  guestNotes: string | null;
  marketingOptIn: boolean;
  amountCents: number;
  currency: string;
  createdVia: "app" | "web";
  consumerUserId: string | null;
  guestCancelToken: string | null;
  buyerStatusTokenHash: string;
  stripeAccountId?: string | null;
}

// deno-lint-ignore no-explicit-any
async function insertReservationSession(
  supabase: any,
  s: SessionInsert,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("reservation_checkout_sessions")
    .insert({
      brand_id: s.brandId,
      reserved_for: s.reservedForIso,
      party_size: s.partySize,
      buyer_name: s.buyerName,
      buyer_email: s.buyerEmail,
      buyer_phone_e164: s.buyerPhoneE164,
      occasion: s.occasion,
      guest_notes: s.guestNotes,
      marketing_opt_in: s.marketingOptIn,
      amount_cents: s.amountCents,
      currency: s.currency.toUpperCase(),
      created_via: s.createdVia,
      consumer_user_id: s.consumerUserId,
      guest_cancel_token: s.guestCancelToken,
      buyer_status_token_hash: s.buyerStatusTokenHash,
      stripe_account_id: s.stripeAccountId ?? null,
      status: "pending",
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (error !== null || !data) {
    console.error("[venue-reservation-create] session insert failed", error);
    return null;
  }
  return String((data as Record<string, unknown>).id ?? "") || null;
}

// deno-lint-ignore no-explicit-any
async function failReservationSession(
  supabase: any,
  sessionId: string,
  reason: string,
): Promise<void> {
  await supabase
    .from("reservation_checkout_sessions")
    .update({
      status: "failed",
      failure_reason: reason.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
}

function classifyRpcError(error: unknown, ctx: string): Response {
  const msg = (error as { message?: string } | null)?.message ?? "";
  console.error(`[venue-reservation-create] ${ctx} failed`, error);
  if (msg.includes("venue_not_reservable")) {
    return jsonResponse({ error: "venue_not_reservable" }, 409);
  }
  if (msg.includes("slot_unavailable")) {
    return jsonResponse({ error: "slot_unavailable" }, 409);
  }
  if (msg.includes("deposit_required")) {
    return jsonResponse({ error: "deposit_required" }, 422);
  }
  if (msg.includes("invalid_party_size") || msg.includes("invalid_input")) {
    return jsonResponse({ error: "party_size_invalid" }, 400);
  }
  return jsonResponse({ error: "reservation_create_failed", detail: msg }, 409);
}
