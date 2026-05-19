import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { stripeTicketCheckout, STRIPE_API_VERSION } from "../_shared/stripe.ts";
import { getPaymentMethodTypes } from "../_shared/stripePaymentMethods.ts";
// ORCH-0869 [Tr3 Installment Payments] — separate-line import so the
// ORCH-0849 R-2 regex (single-symbol braces) keeps matching above.
import { getInstallmentPaymentMethodTypes } from "../_shared/stripePaymentMethods.ts";
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
// ORCH-0839-B (2026-05-14): widened to include "mobile-web" for the
// mingla-business mobile hosted-Checkout pivot. "web" continues to emit
// https://… success_url/cancel_url; "mobile-web" emits the
// mingla-business://checkout/return custom-scheme deep link the native app
// intercepts via expo-web-browser.openAuthSessionAsync. "native" remains
// for backward compat with older mingla-business builds (PaymentIntent
// path below). Decision-gate probe (2026-05-14) confirmed Stripe accepts
// the custom scheme — see Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-
// 0839-B_STRIPE_HOSTED_CHECKOUT_PIVOT.md §3.
type CheckoutSurface = "native" | "web" | "mobile-web";

function isCheckoutLine(value: unknown): value is CheckoutLine {
  const row = value as Partial<CheckoutLine>;
  return (
    typeof row.ticketTypeId === "string" &&
    row.ticketTypeId.length > 0 &&
    Number.isInteger(row.quantity) &&
    Number(row.quantity) > 0
  );
}

