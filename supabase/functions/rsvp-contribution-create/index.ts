/**
 * rsvp-contribution-create — ORCH-1291 [rsvp-chip-in] (v1 of META-ORCH-1290).
 *
 * Anon-capable voluntary-gift charge for a chip-in-enabled RSVP event, on BOTH
 * rails (Stripe Connect direct-charge + Paystack NGN). The chip-in is a SECOND,
 * voluntary action AFTER a free RSVP — it never blocks the RSVP.
 *
 * GIFT semantics (SPEC §10 Q-A/Q-B — Seth-locked):
 *   • ZERO transaction tax: taxCents=0, tax_basis='voluntary_contribution'. NO
 *     Stripe Tax call, NO Paystack VAT (the entire raison of the new TaxBasis).
 *   • Organiser absorbs (WYSIWYG): the guest is charged EXACTLY the typed amount
 *     (pass_service_fee=false, pass_mingla_fee=false, Paystack bearer:'subaccount').
 *   • Mingla STILL takes its cut: application_fee_amount = miglaFee (Stripe) /
 *     transaction_charge = miglaFee (Paystack). allInPricingEngine.ts:238.
 *
 * REUSE (Constitution #2 — single money-math owner): the same allInPricingEngine
 * (computeBuyerSubtotal + buildPricingBreakdown) the ticket path uses, at
 * taxCents=0. NO divergent money path. The Stripe/Paystack create shapes mirror
 * ticket-checkout-create; this fn only skips the tax round-trip and writes the
 * event_rsvp_contributions child row instead of an order (NO ticket/QR).
 *
 * verify_jwt=false (config.toml): an optional Authorization bearer resolves the
 * user_id; else an anon buyer with name/email (SC-7). service-role handler.
 *
 * External-API docs (COMMS-0003 / I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED):
 *   • Direct-charge application_fee: https://docs.stripe.com/connect/direct-charges#collect-fees
 *   • PaymentIntent application_fee_amount: https://docs.stripe.com/api/payment_intents/create#create_payment_intent-application_fee_amount
 *   • Checkout Session on connected account: https://docs.stripe.com/connect/direct-charges
 *   • Paystack initialize (amount in subunits): https://paystack.com/docs/api/transaction/#initialize
 *   • Paystack subaccount split + transaction_charge + bearer: https://paystack.com/docs/api/subaccount/
 *   • Paystack channels (NG): https://paystack.com/docs/payments/payment-channels/
 *   • Amounts in minor units: https://docs.stripe.com/currencies
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// CORS via the shared allow-list (includes x-client-info → passes the ORCH-1205
// preflight gate; NO inline Access-Control-Allow-Headers literal here).
import { corsHeaders } from "../_shared/cors.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import { resolvePublishableKey } from "../_shared/stripeMode.ts";
import { getPaymentMethodTypes } from "../_shared/stripePaymentMethods.ts";
// ORCH-1291 — the SINGLE all-in money engine, reused at taxCents=0. No hand-rolled
// fee/tax arithmetic in this function.
import {
  buildPricingBreakdown,
  computeBuyerSubtotal,
  MINGLA_SERVICE_FEE_BPS,
  type ComputeAllInInput,
  type PricingBreakdown,
  type PricingRegion,
  type PricingSwitches,
} from "../_shared/allInPricingEngine.ts";
import {
  paystackChannelsForCountry,
  resolveProviderRouting,
} from "../_shared/paymentProvider.ts";
import { paystackInitializeTransaction } from "../_shared/paystack.ts";
import {
  cancelPaymentIntentIfClientAvailable,
  classifyStripeCheckoutSessionCreateFailure,
  classifyStripePaymentIntentCreateFailure,
  serviceClient,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
// ORCH-1295 [chip-in-post-payment-polish] — pure builder for the web return URLs
// (fixes BUG 1: brandSlug was omitted → dead page). Kept in a sibling module so
// it is unit-testable without importing this serve()-on-load entry.
import { buildContributionWebReturnUrls } from "./returnUrls.ts";

type ContributionSurface = "native" | "web" | "mobile-web";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STRIPE_REGIONS: ReadonlyArray<PricingRegion> = ["GB", "US", "EU", "CH"];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function optionalTrimmed(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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

  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const rsvpId = optionalTrimmed(body.rsvpId) ?? null;
  const amountCents = Number(body.amountCents);
  const guestName = optionalTrimmed(body.guestName) ?? null;
  const guestEmail = optionalTrimmed(body.guestEmail) ?? null;
  const surface: ContributionSurface = body.surface === "web"
    ? "web"
    : body.surface === "mobile-web"
    ? "mobile-web"
    : "native";

  if (!eventId) return jsonResponse({ error: "event_id_required" }, 400);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return jsonResponse({ error: "amount_invalid" }, 400);
  }

  // Optional JWT → user_id (else anon buyer). Anon buyers MUST give an email so
  // the contribution has a reachable identity + a Checkout receipt target.
  const userId = await userIdFromAuthHeader(req);
  if (userId === null && (guestEmail === null || !EMAIL_RE.test(guestEmail))) {
    return jsonResponse({ error: "guest_email_required" }, 400);
  }

  const supabase = serviceClient();

  // Read the event: must be a published RSVP with chip-in enabled.
  const { data: eventRow, error: eventErr } = await supabase
    .from("events")
    .select(
      "id, slug, event_type, brand_id, title, status, rsvp_contribution_enabled, rsvp_contribution_min_cents, brands(slug, name)",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr || !eventRow) {
    return jsonResponse({ error: "event_not_found" }, 404);
  }
  if (eventRow.event_type !== "rsvp") {
    return jsonResponse({ error: "not_an_rsvp_event" }, 409);
  }
  if (eventRow.rsvp_contribution_enabled !== true) {
    return jsonResponse({ error: "contribution_not_enabled" }, 409);
  }
  const minCents = typeof eventRow.rsvp_contribution_min_cents === "number"
    ? eventRow.rsvp_contribution_min_cents
    : null;
  if (minCents !== null && amountCents < minCents) {
    return jsonResponse({ error: "amount_below_min", minCents }, 422);
  }

  const brandId = String(eventRow.brand_id);

  // PROVIDER-AWARE readiness gate (fail-close). Reuses pg_brand_can_collect (the
  // same predicate the publish gate uses) — Stripe charges_enabled OR Paystack
  // subaccount. A Paystack brand is NOT blocked by the Stripe-only predicate.
  const { data: canCollect, error: canCollectErr } = await supabase.rpc(
    "pg_brand_can_collect",
    { p_brand_id: brandId },
  );
  if (canCollectErr) {
    console.error("[rsvp-contribution-create] pg_brand_can_collect failed", canCollectErr);
    return jsonResponse({ error: "readiness_check_failed" }, 500);
  }
  if (canCollect !== true) {
    return jsonResponse({ error: "brand_cannot_collect" }, 409);
  }

  // Resolve the brand pricing/provider inputs (the SAME resolver the ticket path
  // uses — provider, connected account, currency, region, take-rate).
  const { data: pricingRows, error: pricingError } = await supabase.rpc(
    "resolve_event_pricing_inputs",
    { p_event_id: eventId },
  );
  if (pricingError || !Array.isArray(pricingRows) || pricingRows.length === 0) {
    console.error("[rsvp-contribution-create] resolve_event_pricing_inputs failed", pricingError);
    return jsonResponse({ error: "pricing_config_unavailable" }, 409);
  }
  const pricing = pricingRows[0] as {
    pricing_region: string | null;
    pricing_currency: string | null;
    effective_take_rate_bps: number;
    take_rate_source: "brand_override" | "platform_default";
    stripe_account_id: string | null;
    payment_provider: string | null;
    payment_country: string | null;
    paystack_subaccount_code: string | null;
  };

  const routing = resolveProviderRouting({
    payment_provider: pricing.payment_provider,
    payment_country: pricing.payment_country,
    pricing_currency: pricing.pricing_currency,
  });

  const brandName = ((): string => {
    const joined = (eventRow as Record<string, unknown>).brands as
      | { name?: string | null; slug?: string | null }
      | Array<{ name?: string | null; slug?: string | null }>
      | null;
    const row = Array.isArray(joined) ? joined[0] ?? null : joined;
    return typeof row?.name === "string" && row.name.length > 0 ? row.name : "the host";
  })();

  // ORCH-1295 [chip-in-post-payment-polish] — the brand's URL slug for the web
  // return route `/e/{brandSlug}/{eventSlug}` (BUG 1: ORCH-1291 dropped it). Same
  // object-or-array normalization as brandName above (the `brands(slug, name)`
  // embed at the select). null → the web arm fails closed (never a partial path).
  const brandSlug = ((): string | null => {
    const joined = (eventRow as Record<string, unknown>).brands as
      | { name?: string | null; slug?: string | null }
      | Array<{ name?: string | null; slug?: string | null }>
      | null;
    const row = Array.isArray(joined) ? joined[0] ?? null : joined;
    return typeof row?.slug === "string" && row.slug.length > 0 ? row.slug : null;
  })();

  const contributionId = crypto.randomUUID();

  // WYSIWYG gift — FORCE organiser-absorbs regardless of the brand's ticket
  // switches (SPEC §10 Q-B): the buyer is charged EXACTLY the typed amount.
  const switches: PricingSwitches = {
    pass_tax: false,
    pass_mingla_fee: false,
    pass_service_fee: false,
  };

  // =====================================================================
  // PAYSTACK ARM (NGN) — mirrors ticket-checkout-create's Paystack arm.
  // =====================================================================
  if (routing.provider === "paystack") {
    const psCurrency = (routing.currency || "NGN").toUpperCase();
    if (psCurrency !== "NGN") {
      return jsonResponse({ error: "paystack_currency_must_be_ngn" }, 409);
    }
    if (!pricing.paystack_subaccount_code) {
      return jsonResponse({ error: "brand_cannot_collect" }, 409);
    }

    const engineInput: ComputeAllInInput = {
      baseCents: amountCents, // engine works in minor units; NGN minor = kobo
      switches,
      region: "NG",
      currency: "NGN",
      effectiveTakeRateBps: pricing.effective_take_rate_bps,
      takeRateSource: pricing.take_rate_source,
      serviceFeeBps: MINGLA_SERVICE_FEE_BPS,
    };
    const subtotal = computeBuyerSubtotal(engineInput);
    // GIFT: NO VAT — taxCents=0 (SPEC §10 Q-A). buyerTotal == amount (absorbed).
    const breakdown: PricingBreakdown = buildPricingBreakdown({
      input: engineInput,
      amountTotalCents: subtotal.buyerSubtotalCents,
      taxCents: 0,
      taxBasis: "voluntary_contribution",
      stripeTaxCalculationId: null,
    });
    const applicationFeeCents = subtotal.miglaFeeCents;
    const buyerTotalCents = breakdown.buyer_total_cents;

    // Unique reference — persisted in stripe_payment_intent_id (UNIQUE) BEFORE
    // calling Paystack (idempotency + retry safety; a retry mints a fresh ref).
    const reference = `mingla_contrib_${contributionId.replaceAll("-", "")}_${Date.now().toString(36)}`;

    const { error: insertErr } = await supabase
      .from("event_rsvp_contributions")
      .insert({
        id: contributionId,
        event_id: eventId,
        rsvp_id: rsvpId,
        brand_id: brandId,
        user_id: userId,
        guest_name: guestName,
        guest_email: guestEmail,
        provider: "paystack",
        currency: "NGN",
        amount_cents: amountCents,
        buyer_total_cents: buyerTotalCents,
        application_fee_amount_cents: applicationFeeCents,
        pricing_breakdown: breakdown,
        status: "pending",
        stripe_payment_intent_id: reference,
      });
    if (insertErr) {
      console.error("[rsvp-contribution-create] paystack contribution insert failed", insertErr);
      return jsonResponse({ error: "contribution_persist_failed" }, 500);
    }

    const callbackBase = Deno.env.get("PAYSTACK_CALLBACK_BASE") ??
      "https://business.usemingla.com/pay/callback";
    const callbackUrl = `${callbackBase}?contrib=${encodeURIComponent(contributionId)}`;

    let init: { authorization_url: string; reference: string; access_code: string };
    try {
      init = await paystackInitializeTransaction({
        email: guestEmail ?? `${contributionId}@guest.usemingla.com`,
        amountSubunits: buyerTotalCents, // already kobo (minor units)
        currency: "NGN",
        reference,
        callbackUrl,
        channels: paystackChannelsForCountry("NG"),
        metadata: {
          mingla_purpose: "rsvp_contribution",
          contribution_id: contributionId,
          mingla_event_id: eventId,
        },
        // Split to the brand's subaccount; Mingla's cut rides as the flat
        // transaction_charge (kobo). bearer:'subaccount' → the organiser absorbs
        // Paystack's processing fee (WYSIWYG gift — SPEC §10 Q-B).
        subaccount: pricing.paystack_subaccount_code,
        transactionChargeSubunits: applicationFeeCents,
        bearer: "subaccount",
      });
    } catch (err) {
      console.error(
        "[rsvp-contribution-create] paystack initialize failed",
        String((err as Error)?.message ?? err),
      );
      await supabase
        .from("event_rsvp_contributions")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", contributionId);
      return jsonResponse({ error: "paystack_initialize_failed" }, 502);
    }

    return jsonResponse({
      kind: "requires_paystack_redirect",
      contributionId,
      authorizationUrl: init.authorization_url,
      reference: init.reference,
      amountCents,
      buyerTotalCents,
      currency: "NGN",
      pricingBreakdown: breakdown,
    });
  }

  // =====================================================================
  // STRIPE ARM (Connect direct-charge) — mirrors ticket-checkout-create.
  // =====================================================================
  const stripeAccountId = typeof pricing.stripe_account_id === "string" &&
      pricing.stripe_account_id.length > 0
    ? pricing.stripe_account_id
    : null;
  if (!stripeAccountId) {
    return jsonResponse({ error: "brand_cannot_collect" }, 409);
  }

  const region: PricingRegion = STRIPE_REGIONS.includes(
      (pricing.pricing_region ?? "GB") as PricingRegion,
    )
    ? (pricing.pricing_region as PricingRegion)
    : "GB"; // display-only; taxCents=0 for a gift so behaviour is inert.
  const currency = (pricing.pricing_currency ?? "USD").toUpperCase();
  const currencyLower = currency.toLowerCase();

  const engineInput: ComputeAllInInput = {
    baseCents: amountCents,
    switches,
    region,
    currency,
    effectiveTakeRateBps: pricing.effective_take_rate_bps,
    takeRateSource: pricing.take_rate_source,
    serviceFeeBps: MINGLA_SERVICE_FEE_BPS,
  };
  const subtotal = computeBuyerSubtotal(engineInput);
  // GIFT: NO Stripe Tax round-trip — taxCents=0, buyerTotal == amount (SPEC Q-A).
  const breakdown: PricingBreakdown = buildPricingBreakdown({
    input: engineInput,
    amountTotalCents: subtotal.buyerSubtotalCents,
    taxCents: 0,
    taxBasis: "voluntary_contribution",
    stripeTaxCalculationId: null,
  });
  const applicationFeeCents = subtotal.miglaFeeCents;
  const buyerTotalCents = breakdown.buyer_total_cents;

  // Persist the pending row BEFORE charging (the PI id fills stripe_payment_intent_id).
  const { error: insertErr } = await supabase
    .from("event_rsvp_contributions")
    .insert({
      id: contributionId,
      event_id: eventId,
      rsvp_id: rsvpId,
      brand_id: brandId,
      user_id: userId,
      guest_name: guestName,
      guest_email: guestEmail,
      provider: "stripe",
      currency,
      amount_cents: amountCents,
      buyer_total_cents: buyerTotalCents,
      application_fee_amount_cents: applicationFeeCents,
      pricing_breakdown: breakdown,
      status: "pending",
    });
  if (insertErr) {
    console.error("[rsvp-contribution-create] stripe contribution insert failed", insertErr);
    return jsonResponse({ error: "contribution_persist_failed" }, 500);
  }

  const metadata = {
    mingla_purpose: "rsvp_contribution",
    contribution_id: contributionId,
    mingla_event_id: eventId,
  };

  // WEB / MOBILE-WEB → hosted Stripe Checkout (redirect). NO automatic_tax — a
  // contribution is a zero-tax gift (SPEC §10 Q-A). unit_amount = the gift.
  if (surface === "web" || surface === "mobile-web") {
    const eventName = typeof eventRow.title === "string" && eventRow.title.length > 0
      ? eventRow.title
      : "this event";
    let successUrl: string;
    let cancelUrl: string;
    if (surface === "web") {
      const baseUrl = Deno.env.get("MINGLA_PUBLIC_WEB_BASE_URL");
      if (!baseUrl || !/^https:\/\/[^\s]+$/.test(baseUrl)) {
        return jsonResponse({ error: "web_base_url_missing" }, 500);
      }
      // ORCH-1295 [chip-in-post-payment-polish] — BUG 1: build the return URLs as
      // `/e/{brandSlug}/{eventSlug}` (ORCH-1291 dropped brandSlug → dead page).
      // Fail closed if brandSlug is missing rather than strand the guest on a URL
      // with a missing path segment (the pending row is marked failed first).
      const eventSlug = typeof eventRow.slug === "string" && eventRow.slug.length > 0
        ? eventRow.slug
        : eventId;
      const returnUrls = buildContributionWebReturnUrls(baseUrl, brandSlug, eventSlug);
      if (returnUrls === null) {
        console.error(
          "[rsvp-contribution-create] cannot build web return URL — brandSlug missing",
          { eventId, brandId },
        );
        await supabase
          .from("event_rsvp_contributions")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", contributionId);
        return jsonResponse({ error: "brand_slug_unavailable" }, 500);
      }
      successUrl = returnUrls.successUrl;
      cancelUrl = returnUrls.cancelUrl;
    } else {
      successUrl = `mingla-business://checkout/return?contribution=paid&contrib=${contributionId}`;
      cancelUrl = `mingla-business://checkout/return?contribution=cancel&contrib=${contributionId}`;
    }

    let stripeWeb: ReturnType<typeof stripeTicketCheckout>;
    let checkoutSession: { id: string; url: string | null };
    try {
      stripeWeb = stripeTicketCheckout();
      const piData: Record<string, unknown> = {
        metadata,
        statement_descriptor_suffix: "MINGLA",
      };
      if (applicationFeeCents > 0) {
        piData.application_fee_amount = applicationFeeCents;
      }
      // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
      checkoutSession = await stripeWeb.checkout.sessions.create(
        {
          mode: "payment",
          currency: currencyLower,
          line_items: [
            {
              price_data: {
                currency: currencyLower,
                unit_amount: buyerTotalCents,
                product_data: { name: `Contribution — ${eventName}` },
              },
              quantity: 1,
            },
          ],
          payment_intent_data: piData,
          // A gift is NOT a taxed sale → automatic_tax intentionally OMITTED.
          ...(guestEmail !== null ? { customer_email: guestEmail } : {}),
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata,
        },
        {
          idempotencyKey: `rsvp_contribution_web:${contributionId}`,
          stripeAccount: stripeAccountId,
        },
      );
    } catch (err) {
      const failure = classifyStripeCheckoutSessionCreateFailure(err);
      console.error("[rsvp-contribution-create] checkout session create failed", failure.detail);
      await supabase
        .from("event_rsvp_contributions")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", contributionId);
      return jsonResponse({ error: "checkout_session_create_failed", detail: failure.detail }, failure.httpStatus);
    }

    if (!checkoutSession.url) {
      return jsonResponse({ error: "checkout_session_url_missing" }, 502);
    }
    await supabase
      .from("event_rsvp_contributions")
      .update({
        stripe_payment_intent_id: checkoutSession.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contributionId);

    return jsonResponse({
      kind: "requires_web_redirect",
      contributionId,
      hostedCheckoutUrl: checkoutSession.url,
      amountCents,
      buyerTotalCents,
      currency,
    });
  }

  // NATIVE → PaymentIntent + Stripe RN PaymentSheet (guest mode; a gift needs no
  // saved Customer). Direct-charge: application_fee_amount + Stripe-Account header.
  let paymentIntent: { id: string; client_secret?: string | null };
  let stripe: ReturnType<typeof stripeTicketCheckout> | null = null;
  try {
    stripe = stripeTicketCheckout();
    const piCreateBody: Record<string, unknown> = {
      amount: buyerTotalCents,
      currency: currencyLower,
      payment_method_types: [...getPaymentMethodTypes()],
      metadata,
    };
    if (applicationFeeCents > 0) {
      piCreateBody.application_fee_amount = applicationFeeCents;
    }
    // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
    paymentIntent = await stripe.paymentIntents.create(
      piCreateBody,
      {
        idempotencyKey: `rsvp_contribution:${contributionId}`,
        stripeAccount: stripeAccountId,
      },
    );
  } catch (err) {
    const failure = classifyStripePaymentIntentCreateFailure(err);
    console.error("[rsvp-contribution-create] payment intent create failed", failure.detail);
    await supabase
      .from("event_rsvp_contributions")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", contributionId);
    return jsonResponse({ error: "payment_intent_create_failed", detail: failure.detail }, failure.httpStatus);
  }

  const clientSecret = String(paymentIntent.client_secret ?? "");
  const { error: persistErr } = await supabase
    .from("event_rsvp_contributions")
    .update({
      stripe_payment_intent_id: paymentIntent.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contributionId);
  if (persistErr) {
    console.error("[rsvp-contribution-create] PI persist failed", persistErr);
    if (stripe !== null) {
      try {
        await cancelPaymentIntentIfClientAvailable(stripe, paymentIntent.id);
      } catch (cancelError) {
        console.error("[rsvp-contribution-create] PI cancel failed", cancelError);
      }
    }
    return jsonResponse({ error: "payment_session_persist_failed" }, 500);
  }

  return jsonResponse({
    kind: "requires_native_payment",
    contributionId,
    clientSecret,
    paymentIntentId: paymentIntent.id,
    stripeAccountId,
    publishableKey: resolvePublishableKey(),
    amountCents,
    buyerTotalCents,
    currency,
    brandName,
    pricingBreakdown: breakdown,
  });
});
