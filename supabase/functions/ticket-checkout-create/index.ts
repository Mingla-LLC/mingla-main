import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { STRIPE_API_VERSION, stripeTicketCheckout } from "../_shared/stripe.ts";
import { getPaymentMethodTypes } from "../_shared/stripePaymentMethods.ts";
// ORCH-0869 [Tr3 Installment Payments] — separate-line import so the
// ORCH-0849 R-2 regex (single-symbol braces) keeps matching above.
import { getInstallmentPaymentMethodTypes } from "../_shared/stripePaymentMethods.ts";
import {
  cancelPaymentIntentIfClientAvailable,
  checkoutIdempotencyKey,
  classifyStripeCheckoutSessionCreateFailure,
  classifyStripePaymentIntentCreateFailure,
  dispatchTicketConfirmation,
  jsonResponse,
  normalizePhoneE164,
  qrTokenPepper,
  randomBuyerStatusToken,
  serviceClient,
  sha256Hex,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
// ORCH-1006 [Universal all-in pricing engine] — shared money engine.
// (slice 1 uses feeFromBps + the region/switches types; the gross-up + tax
// helpers — computeBuyerSubtotal/buildPricingBreakdown/taxBehaviorForRegion/
// MINGLA_SERVICE_FEE_BPS — are imported when slice 2 wires them in.)
import {
  feeFromBps,
  type PricingRegion,
  type PricingSwitches,
} from "../_shared/allInPricingEngine.ts";

type CheckoutLine = { ticketTypeId: string; quantity: number };
type CheckoutMode = "create" | "preview";
type BuyerAddress = {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postal: string;
  country: string;
};
type TaxCalculationSummary = {
  id: string;
  amount_total: number;
  tax_breakdown: unknown[];
};
type TaxLineItem = {
  ticketTypeId: string;
  ticketName: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
};
type StripeTaxFailure = {
  error: "tax_calculation_failed" | "tax_country_unsupported";
  detail: string;
  httpStatus: number;
};
type PaymentPlanChoice = "auto" | "full" | "installments";
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

function optionalTrimmed(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseBuyerAddress(value: unknown): BuyerAddress | null {
  if (value === null || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const line1 = optionalTrimmed(input.line1);
  const city = optionalTrimmed(input.city);
  const postal = optionalTrimmed(input.postal);
  const country = optionalTrimmed(input.country);
  if (!line1 || !city || !postal || !country) return null;
  return {
    line1,
    ...(optionalTrimmed(input.line2)
      ? { line2: optionalTrimmed(input.line2) }
      : {}),
    city,
    ...(optionalTrimmed(input.state)
      ? { state: optionalTrimmed(input.state) }
      : {}),
    postal,
    country,
  };
}

function validateBuyerAddress(address: BuyerAddress | null): string | null {
  if (address === null) {
    return "buyer.address.line1 is required for native paid checkout";
  }
  if (address.line1.length > 200) {
    return "buyer.address.line1 must be 200 characters or fewer";
  }
  if (address.line2 && address.line2.length > 200) {
    return "buyer.address.line2 must be 200 characters or fewer";
  }
  if (address.city.length > 100) {
    return "buyer.address.city must be 100 characters or fewer";
  }
  if (address.state && address.state.length > 50) {
    return "buyer.address.state must be 50 characters or fewer";
  }
  if (address.postal.length > 20) {
    return "buyer.address.postal must be 20 characters or fewer";
  }
  if (!/^[A-Z]{2}$/.test(address.country)) {
    return "country must match ISO-3166 alpha-2 uppercase";
  }
  return null;
}

function classifyStripeTaxCalculationFailure(err: unknown): StripeTaxFailure {
  const record = err as
    | {
      code?: unknown;
      type?: unknown;
      param?: unknown;
      message?: unknown;
      raw?: {
        code?: unknown;
        type?: unknown;
        param?: unknown;
        message?: unknown;
      };
    }
    | null
    | undefined;
  const code = String(record?.code ?? record?.raw?.code ?? "").toLowerCase();
  const type = String(record?.type ?? record?.raw?.type ?? "").toLowerCase();
  const param = String(record?.param ?? record?.raw?.param ?? "").toLowerCase();
  const detail = record?.message ?? record?.raw?.message;
  const message = typeof detail === "string" ? detail : String(err);
  const normalized = `${code} ${type} ${param} ${message}`.toLowerCase();
  if (
    normalized.includes("country_unsupported") ||
    normalized.includes("unsupported country") ||
    normalized.includes("country is not supported") ||
    (param.includes("country") && normalized.includes("not supported"))
  ) {
    return {
      error: "tax_country_unsupported",
      detail: message,
      httpStatus: 422,
    };
  }
  return { error: "tax_calculation_failed", detail: message, httpStatus: 502 };
}

function normalizeTaxLineItemsForCurrentCharge(input: {
  lineItems: TaxLineItem[];
  isInstallmentPlan: boolean;
  totalCents: number;
}): TaxLineItem[] {
  const sum = input.lineItems.reduce(
    (total, line) => total + line.totalCents,
    0,
  );
  if (
    !input.isInstallmentPlan ||
    input.totalCents <= 0 ||
    sum === input.totalCents
  ) {
    return input.lineItems;
  }
  return [{
    ticketTypeId: "installment-deposit",
    ticketName: "Installment deposit",
    quantity: 1,
    unitPriceCents: input.totalCents,
    totalCents: input.totalCents,
  }];
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

  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  // ORCH-0839-B: three-way discriminator. Unknown values fall through to
  // "native" to preserve backward compat with older mingla-business builds
  // that send no surface field (older builds: omitted → "native").
  const surface: CheckoutSurface = body.surface === "web"
    ? "web"
    : body.surface === "mobile-web"
    ? "mobile-web"
    : "native";
  const buyer = (body.buyer ?? {}) as Record<string, unknown>;
  const buyerName = typeof buyer.name === "string" ? buyer.name.trim() : "";
  const buyerEmail = typeof buyer.email === "string"
    ? buyer.email.trim().toLowerCase()
    : "";
  const buyerPhoneE164 = normalizePhoneE164(buyer.phone);
  const marketingOptIn = buyer.marketingOptIn === true;
  const buyerAddress = parseBuyerAddress(buyer.address);
  const lines = Array.isArray(body.lines)
    ? body.lines.filter(isCheckoutLine)
    : [];
  const mode: CheckoutMode = body.mode === "preview" ? "preview" : "create";
  const clientTaxCalculationId = typeof body.taxCalculationId === "string" &&
      body.taxCalculationId.length > 0
    ? body.taxCalculationId
    : null;
  let paymentPlanChoice: PaymentPlanChoice = "auto";
  if (body.payment_plan_choice !== undefined) {
    if (
      body.payment_plan_choice !== "full" &&
      body.payment_plan_choice !== "installments"
    ) {
      return jsonResponse({ error: "payment_plan_choice_invalid" }, 400);
    }
    paymentPlanChoice = body.payment_plan_choice;
  }

  if (!eventId) return jsonResponse({ error: "event_id_required" }, 400);
  if (buyerName.length < 2) {
    return jsonResponse({ error: "buyer_name_required" }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    return jsonResponse({ error: "buyer_email_invalid" }, 400);
  }
  if (buyerPhoneE164 === null) {
    return jsonResponse({ error: "buyer_phone_required" }, 400);
  }
  if (lines.length === 0) {
    return jsonResponse({ error: "ticket_lines_required" }, 400);
  }
  if (surface === "native" && mode === "create") {
    const addressError = validateBuyerAddress(buyerAddress);
    if (addressError !== null) {
      return jsonResponse(
        {
          error: buyerAddress === null
            ? "buyer_address_required"
            : "buyer_address_invalid",
          detail: addressError,
        },
        400,
      );
    }
  }
  if (surface === "native" && mode === "preview" && buyerAddress !== null) {
    const addressError = validateBuyerAddress(buyerAddress);
    if (addressError !== null) {
      return jsonResponse(
        { error: "buyer_address_invalid", detail: addressError },
        400,
      );
    }
  }

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
    console.error(
      "[ticket-checkout-create] event_dates lookup failed",
      futureDateErr,
    );
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
    console.error(
      "[ticket-checkout-create] bookings_closed gate lookup failed",
      tripGateErr,
    );
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
        console.error(
          "[ticket-checkout-create] intake schema lookup failed",
          schemaErr,
        );
        return jsonResponse(
          { error: "intake_schema_lookup_failed", detail: schemaErr.message },
          500,
        );
      }

      for (const row of schemaRows ?? []) {
        const schema = row.schema as
          | {
            questions?: Array<
              { id?: string; type?: string; required?: boolean }
            >;
          }
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
        if (
          submitted !== undefined &&
          submitted.schema_version_id !== schemaVersionId
        ) {
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
      : checkoutIdempotencyKey({
        eventId,
        buyerEmail,
        buyerPhoneE164,
        lines,
        paymentPlanChoice,
      });
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
      p_payment_plan_choice: paymentPlanChoice,
    },
  );

  if (sessionError || !sessionResult) {
    console.error("[ticket-checkout-create] session RPC failed", sessionError);
    if (sessionError?.message?.includes("payment_plan_choice_invalid")) {
      return jsonResponse({ error: "payment_plan_choice_invalid" }, 400);
    }
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
    console.error(
      "[ticket-checkout-create] buyer status token persist failed",
      statusTokenError,
    );
    return jsonResponse(
      {
        error: "checkout_session_failed",
        detail: "buyer_status_token_persist_failed",
      },
      409,
    );
  }
  const totalCents = Number(session.totalCents ?? 0);
  const currency = String(session.currency ?? "GBP").toLowerCase();

  if (surface === "native" && mode === "preview" && buyerAddress === null) {
    return jsonResponse({
      kind: "preview",
      checkoutSessionId,
      subtotalCents: totalCents,
      taxCents: 0,
      totalCents,
      currency: String(session.currency ?? "GBP"),
      taxBreakdown: [],
      calculationId: null,
      calculationExpiresAt: null,
      addressMissing: true,
    });
  }

  // ORCH-0869 [Tr3 Installment Payments]: when the session RPC returns an
  // installmentSchedule (trip with payment plan), the deposit PI must save
  // the buyer's PaymentMethod off-session for the cron to charge future
  // installments. This is a NO-OP until Stage 1b RPC amendment lands —
  // until then session.installmentSchedule is always undefined.
  // Stage 1b: `biz_ticket_checkout_create_session` amended to return
  // installmentSchedule from trip_pricing_tiers.tier_metadata.installments.
  const isInstallmentPlan = session.installmentSchedule !== null &&
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
      console.error(
        "[ticket-checkout-create] free finalize failed",
        finalizeError,
      );
      return jsonResponse(
        { error: "checkout_finalize_failed", detail: finalizeError?.message },
        409,
      );
    }
    const orderId = String(
      (finalized as Record<string, unknown>).orderId ?? "",
    );
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

  // ORCH-1006 [Universal all-in pricing engine] — resolve the brand/event
  // pricing config (3 pass/absorb switches + region/currency + venue tax
  // basis + the CONFIGURABLE Mingla take-rate, global default with per-brand
  // override) for this event. One single-row read via the resolver RPC
  // (standalone, no clobber of the big session RPC). Replaces ORCH-0843's
  // hardcoded 1.5% application-fee constant (DEC: take-rate is now
  // operator-tunable in the admin /pricing screen; stored as integer basis
  // points; migration default = 150 bps = today's 1.5% → zero economic
  // change at migration). resolve_event_pricing_inputs is GRANTed to
  // service_role; this edge function runs service-role.
  const { data: pricingRows, error: pricingError } = await supabase.rpc(
    "resolve_event_pricing_inputs",
    { p_event_id: eventId },
  );
  if (pricingError || !Array.isArray(pricingRows) || pricingRows.length === 0) {
    console.error(
      "[ticket-checkout-create] resolve_event_pricing_inputs failed",
      pricingError,
    );
    return jsonResponse(
      { error: "pricing_config_unavailable", detail: pricingError?.message },
      409,
    );
  }
  const pricing = pricingRows[0] as {
    pass_tax: boolean;
    pass_mingla_fee: boolean;
    pass_service_fee: boolean;
    pricing_region: string | null;
    pricing_currency: string | null;
    venue_tax_address: Record<string, unknown> | null;
    pricing_locked: boolean;
    effective_take_rate_bps: number;
    take_rate_source: "brand_override" | "platform_default";
  };
  const pricingRegion = (pricing.pricing_region ?? "GB") as PricingRegion;
  const pricingSwitches: PricingSwitches = {
    pass_tax: pricing.pass_tax,
    pass_mingla_fee: pricing.pass_mingla_fee,
    pass_service_fee: pricing.pass_service_fee,
  };

  // application_fee_amount = Mingla's take-rate skim, ALWAYS (independent of
  // pass/absorb — the switch only changes the buyer-facing gross-up, not what
  // Mingla collects). Direct-charge collection:
  // https://docs.stripe.com/api/payment_intents/create#create_payment_intent-application_fee_amount
  // https://docs.stripe.com/connect/direct-charges#collect-fees
  // Integer basis-point math (no float; invariant I-PROPOSED-TAKE-RATE-BPS-INTEGER).
  // Omitted from the Stripe body when it rounds to zero (existing >0 guard kept).
  const applicationFeeAmountCents = feeFromBps(
    totalCents,
    pricing.effective_take_rate_bps,
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
      // ORCH-0911: branch buyer-web confirm/payment URLs on event_type.
      const isTrip = tripGateRow?.event_type === "trip";
      const surfacePath = isTrip ? "checkout-trip" : "checkout";
      // ORCH-0928 v2 (2026-05-23) — query-string recovery params for
      // confirm.tsx. v3 dual-format hack reverted 2026-05-23 ~12:50 UTC
      // after live-fire confirmed the fragment portion triggers Expo
      // Router URL mangling that defeats BOTH v1 and v2 client recovery.
      // Query-string-only is the correct stable shape — v2 client reads
      // csi+bst from `search` via URLSearchParams. v1 client (still live
      // on production pending Vercel rate-limit reset OR plan upgrade)
      // cannot recover from this format and stays on loading hero;
      // production buyers are broken until Vercel deploys v2 client.
      successUrl =
        `${baseUrl}/${surfacePath}/${eventId}/confirm?cs={CHECKOUT_SESSION_ID}&csi=${checkoutSessionId}&bst=${buyerStatusToken}`;
      cancelUrl = `${baseUrl}/${surfacePath}/${eventId}/payment`;
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
    const eventName =
      typeof session.eventName === "string" && session.eventName.length > 0
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
      // Customer (created when customer_creation: "always" is set for
      // installment plans, per ORCH-0925) when automatic_tax is enabled,
      // so jurisdiction lookup works without a customer_update
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
          ...(isInstallmentPlan
            ? { mingla_installment_plan_root: "true" }
            : {}),
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
          // ORCH-0925 — installment plans MUST attach a Stripe Customer so
          // the cron `process-scheduled-installments` can later charge the
          // saved PaymentMethod off-session via `customer + payment_method`.
          // Stripe's default `customer_creation: "if_required"` for
          // `mode: "payment"` does NOT create a Customer just because
          // `customer_email` is set — `setup_future_usage: "off_session"`
          // alone saves the PM but leaves it orphaned (no Customer attached),
          // which the cron cannot charge. Setting `customer_creation: "always"`
          // forces Stripe to create the Customer + attach the PM post-checkout
          // so `paymentIntent.customer` resolves to a real `cus_xxx`. Full-pay
          // checkouts are unaffected (default remains `"if_required"`).
          // ORCH-0811 customer_update note retained: customer_update would
          // require a pre-existing `customer` id (which we don't have at
          // create time), so it stays omitted; `automatic_tax.enabled: true`
          // collects billing address on the new Customer for tax jurisdiction.
          ...(isInstallmentPlan
            ? { customer_creation: "always" as const }
            : {}),
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

  // ORCH-0844 (2026-05-15) + ORCH-0925 (2026-05-22) — Connect direct-charge
  // mobile config + Customer attachment for installment plans.
  //
  // For full-pay flows this is non-fatal mobile config: PaymentSheet falls
  // back to guest mode (null customer fields) on failure. For installment
  // plans (ORCH-0925) this is FATAL: off-session installment charges require
  // a real Customer with the saved PM attached, so missing customer/PM here
  // means the cron `process-scheduled-installments` cannot charge later and
  // the booking silently loses revenue. We attach `customer: customerId` to
  // the deposit PI for installment plans so `setup_future_usage: "off_session"`
  // correctly binds the PM to the Customer. Full-pay PIs do NOT receive
  // `customer` (preserves existing behavior + Stripe Tax direct-charge shape).
  //
  // Block must run BEFORE paymentIntents.create so customerId is available
  // for piCreateBody construction.
  let customerId: string | null = null;
  let customerEphemeralKeySecret: string | null = null;
  let customerProvisioningError: unknown = null;
  try {
    const stripeForCustomer = stripeTicketCheckout();
    // 3.2.3.a — Idempotent customer lookup by email on the CONNECTED ACCOUNT.
    // The { stripeAccount } request option scopes the search to that account.
    // orch-strict-grep-allow stripe-no-idempotency-key — read-only search; idempotency-key on Stripe search calls is rejected by the API (search is a query, not a mutation).
    const searchResult = await stripeForCustomer.customers.search(
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
      customer = await stripeForCustomer.customers.create(
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
    const ephemeralKey = await stripeForCustomer.ephemeralKeys.create(
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
    customerProvisioningError = customerErr;
    customerId = null;
    customerEphemeralKeySecret = null;
  }

  // ORCH-0925 — for installment plans, customer+PM is FATAL (off-session
  // cron charge cannot proceed without it). For full-pay, fall back to
  // guest-mode PaymentSheet (preserves ORCH-0844 behavior).
  if (isInstallmentPlan && customerId === null) {
    console.error(
      "[ticket-checkout-create] installment plan customer provisioning failed",
      customerProvisioningError instanceof Error
        ? customerProvisioningError.message
        : customerProvisioningError,
    );
    await supabase
      .from("ticket_checkout_sessions")
      .update({
        status: "failed",
        failed_at: new Date().toISOString(),
        failure_reason: "installment_customer_provisioning_failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", checkoutSessionId);
    return jsonResponse(
      {
        error: "installment_customer_provisioning_failed",
        detail: customerProvisioningError instanceof Error
          ? customerProvisioningError.message
          : "unknown",
      },
      502,
    );
  }
  if (!isInstallmentPlan && customerProvisioningError !== null) {
    // Full-pay: log and continue in guest mode (ORCH-0844 behavior preserved).
    console.warn(
      "[ticket-checkout-create] customer+ephemeralKey creation failed; continuing in guest mode",
      customerProvisioningError instanceof Error
        ? customerProvisioningError.message
        : customerProvisioningError,
    );
  }

  const lineItemsRaw = Array.isArray(session.lineItems)
    ? session.lineItems
    : Array.isArray(session.items)
    ? session.items
    : [];
  const rawTaxLineItems = (lineItemsRaw as Array<Record<string, unknown>>)
    .map((line): TaxLineItem => ({
      ticketTypeId: String(line.ticketTypeId ?? ""),
      ticketName: String(line.ticketName ?? "Ticket"),
      quantity: Number(line.quantity ?? 0),
      unitPriceCents: Number(line.unitPriceCents ?? 0),
      totalCents: Number(line.totalCents ?? 0),
    }))
    .filter((line) => line.ticketTypeId.length > 0 && line.totalCents > 0);
  const taxLineItems = normalizeTaxLineItemsForCurrentCharge({
    lineItems: rawTaxLineItems,
    isInstallmentPlan,
    totalCents,
  });

  let taxCalculation: TaxCalculationSummary | null = null;
  if (clientTaxCalculationId !== null && !isInstallmentPlan) {
    try {
      const stripeForExistingTax = stripeTicketCheckout();
      // @ts-ignore -- Stripe SDK Tax namespace is runtime-provided in Deno.
      const existing = await stripeForExistingTax.tax.calculations.retrieve(
        clientTaxCalculationId,
        {},
        { stripeAccount: stripeAccountId },
      );
      const expiresAt = Number(existing.expires_at ?? 0);
      if (existing?.id && expiresAt > Math.floor(Date.now() / 1000)) {
        taxCalculation = {
          id: String(existing.id),
          amount_total: Number(existing.amount_total ?? totalCents),
          tax_breakdown: Array.isArray(existing.tax_breakdown)
            ? existing.tax_breakdown
            : [],
        };
      }
    } catch {
      taxCalculation = null;
    }
  }

  if (taxCalculation === null) {
    try {
      const address = buyerAddress as BuyerAddress;
      const stripeForTax = stripeTicketCheckout();
      // @ts-ignore -- Stripe SDK Tax namespace is runtime-provided in Deno.
      const fresh = await stripeForTax.tax.calculations.create(
        {
          currency,
          line_items: taxLineItems.map((line) => ({
            amount: line.totalCents,
            reference: line.ticketName.slice(0, 200),
            tax_code: "txcd_50010001",
            tax_behavior: "exclusive" as const,
          })),
          customer_details: {
            address: {
              line1: address.line1,
              ...(address.line2 ? { line2: address.line2 } : {}),
              city: address.city,
              ...(address.state ? { state: address.state } : {}),
              postal_code: address.postal,
              country: address.country,
            },
            address_source: "billing" as const,
          },
        },
        { stripeAccount: stripeAccountId },
      );
      taxCalculation = {
        id: String(fresh.id),
        amount_total: Number(fresh.amount_total ?? totalCents),
        tax_breakdown: Array.isArray(fresh.tax_breakdown)
          ? fresh.tax_breakdown
          : [],
      };
    } catch (taxErr) {
      const failure = classifyStripeTaxCalculationFailure(taxErr);
      console.error(
        "[ticket-checkout-create] tax calculation failed",
        failure.detail,
      );
      await supabase
        .from("ticket_checkout_sessions")
        .update({
          status: "failed",
          failed_at: new Date().toISOString(),
          failure_reason: failure.error,
          updated_at: new Date().toISOString(),
        })
        .eq("id", checkoutSessionId);
      return jsonResponse(
        { error: failure.error, detail: failure.detail },
        failure.httpStatus,
      );
    }
  }

  const taxCents = Math.max(0, taxCalculation.amount_total - totalCents);
  await supabase
    .from("ticket_checkout_sessions")
    .update({
      tax_calculation_id: taxCalculation.id,
      tax_amount_cents: taxCents,
      updated_at: new Date().toISOString(),
    })
    .eq("id", checkoutSessionId);

  if (mode === "preview") {
    return jsonResponse({
      kind: "preview",
      checkoutSessionId,
      subtotalCents: totalCents,
      taxCents,
      totalCents: taxCalculation.amount_total,
      currency: String(session.currency ?? "GBP"),
      taxBreakdown: taxCalculation.tax_breakdown,
      calculationId: taxCalculation.id,
      calculationExpiresAt: null,
    });
  }

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
      amount: taxCalculation.amount_total,
      currency,
      // ORCH-0869 [Tr3 Installment Payments]: when deposit is installment-
      // plan-root, save PM for off-session installment charges.
      ...(isInstallmentPlan
        ? { setup_future_usage: "off_session" as const }
        : {}),
      // ORCH-0925: installment plans MUST attach a Stripe Customer so the
      // saved PM binds to the Customer (cron later charges off-session via
      // {customer, payment_method}). customerId is provisioned earlier in
      // this handler (FATAL on failure for installment plans). Full-pay PIs
      // do NOT receive a customer field (preserves ORCH-0843 direct-charge
      // shape + ORCH-0844 guest-mode fallback).
      ...(isInstallmentPlan && customerId !== null
        ? { customer: customerId }
        : {}),
      payment_method_types: [...getPaymentMethodTypes()],
      metadata: {
        mingla_checkout_session_id: checkoutSessionId,
        mingla_event_id: eventId,
        mingla_buyer_email: buyerEmail,
        mingla_tax_calculation_id: taxCalculation.id,
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
      piCreateBody.payment_method_types = [
        ...getInstallmentPaymentMethodTypes(),
      ];
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
    console.error(
      "[ticket-checkout-create] payment intent create failed",
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
    console.error(
      "[ticket-checkout-create] payment intent persist failed",
      persistPaymentError,
    );
    if (stripe !== null) {
      try {
        await cancelPaymentIntentIfClientAvailable(stripe, paymentIntent.id);
      } catch (cancelError) {
        console.error(
          "[ticket-checkout-create] payment intent cancel failed",
          cancelError,
        );
      }
    }
    return jsonResponse(
      {
        error: "payment_session_persist_failed",
        detail: persistPaymentError.message,
      },
      500,
    );
  }

  return jsonResponse({
    kind: "requires_payment",
    checkoutSessionId,
    buyerStatusToken,
    totalCents: taxCalculation.amount_total,
    subtotalCents: totalCents,
    taxCents,
    taxBreakdown: taxCalculation.tax_breakdown,
    currency: String(session.currency ?? "GBP"),
    clientSecret,
    paymentIntentId: paymentIntent.id,
    publishableKey: Deno.env.get("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY") ??
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