// ORCH-0880 [Tr5 Traveler Intake Forms] — answer-empty predicate. Mirror of
// `intakeSchemaService.isAnswerEmpty` in `mingla-business/src/services/`.
// Per Constitution #13 (exclusion consistency) the answer-empty rule MUST
// behave identically in DB (validate_trip_intake_schema) + client validator +
// edge fn (this) so all 3 layers agree on what "missing required answer"
// means.
function isIntakeAnswerEmpty(type: string, answer: unknown): boolean {
  if (answer === undefined || answer === null) return true;
  switch (type) {
    case "short_text":
    case "long_text":
    case "single_choice":
    case "date":
    case "number":
      return typeof answer !== "string" || answer.trim().length === 0;
    case "multi_choice":
      return !Array.isArray(answer) || answer.length === 0;
    case "file_upload":
      return !Array.isArray(answer) || answer.length === 0;
    default:
      return true;
  }
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
  // ORCH-0839-B: three-way discriminator. Unknown values fall through to
  // "native" to preserve backward compat with older mingla-business builds
  // that send no surface field (older builds: omitted → "native").
  const surface: CheckoutSurface =
    body.surface === "web"
      ? "web"
      : body.surface === "mobile-web"
        ? "mobile-web"
        : "native";
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

  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — bookings-closed gate.
  // I-PROPOSED-TR4-BOOKING-DEADLINE-RESPECTED-AT-CHECKOUT (DRAFT) — last line
  // of defense. UI close banner + cron auto-close are defense-in-depth, not
  // enforcement. Trip-only effect (event_type='trip'); single-event flow
  // unchanged. Returns 403 with structured error so buyer-anon-web UI can
  // render the "Bookings closed" banner per DESIGN §4.4.
  const { data: tripGateRow, error: tripGateErr } = await supabase
    .from("events")
    .select("event_type, bookings_closed, booking_deadline")
    .eq("id", eventId)
    .maybeSingle();
  if (tripGateErr !== null) {
    console.error("[ticket-checkout-create] bookings_closed gate lookup failed", tripGateErr);
    return jsonResponse(
      { error: "event_lookup_failed", detail: tripGateErr.message },
      500,
    );
  }
  if (
    tripGateRow?.event_type === "trip" &&
    (tripGateRow.bookings_closed === true ||
      (typeof tripGateRow.booking_deadline === "string" &&
        new Date(tripGateRow.booking_deadline).getTime() <= Date.now()))
  ) {
    return jsonResponse(
      {
        error: "bookings_closed",
        detail: "Bookings closed",
        deadline: tripGateRow.booking_deadline ?? null,
      },
      403,
    );
  }

  // ORCH-0880 [Tr5 Traveler Intake Forms] — per-tier intake gate.
  // I-PROPOSED-TR5-INTAKE-REQUIRED-BLOCKS-CHECKOUT (DRAFT) — for each tier
  // in the buyer's cart, look up trip_intake_schemas. If a tier has schema
  // with ≥1 required question, the body MUST include intake_form_data for
  // that tier with all required questions answered AND a schema_version_id
  // matching the current row.
  // Body shape per SPEC §15.4 + intakeSchemaService.IntakeFormData:
  //   intake_form_data: [
  //     { ticket_type_id, schema_version_id, answers: {[questionId]: value} }
  //   ]
  // Trip-only effect; single-event flow unchanged (no event-side intake forms).
  if (tripGateRow?.event_type === "trip") {
    const intakeBody = Array.isArray(body.intake_form_data)
      ? (body.intake_form_data as Array<Record<string, unknown>>)
      : [];

    // Pull schemas for every ticket_type_id present in the cart.
    const ticketTypeIds = Array.from(
      new Set(lines.map((line) => line.ticketTypeId)),
    );
    if (ticketTypeIds.length > 0) {
      const { data: schemaRows, error: schemaErr } = await supabase
        .from("trip_intake_schemas")
        .select("ticket_type_id, schema, schema_version_id")
        .eq("event_id", eventId)
        .in("ticket_type_id", ticketTypeIds);
      if (schemaErr !== null) {
        console.error("[ticket-checkout-create] intake schema lookup failed", schemaErr);
        return jsonResponse(
          { error: "intake_schema_lookup_failed", detail: schemaErr.message },
          500,
        );
      }

      for (const row of schemaRows ?? []) {
        const schema = row.schema as
          | { questions?: Array<{ id?: string; type?: string; required?: boolean }> }
          | null;
        const schemaVersionId = row.schema_version_id as string;
        const ticketTypeId = row.ticket_type_id as string;
        if (schema === null || !Array.isArray(schema.questions)) continue;

        const requiredQuestionIds = schema.questions
          .filter((q) => q.required === true && typeof q.id === "string")
          .map((q) => q.id as string);

        const submitted = intakeBody.find(
          (entry) => entry.ticket_type_id === ticketTypeId,
        ) as
          | { schema_version_id?: string; answers?: Record<string, unknown> }
          | undefined;

        // Required gate: if schema has required questions, body MUST contain
        // intake_form_data for this tier with all required questions answered.
        if (requiredQuestionIds.length > 0) {
          const answers = submitted?.answers ?? {};
          const missingIds: string[] = [];
          for (const q of schema.questions) {
            if (q.required !== true || typeof q.id !== "string") continue;
            const value = answers[q.id];
            if (isIntakeAnswerEmpty(q.type ?? "", value)) {
              missingIds.push(q.id);
            }
          }
          if (missingIds.length > 0) {
            return jsonResponse(
              {
                error: "intake_form_required",
                ticket_type_id: ticketTypeId,
                missing_question_ids: missingIds,
              },
              400,
            );
          }
        }

        // Schema-version freshness check: if buyer submitted intake_form_data
        // for this tier, the schema_version_id MUST match the current row
        // (planner may have edited schema mid-checkout, invalidating answers).
        if (submitted !== undefined && submitted.schema_version_id !== schemaVersionId) {
          return jsonResponse(
            {
              error: "intake_schema_stale",
              ticket_type_id: ticketTypeId,
              current_schema_version_id: schemaVersionId,
              submitted_schema_version_id: submitted.schema_version_id ?? null,
            },
            409,
          );
        }
      }
    }
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

  // ORCH-0869 [Tr3 Installment Payments]: when the session RPC returns an
  // installmentSchedule (trip with payment plan), the deposit PI must save
  // the buyer's PaymentMethod off-session for the cron to charge future
  // installments. This is a NO-OP until Stage 1b RPC amendment lands —
  // until then session.installmentSchedule is always undefined.
  // Stage 1b: `biz_ticket_checkout_create_session` amended to return
  // installmentSchedule from trip_pricing_tiers.tier_metadata.installments.
  const isInstallmentPlan =
    session.installmentSchedule !== null &&
    session.installmentSchedule !== undefined;

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

  // ORCH-0843 (2026-05-15) — Mingla platform application-fee formula.
  // Hardcoded 1.5% of the order's unit amount per operator decision (G-2).
  // Computed in the edge function (NOT plumbed through the RPC) so that
  // changing the rate requires only an edge-function redeploy. Integer math
  // via Math.round on integer-cent input × 0.015 is precision-safe for any
  // realistic order amount (max safe cents ≈ 9.0×10^15). If the resulting
  // fee is zero (totalCents < ~67), the application_fee_amount key is
  // OMITTED from the Stripe call body entirely — Stripe documents both
  // omitting and passing zero as accepted, but omitting is the cleaner
  // contract and avoids any future "application_fee_amount must be > 0"
  // edge-case error. Discovery for orchestrator (future ORCH): plumb the
  // fee percentage through `brands` table or env config for dynamic
  // adjustment without code redeploy.
  const MINGLA_APPLICATION_FEE_RATE = 0.015 as const;
  const applicationFeeAmountCents = Math.round(
    totalCents * MINGLA_APPLICATION_FEE_RATE,
  );

  // ORCH-0843 — persist the computed fee on the session row so the refund
  // flow (refund-order) can read it back via biz_refund_order and decide
  // whether to pass refund_application_fee:true. The finalize RPC copies
  // ticket_checkout_sessions.stripe_application_fee_amount_cents into
  // orders.stripe_application_fee_amount_cents (migrations 20260515000013
  // lines 555-568). Defensive UPDATE here means we don't need an RPC
  // signature change. Failure is logged but non-fatal — the worst case is
  // a future refund that doesn't refund the platform fee component
  // (Mingla keeps that cut), which is acceptable degrade behavior at v1.
  const { error: feePersistError } = await supabase
    .from("ticket_checkout_sessions")
    .update({
      stripe_application_fee_amount_cents: applicationFeeAmountCents,
      updated_at: new Date().toISOString(),
    })
    .eq("id", checkoutSessionId);
  if (feePersistError) {
    console.error(
      "[ticket-checkout-create] application_fee persistence failed (non-fatal)",
      feePersistError,
    );
  }

  // ORCH-0790: web buyer flow uses Stripe Checkout Sessions (hosted page +
  // redirect). Native flow continues to use PaymentIntent + Stripe RN
  // PaymentSheet below.
  // ORCH-0839-B (2026-05-14): "mobile-web" surface joins this branch — same
  // hosted-Checkout API call, only success_url / cancel_url differ. Native
  // PaymentIntent path below stays for backward compat with older mingla-
  // business builds (untouched by this pivot).
  // ORCH-0843 (2026-05-15): flipped to DIRECT-CHARGE shape per DEC-154
  // (amended Path B). The charge object now lives on the connected
  // account (Stripe-Account header via the third-arg `stripeAccount`
  // request option); transfer_data.destination is gone; Mingla's
  // platform cut routes via application_fee_amount; the buyer's card
  // statement is suffixed with "MINGLA" via statement_descriptor_suffix
  // (Stripe's Checkout API only accepts `_suffix` at this level; a true
  // "MINGLA*" prefix requires one-time account-level config in Stripe
  // Dashboard on Mingla's main platform account).
  // DO NOT re-introduce transfer_data.destination — see INVESTIGATION_
  // ORCH-0843 + SPEC_ORCH-0843. CI gate
  // orch-0843-stripe-direct-charges-only.mjs enforces.
  if (surface === "web" || surface === "mobile-web") {
    let successUrl: string;
    let cancelUrl: string;
    if (surface === "web") {
      const baseUrl = Deno.env.get("MINGLA_PUBLIC_WEB_BASE_URL");
      if (!baseUrl || !/^https:\/\/[^\s]+$/.test(baseUrl)) {
        console.error(
          "[ticket-checkout-create] MINGLA_PUBLIC_WEB_BASE_URL not set or invalid",
        );
        return jsonResponse({ error: "web_base_url_missing" }, 500);
      }
      successUrl =
        `${baseUrl}/checkout/${eventId}/confirm?cs={CHECKOUT_SESSION_ID}`;
      cancelUrl = `${baseUrl}/checkout/${eventId}/payment`;
    } else {
      // ORCH-0839-B: mobile-hosted Checkout returns to the native app via a
      // custom-scheme deep link. expo-web-browser.openAuthSessionAsync
      // intercepts this URL inside the in-app browser session and resolves
      // with type:"success" + the full URL (so the app can read `cs` from
      // the query string). The scheme `mingla-business` is registered in
      // mingla-business/app.config.ts; reusing it for /checkout/return is
      // safe because /onboarding-complete and /checkout/return have
      // disjoint route handlers (and there is no in-app Linking listener —
      // the in-app browser session intercepts before the OS even tries to
      // wake the host app). Decision-gate probe 2026-05-14 confirmed Stripe
      // accepts this custom scheme on checkout.sessions.create.
      successUrl =
        `mingla-business://checkout/return?cs={CHECKOUT_SESSION_ID}&eventId=${eventId}&status=success`;
      cancelUrl =
        `mingla-business://checkout/return?cs={CHECKOUT_SESSION_ID}&eventId=${eventId}&status=cancel`;
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
      // Under DIRECT charges the Stripe-Account header (set on the
      // request-options below) alone designates the connected account
      // (brand) as merchant of record — automatic_tax.liability MUST be
      // OMITTED (ORCH-0843 REWORK; Stripe rejects the liability block on
      // direct charges with 400 StripeInvalidRequestError, see
      // https://docs.stripe.com/tax/connect/direct-charges). Stripe
      // Checkout auto-collects the buyer's billing address on the new
      // Customer (created from customer_email) when automatic_tax is
      // enabled, so jurisdiction lookup works without a customer_update
      // block. (ORCH-0811 removed customer_update: it requires an
      // existing `customer` id and Stripe rejects the request with "You
      // cannot use customer_update without setting customer" when paired
      // with customer_email.) The strict-grep gates
      // orch-0804-stripe-tax-enabled-on-checkout (enabled: true) and
      // orch-0843-stripe-direct-charges-only (T-G6: no liability block)
      // enforce these params at CI time.
      const piData: Record<string, unknown> = {
        // Metadata replicated on the PI so the existing webhook router
        // (handleTicketCheckoutPaymentIntent) can resolve our session
        // via metadata fallback when the session was created without a
        // pre-known PI id.
        metadata: {
          mingla_checkout_session_id: checkoutSessionId,
          mingla_event_id: eventId,
          mingla_buyer_email: buyerEmail,
          // ORCH-0869 [Tr3 Installment Payments]: mark deposit PI as
          // installment-plan-root so finalize RPC (Stage 1b) can write the
          // installment_plan_root=true flag on the orders row + create
          // child order_installments rows.
          ...(isInstallmentPlan ? { mingla_installment_plan_root: "true" } : {}),
        },
        // ORCH-0869: save the PaymentMethod for off-session installment charges.
        // Cron in process-scheduled-installments uses the saved PM via the
        // connected-account Customer (ORCH-0844 ephemeralKey path).
        ...(isInstallmentPlan ? { setup_future_usage: "off_session" } : {}),
        // ORCH-0843 — `statement_descriptor_suffix` appends "MINGLA" to the
        // creator account's default descriptor on the buyer's card statement
        // (Stripe truncates the combined string to 22 chars). Per Stripe's
        // Checkout API, only `_suffix` is valid at this level — a true
        // platform "MINGLA*" prefix is a one-time account-level config in
        // the Stripe Dashboard (Settings → Public details → Statement
        // descriptor on Mingla's main platform account) that prepends to
        // every connected-account charge automatically.
        statement_descriptor_suffix: "MINGLA",
      };
      if (applicationFeeAmountCents > 0) {
        // ORCH-0843 — Mingla's platform cut routes via application_fee_amount.
        // Omitted (not set to 0) when fee rounds to zero on tiny orders.
        piData.application_fee_amount = applicationFeeAmountCents;
      }
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
          payment_intent_data: piData,
          // ORCH-0843 REWORK — Under DIRECT charges (Stripe-Account header
          // set on the request-options below), Stripe Tax for Platforms uses
          // the Stripe-Account header alone to designate the connected
          // account as merchant of record. The legacy
          // `liability: { type: "account", account: <id> }` shape is for
          // destination/separate-transfer charges only and is REJECTED with
          // 400 StripeInvalidRequestError on direct-charge calls. See
          // https://docs.stripe.com/tax/connect/direct-charges — under
          // direct charges the connected account is the merchant of record
          // implicitly; do NOT include automatic_tax.liability. This block
          // replaces the SPEC §3.1.3 "PRESERVED VERBATIM" claim which was
          // SUPERSEDED by ORCH-0843 REWORK after QA caught the 400 in live.
          automatic_tax: { enabled: true },
          // ORCH-0811 — customer_update is only valid alongside an existing
          // `customer` id. Mingla creates a new Stripe Customer per buyer via
          // customer_email, so Stripe rejects customer_update with "You cannot
          // use customer_update without setting customer". Checkout auto-
          // collects billing address on new Customers when automatic_tax is
          // enabled, so removing this line preserves tax jurisdiction lookup.
          customer_email: buyerEmail,
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            mingla_checkout_session_id: checkoutSessionId,
            mingla_event_id: eventId,
          },
        },
        {
          idempotencyKey: `ticket_checkout_web:${checkoutSessionId}`,
          // ORCH-0843 — direct-charge: Stripe-Account header routes the
          // charge object to the connected account. Replaces destination-
          // charge transfer_data.destination from ORCH-0790.
          stripeAccount: stripeAccountId,
        },
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
    // ORCH-0843 — direct-charge shape for the native PaymentIntent path.
    // PaymentIntent is created on the connected account via the Stripe-
    // Account header (third-arg request option `stripeAccount`). The
    // platform-level "MINGLA*" prefix on the buyer's card statement is
    // handled via the connected account's account-level default in Stripe
    // Dashboard (operator config) — NOT via PI statement_descriptor_suffix
    // (which is a separate suffix mechanism). See SPEC §3.1.2.
    // ORCH-0849: payment_method_types sourced from
    // _shared/stripePaymentMethods.ts curated allowlist (Card + Link).
    // Apple Pay + Google Pay surface through the `card` type when the
    // mobile SDK initialises with merchantIdentifier / Google Pay plugin
    // — they are NOT valid payment_method_types values. Phase 2 methods
    // (Cash App Pay, Klarna/Afterpay, ACH/SEPA, regional redirects) remain
    // forbidden — each needs its own ORCH proving redirect-flow / delayed-
    // method plumbing. Invariant I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST.
    // CI gates: i-stripe-pm-method-allowlist.mjs (allowlist) +
    // orch-0837-regression-check.mjs T-C1 (still bans
    // automatic_payment_methods: enabled: true).
    const piCreateBody: Record<string, unknown> = {
      amount: totalCents,
      currency,
      // ORCH-0869 [Tr3 Installment Payments]: when deposit is installment-
      // plan-root, save PM for off-session installment charges.
      ...(isInstallmentPlan ? { setup_future_usage: "off_session" as const } : {}),
      payment_method_types: [...getPaymentMethodTypes()],
      metadata: {
        mingla_checkout_session_id: checkoutSessionId,
        mingla_event_id: eventId,
        mingla_buyer_email: buyerEmail,
        // ORCH-0869: deposit PI marker for finalize RPC discrimination.
        ...(isInstallmentPlan ? { mingla_installment_plan_root: "true" } : {}),
      },
    };
    // ORCH-0869 [Tr3] installment plans MUST be card-only because off_session
    // confirms require a saved PaymentMethod and only `card` is supported in
    // the saved-PM + auto-charge pipeline for v1 (SPEC H-2; Link off_session
    // semantics excluded). Replace the default full-allowlist after the base
    // body is constructed so the ORCH-0849 R-3 gate still sees the literal
    // `payment_method_types: [...getPaymentMethodTypes()]` pattern above on a
    // non-comment line, AND every value still flows through the SAME
    // _shared/stripePaymentMethods.ts allowlist (the installment helper is a
    // .filter(m => m === "card") of MINGLA_PM_ALLOWLIST, not a fresh literal).
    if (isInstallmentPlan) {
      piCreateBody.payment_method_types = [...getInstallmentPaymentMethodTypes()];
    }
    if (applicationFeeAmountCents > 0) {
      // ORCH-0843 — Mingla's platform cut on direct charges.
      piCreateBody.application_fee_amount = applicationFeeAmountCents;
    }
    // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
    paymentIntent = await stripe.paymentIntents.create(
      piCreateBody,
      {
        idempotencyKey: `ticket_checkout:${checkoutSessionId}`,
        // ORCH-0843 — direct-charge: Stripe-Account header. Replaces
        // destination-charge transfer_data.destination.
        stripeAccount: stripeAccountId,
      },
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

  // ORCH-0844 (2026-05-15) — Connect direct-charge mobile config.
  // After ORCH-0843 flipped every ticket PI to a direct charge on a
  // connected account (via the third-arg `{ stripeAccount }` request
  // option above), the mobile Stripe SDK must be initialised with the
  // matching stripeAccountId before opening PaymentSheet — otherwise the
  // SDK's mid-flow confirm call hits Stripe under the platform context,
  // the connected-account client_secret is rejected with a 404, and on
  // iOS 26 the native RCTPromiseResolveBlock fires twice (early-error +
  // late-completion) which RN's TurboModule bridge logs as
  // "tried to resolve a promise more than once".
  //
  // We additionally provision a Stripe Customer + ephemeralKey scoped to
  // the connected account (third-arg { stripeAccount } request option)
  // so PaymentSheet can render saved-PM UI. Both operations are NON-FATAL
  // — on any error we fall back to guest mode (null customer fields) and
  // PaymentSheet still works for one-off card payments. This preserves
  // ticket-sale uptime even when Stripe's customers-API hiccups.
  let customerId: string | null = null;
  let customerEphemeralKeySecret: string | null = null;
  try {
    // 3.2.3.a — Idempotent customer lookup by email on the CONNECTED ACCOUNT.
    // The { stripeAccount } request option scopes the search to that account.
    // orch-strict-grep-allow stripe-no-idempotency-key — read-only search; idempotency-key on Stripe search calls is rejected by the API (search is a query, not a mutation).
    const searchResult = await stripe.customers.search(
      {
        query: `email:'${buyerEmail.replace(/'/g, "\\'")}'`,
        limit: 1,
      },
      { stripeAccount: stripeAccountId },
    );
    let customer = searchResult.data[0] ?? null;

    if (customer === null) {
      // 3.2.3.b — Idempotent creation by email-hashed idempotency-key.
      const customerIdemKey =
        `mingla_customer:${stripeAccountId}:${await sha256Hex(buyerEmail)}`;
      customer = await stripe.customers.create(
        {
          email: buyerEmail,
          metadata: {
            mingla_buyer_email: buyerEmail,
            mingla_origin: "ticket_checkout_create_native",
          },
        },
        {
          idempotencyKey: customerIdemKey,
          stripeAccount: stripeAccountId,
        },
      );
    }
    customerId = customer.id;

    // 3.2.3.c — EphemeralKey for the mobile SDK, scoped to the connected
    // account. apiVersion is the platform's pinned STRIPE_API_VERSION;
    // ahead-of-SDK versions are non-fatal — the sheet still loads.
    const ephemeralKeyIdemKey =
      `mingla_ephkey:${stripeAccountId}:${customerId}:${Date.now()}`;
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerId },
      {
        apiVersion: STRIPE_API_VERSION,
        stripeAccount: stripeAccountId,
        idempotencyKey: ephemeralKeyIdemKey,
      },
    );
    customerEphemeralKeySecret = String(ephemeralKey.secret ?? "");
    if (customerEphemeralKeySecret.length === 0) {
      // defensive: empty secret — treat as failure (paired-or-absent invariant).
      customerId = null;
      customerEphemeralKeySecret = null;
    }
  } catch (customerErr) {
    // Non-fatal: log and continue with null customer fields. Mobile SDK
    // will init PaymentSheet in guest mode. This preserves the existing
    // happy path even if Connect customer-creation breaks on Stripe's side.
    console.warn(
      "[ticket-checkout-create] customer+ephemeralKey creation failed; continuing in guest mode",
      customerErr instanceof Error ? customerErr.message : customerErr,
    );
    customerId = null;
    customerEphemeralKeySecret = null;
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
    // ORCH-0844 NEW: Connect direct-charge mobile config.
    // stripeAccountId is the connected account the PI lives on (above).
    // customerId / customerEphemeralKeySecret are paired-or-absent:
    // both populated (Customer ready), or both null (guest mode).
    stripeAccountId,
    customerId,
    customerEphemeralKeySecret,
  });
});
