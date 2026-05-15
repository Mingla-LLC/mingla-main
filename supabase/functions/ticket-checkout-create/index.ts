import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import {
  cancelPaymentIntentIfClientAvailable,
  classifyStripeCheckoutSessionCreateFailure,
  classifyStripePaymentIntentCreateFailure,
  checkoutIdempotencyKey,
  dispatchTicketConfirmation,
  jsonResponse,
  randomBuyerStatusToken,
  normalizePhoneE164,
  qrTokenPepper,
  serviceClient,
  sha256Hex,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";

type CheckoutLine = { ticketTypeId: string; quantity: number };
type CheckoutSurface = "native" | "web";

function isCheckoutLine(value: unknown): value is CheckoutLine {
  const row = value as Partial<CheckoutLine>;
  return (
    typeof row.ticketTypeId === "string" &&
    row.ticketTypeId.length > 0 &&
    Number.isInteger(row.quantity) &&
    Number(row.quantity) > 0
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: ticketCorsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const surface: CheckoutSurface = body.surface === "web" ? "web" : "native";
  const buyer = (body.buyer ?? {}) as Record<string, unknown>;
  const buyerName = typeof buyer.name === "string" ? buyer.name.trim() : "";
  const buyerEmail = typeof buyer.email === "string" ? buyer.email.trim().toLowerCase() : "";
  const buyerPhoneE164 = normalizePhoneE164(buyer.phone);
  const marketingOptIn = buyer.marketingOptIn === true;
  const lines = Array.isArray(body.lines) ? body.lines.filter(isCheckoutLine) : [];

  if (!eventId) return jsonResponse({ error: "event_id_required" }, 400);
  if (buyerName.length < 2) return jsonResponse({ error: "buyer_name_required" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    return jsonResponse({ error: "buyer_email_invalid" }, 400);
  }
  if (buyerPhoneE164 === null) {
    return jsonResponse({ error: "buyer_phone_required" }, 400);
  }
  if (lines.length === 0) return jsonResponse({ error: "ticket_lines_required" }, 400);

  const userId = await userIdFromAuthHeader(req);
  const supabase = serviceClient();

  // ORCH-0792: reject checkout against events with no current/future date.
  // Pairs with the publish-RPC fix that writes event_dates and the
  // constraint trigger trg_events_enforce_master_date. See
  // Mingla_Artifacts/specs/SPEC_ORCH-0792_EVENTS_WITHOUT_DATES.md §5.1.
  const { count: futureDateCount, error: futureDateErr } = await supabase
    .from("event_dates")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .gt("end_at", new Date().toISOString());
  if (futureDateErr !== null) {
    console.error("[ticket-checkout-create] event_dates lookup failed", futureDateErr);
    return jsonResponse(
      { error: "event_date_lookup_failed", detail: futureDateErr.message },
      500,
    );
  }
  if ((futureDateCount ?? 0) === 0) {
    return jsonResponse({ error: "event_no_active_dates" }, 422);
  }

  const idempotencyKey =
    typeof body.idempotencyKey === "string" && body.idempotencyKey.length > 0
      ? body.idempotencyKey
      : checkoutIdempotencyKey({ eventId, buyerEmail, buyerPhoneE164, lines });
  const buyerStatusToken = randomBuyerStatusToken();

  const { data: sessionResult, error: sessionError } = await supabase.rpc(
    "biz_ticket_checkout_create_session",
    {
      p_event_id: eventId,
      p_buyer_user_id: userId,
      p_buyer_name: buyerName,
      p_buyer_email: buyerEmail,
      p_buyer_phone_e164: buyerPhoneE164,
      p_marketing_opt_in: marketingOptIn,
      p_lines: lines,
      p_idempotency_key: idempotencyKey,
      p_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      p_application_fee_amount_cents: 0,
    },
  );

  if (sessionError || !sessionResult) {
    console.error("[ticket-checkout-create] session RPC failed", sessionError);
    return jsonResponse(
      { error: "checkout_session_failed", detail: sessionError?.message },
      409,
    );
  }

  const session = sessionResult as Record<string, unknown>;
  const checkoutSessionId = String(session.checkoutSessionId ?? "");
  const { error: statusTokenError } = await supabase
    .from("ticket_checkout_sessions")
    .update({
      buyer_status_token_hash: await sha256Hex(buyerStatusToken),
      updated_at: new Date().toISOString(),
    })
    .eq("id", checkoutSessionId);
  if (statusTokenError) {
    console.error("[ticket-checkout-create] buyer status token persist failed", statusTokenError);
    return jsonResponse(
      { error: "checkout_session_failed", detail: "buyer_status_token_persist_failed" },
      409,
    );
  }
  const totalCents = Number(session.totalCents ?? 0);
  const currency = String(session.currency ?? "GBP").toLowerCase();

  if (totalCents === 0) {
    let qrPepper: string;
    try {
      qrPepper = qrTokenPepper();
    } catch {
      return jsonResponse({ error: "qr_token_pepper_missing" }, 500);
    }
    const { data: finalized, error: finalizeError } = await supabase.rpc(
      "biz_ticket_checkout_finalize",
      {
        p_checkout_session_id: checkoutSessionId,
        p_stripe_payment_intent_id: null,
        p_stripe_charge_id: null,
        p_stripe_payment_method_type: "free",
        p_qr_token_pepper: qrPepper,
      },
    );
    if (finalizeError || !finalized) {
      console.error("[ticket-checkout-create] free finalize failed", finalizeError);
      return jsonResponse(
        { error: "checkout_finalize_failed", detail: finalizeError?.message },
        409,
      );
    }
    const orderId = String((finalized as Record<string, unknown>).orderId ?? "");
    if (orderId) await dispatchTicketConfirmation(orderId);
    return jsonResponse({
      kind: "free_completed",
      ...finalized,
      buyerPhoneE164,
      buyerStatusToken,
    });
  }

  const stripeAccountId = typeof session.stripeAccountId === "string"
    ? session.stripeAccountId
    : null;
  if (!stripeAccountId) {
    return jsonResponse({ error: "stripe_account_not_ready" }, 409);
  }

  // ORCH-0790: web buyer flow uses Stripe Checkout Sessions (hosted page +
  // redirect). Native flow continues to use PaymentIntent + Stripe RN
  // PaymentSheet below. Both run destination charges against the same
  // connected account.
  if (surface === "web") {
    const baseUrl = Deno.env.get("MINGLA_PUBLIC_WEB_BASE_URL");
    if (!baseUrl || !/^https:\/\/[^\s]+$/.test(baseUrl)) {
      console.error("[ticket-checkout-create] MINGLA_PUBLIC_WEB_BASE_URL not set or invalid");
      return jsonResponse({ error: "web_base_url_missing" }, 500);
    }
    const eventName = typeof session.eventName === "string" && session.eventName.length > 0
      ? session.eventName
      : "Tickets";

    let stripeWeb: ReturnType<typeof stripeTicketCheckout>;
    let checkoutSession: { id: string; url: string | null };
    try {
      stripeWeb = stripeTicketCheckout();
      // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
      // ORCH-0804 / I-PROPOSED-BF — Stripe Tax enablement.
      // automatic_tax + liability.account designates the connected account
      // (brand) as merchant of record. Stripe Checkout auto-collects the
      // buyer's billing address on the new Customer (created from
      // customer_email) when automatic_tax is enabled, so jurisdiction
      // lookup works without a customer_update block. (ORCH-0811 removed
      // customer_update: it requires an existing `customer` id and Stripe
      // rejects the request with "You cannot use customer_update without
      // setting customer" when paired with customer_email.)
      // The strict-grep gate orch-0804-stripe-tax-enabled-on-checkout
      // enforces these params at CI time. Reference:
      // https://docs.stripe.com/tax/tax-for-platforms (destination-charge
      // platform model).
      checkoutSession = await stripeWeb.checkout.sessions.create(
        {
          mode: "payment",
          currency,
          line_items: [
            {
              price_data: {
                currency,
                unit_amount: totalCents,
                product_data: { name: `Tickets — ${eventName}` },
              },
              quantity: 1,
            },
          ],
          payment_intent_data: {
            transfer_data: { destination: stripeAccountId },
            // Metadata replicated on the PI so the existing webhook router
            // (handleTicketCheckoutPaymentIntent) can resolve our session
            // via metadata fallback when the session was created without a
            // pre-known PI id.
            metadata: {
              mingla_checkout_session_id: checkoutSessionId,
              mingla_event_id: eventId,
              mingla_buyer_email: buyerEmail,
            },
          },
          automatic_tax: {
            enabled: true,
            liability: {
              type: "account",
              account: stripeAccountId,
            },
          },
          // ORCH-0811 — customer_update is only valid alongside an existing
          // `customer` id. Mingla creates a new Stripe Customer per buyer via
          // customer_email, so Stripe rejects customer_update with "You cannot
          // use customer_update without setting customer". Checkout auto-
          // collects billing address on new Customers when automatic_tax is
          // enabled, so removing this line preserves tax jurisdiction lookup.
          customer_email: buyerEmail,
          success_url:
            `${baseUrl}/checkout/${eventId}/confirm?cs={CHECKOUT_SESSION_ID}`,
          cancel_url: `${baseUrl}/checkout/${eventId}/payment`,
          metadata: {
            mingla_checkout_session_id: checkoutSessionId,
            mingla_event_id: eventId,
          },
        },
        { idempotencyKey: `ticket_checkout_web:${checkoutSessionId}` },
      );
    } catch (err) {
      const failure = classifyStripeCheckoutSessionCreateFailure(err);
      console.error(
        "[ticket-checkout-create] checkout session create failed",
        failure.detail,
      );
      await supabase
        .from("ticket_checkout_sessions")
        .update({
          status: "failed",
          failed_at: new Date().toISOString(),
          failure_reason: failure.detail,
          updated_at: new Date().toISOString(),
        })
        .eq("id", checkoutSessionId);
      return jsonResponse(
        { error: "checkout_session_create_failed", detail: failure.detail },
        failure.httpStatus,
      );
    }

    if (!checkoutSession.url) {
      return jsonResponse({ error: "checkout_session_url_missing" }, 502);
    }

    const { error: persistWebError } = await supabase
      .from("ticket_checkout_sessions")
      .update({
        status: "awaiting_web_redirect",
        stripe_checkout_session_id: checkoutSession.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", checkoutSessionId);
    if (persistWebError) {
      console.error(
        "[ticket-checkout-create] checkout session persist failed",
        persistWebError,
      );
      return jsonResponse(
        {
          error: "checkout_session_persist_failed",
          detail: persistWebError.message,
        },
        500,
      );
    }

    return jsonResponse({
      kind: "requires_web_redirect",
      checkoutSessionId,
      buyerStatusToken,
      hostedCheckoutUrl: checkoutSession.url,
      totalCents,
      currency: String(session.currency ?? "GBP"),
    });
  }

  // ORCH-0804 / I-PROPOSED-BF — native PaymentIntent path is NOT tax-enabled
  // in v1. Stripe Tax on PaymentIntent requires pre-computing a tax_calculation
  // id via separate POST /v1/tax/calculations call. Material complexity.
  // Deferred to ORCH-0804-A. Until then, only the web Checkout Session path
  // above collects tax. Buyer using the native Payment Sheet today pays
  // without tax; brand carries the tax compliance gap on those orders.
  // Document in the ORCH-0804-A follow-up.
  let paymentIntent: {
    id: string;
    client_secret?: string | null;
  };
  let stripe: ReturnType<typeof stripeTicketCheckout> | null = null;
  try {
    stripe = stripeTicketCheckout();
    // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: totalCents,
        currency,
        // ORCH-0837: card-only PI per I-PROPOSED-STRIPE-PI-EXPLICIT-METHOD-TYPES.
        // Previously the automatic-payment-methods enabled form fanned out
        // to every dashboard-enabled method (16 in operator's sandbox incl.
        // Klarna/Affirm/Cash App/Amazon Pay/Apple Pay/Link/Bancontact/BLIK/
        // EPS/Kakao/Naver/Payco/MB Way/Pix/Samsung Pay). Operator-verified
        // failed PIs (pi_3TX3rBPjlZyAYA401xD9EJ3N, pi_3TX2jzPjlZyAYA401JI3kgky)
        // attached [card, klarna, link, affirm, cashapp, amazon_pay] — four
        // redirect-flow methods that require handleURLCallback wiring shipped
        // in this same ORCH (app/index.tsx) and Apple Pay merchant cert
        // verification deferred to ORCH-0838. Card-only is the minimum-viable
        // safe shape. Do NOT add other methods here without (a) dashboard
        // config justified, AND (b) handleURLCallback proven working for any
        // redirect-flow method, AND (c) eligibility/preflight latency
        // measured under a 5s budget. CI gate: orch-0837-regression-check.mjs
        // T-C1 forbids the automatic-payment-methods enabled form by string.
        payment_method_types: ["card"],
        transfer_data: { destination: stripeAccountId },
        metadata: {
          mingla_checkout_session_id: checkoutSessionId,
          mingla_event_id: eventId,
          mingla_buyer_email: buyerEmail,
        },
      },
      { idempotencyKey: `ticket_checkout:${checkoutSessionId}` },
    );
  } catch (err) {
    const failure = classifyStripePaymentIntentCreateFailure(err);
    console.error("[ticket-checkout-create] payment intent create failed", failure.detail);
    await supabase
      .from("ticket_checkout_sessions")
      .update({
        status: "failed",
        failed_at: new Date().toISOString(),
        failure_reason: failure.detail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", checkoutSessionId)
      .is("stripe_payment_intent_id", null);
    return jsonResponse(
      { error: "payment_intent_create_failed", detail: failure.detail },
      failure.httpStatus,
    );
  }

  const clientSecret = String(paymentIntent.client_secret ?? "");
  const { error: persistPaymentError } = await supabase
    .from("ticket_checkout_sessions")
    .update({
      status: "processing_payment",
      stripe_payment_intent_id: paymentIntent.id,
      stripe_client_secret_last4: clientSecret.slice(-4),
      stripe_payment_intent_client_secret_hash: await sha256Hex(clientSecret),
      updated_at: new Date().toISOString(),
    })
    .eq("id", checkoutSessionId);
  if (persistPaymentError) {
    console.error("[ticket-checkout-create] payment intent persist failed", persistPaymentError);
    if (stripe !== null) {
      try {
        await cancelPaymentIntentIfClientAvailable(stripe, paymentIntent.id);
      } catch (cancelError) {
        console.error("[ticket-checkout-create] payment intent cancel failed", cancelError);
      }
    }
    return jsonResponse(
      { error: "payment_session_persist_failed", detail: persistPaymentError.message },
      500,
    );
  }

  return jsonResponse({
    kind: "requires_payment",
    checkoutSessionId,
    buyerStatusToken,
    totalCents,
    currency: String(session.currency ?? "GBP"),
    clientSecret,
    paymentIntentId: paymentIntent.id,
    publishableKey:
      Deno.env.get("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY") ??
      Deno.env.get("STRIPE_PUBLISHABLE_KEY") ??
      null,
  });
});
