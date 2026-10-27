/**
 * ORCH-1054 — partner splits + Stripe Transfer pipeline.
 *
 * Wires four webhook surfaces:
 *   - charge.succeeded       → resolve partner, record 10% of the 1.5%
 *                              Mingla application fee. Post-cutover rows are
 *                              held for occurrence release; legacy rows use a
 *                              plain platform-balance Stripe Transfer.
 *   - charge.refunded        → reverse the partner share via
 *                              POST /v1/transfers/{id}/reversals.
 *   - charge.dispute.*       → same as refund (reverse if transferred,
 *                              otherwise mark reversed_pending).
 *   - account.updated        → for PARTNER accounts only: populate
 *                              partner_stripe_connect_accounts
 *                              .external_account_currencies from
 *                              account.external_accounts.data[].currency.
 *
 * INVARIANT I-PROPOSED-PARTNER-TRANSFER-SOURCE-CURRENCY:
 *   Stripe Transfer.currency MUST equal source charge.currency. Enforced
 *   in createPartnerTransfer below; ZERO FX.
 *
 * Stripe API references (per feedback-external-api-docs-verified):
 *   - Transfers: https://docs.stripe.com/api/transfers/create
 *     - amount, currency, destination, description,
 *       metadata are the documented payload fields.
 *     - Idempotency-Key required on writes per stripe-best-practices.
 *   - Transfer reversals: https://docs.stripe.com/api/transfer_reversals/create
 *   - account.updated event: https://docs.stripe.com/api/events/types#event_types-account.updated
 *   - account.external_accounts: https://docs.stripe.com/api/external_account_bank_accounts
 */

// @ts-ignore — Deno ESM
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { StripeClient } from "./stripe.ts";
// ORCH-1081 — partner first-split push: fires once when a partner's first
// transferred split lands for a brand. The trigger on partner_splits ALREADY
// stamps partner_brand_links.first_split_at; here we additionally surface a
// push so the partner sees the win in real time.
import { dispatchNotification, formatMoneyCents } from "./stripeEdgeAuth.ts";
import { StripeWebhookRetryableError } from "./stripeWebhookRetry.ts";

// 10% of the 1.5% application fee = 0.15% of GMV.
// The instalment fee rate lives in installments/installmentFeeRate.ts (#3645, #4130)
// (reference; we don't re-import it because partner shares are computed FROM
// the actual fee Stripe charged, not re-derived from total).
export const PARTNER_SHARE_OF_FEE = 0.10 as const;

export interface ChargeSucceededHandlerResult {
  brandId: string | null;
  status:
    | "no_partner"
    | "held"
    | "transferred"
    | "pending_retry"
    | "blocked_no_stripe"
    | "blocked_currency_mismatch"
    | "failed"
    | "no_application_fee"
    | "no_order";
}

function objectString(
  obj: Record<string, unknown>,
  key: string,
): string | null {
  const value = obj[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function objectNumber(
  obj: Record<string, unknown>,
  key: string,
): number | null {
  const value = obj[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

/** Extract application_fee id from a charge object. Stripe may serialize it
 * as a string id or an expanded object. */
function chargeApplicationFeeId(
  charge: Record<string, unknown>,
): string | null {
  const af = charge["application_fee"];
  if (typeof af === "string" && af.length > 0) return af;
  if (af && typeof af === "object") {
    const id = (af as Record<string, unknown>)["id"];
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

/** Extract application_fee_amount (cents) directly from the charge. */
function chargeApplicationFeeAmount(
  charge: Record<string, unknown>,
): number | null {
  const direct = objectNumber(charge, "application_fee_amount");
  if (direct !== null) return direct;
  const af = charge["application_fee"];
  if (af && typeof af === "object") {
    const amt = (af as Record<string, unknown>)["amount"];
    if (typeof amt === "number" && Number.isFinite(amt)) return amt;
  }
  return null;
}

/** Pull mingla_order_id from charge metadata or, fallback, from PI metadata
 * via the supabase orders lookup keyed by stripe_payment_intent_id. */
async function resolveOrderIdForCharge(
  supabase: SupabaseClient,
  charge: Record<string, unknown>,
): Promise<string | null> {
  const md = (charge["metadata"] ?? {}) as Record<string, unknown>;
  const direct = typeof md.mingla_order_id === "string"
    ? md.mingla_order_id
    : null;
  if (direct) return direct;

  const paymentIntentId = objectString(charge, "payment_intent");
  if (!paymentIntentId) return null;
  const { data, error } = await supabase
    .from("orders")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (error) {
    throw new Error(`order lookup failed for charge: ${error.message}`);
  }
  return data?.id ?? null;
}

/** Resolve brand_id for an order via events. orders.brand_id does not exist;
 * orders → events → brands.id is the canonical path. */
async function resolveBrandIdForOrder(
  supabase: SupabaseClient,
  orderId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("event_id, events!inner(brand_id)")
    .eq("id", orderId)
    .maybeSingle();
  if (error) {
    throw new Error(`brand lookup for order failed: ${error.message}`);
  }
  const events = (data as Record<string, unknown> | null)?.events;
  if (!events) return null;
  if (Array.isArray(events)) {
    const first = events[0] as Record<string, unknown> | undefined;
    return (first?.brand_id as string | undefined) ?? null;
  }
  const single = events as Record<string, unknown>;
  return (single.brand_id as string | undefined) ?? null;
}

export interface PartnerStripeAccountRow {
  account_id: string;
  stripe_account_id: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  external_account_currencies: string[];
  detached_at: string | null;
}

export async function getPartnerStripeAccount(
  supabase: SupabaseClient,
  partnerAccountId: string,
): Promise<PartnerStripeAccountRow | null> {
  const { data, error } = await supabase
    .from("partner_stripe_connect_accounts")
    .select(
      "account_id, stripe_account_id, charges_enabled, payouts_enabled, external_account_currencies, detached_at",
    )
    .eq("account_id", partnerAccountId)
    .maybeSingle();
  if (error) {
    throw new Error(`partner stripe lookup failed: ${error.message}`);
  }
  if (!data) return null;
  const raw = data as Record<string, unknown>;
  const rawCurrencies = raw.external_account_currencies;
  const currencies: string[] = Array.isArray(rawCurrencies)
    ? (rawCurrencies as unknown[])
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.toLowerCase())
    : [];
  return {
    account_id: String(raw.account_id),
    stripe_account_id: typeof raw.stripe_account_id === "string"
      ? raw.stripe_account_id
      : null,
    charges_enabled: raw.charges_enabled === true,
    payouts_enabled: raw.payouts_enabled === true,
    external_account_currencies: currencies,
    detached_at: typeof raw.detached_at === "string" ? raw.detached_at : null,
  };
}

async function isAfterBrandPayoutCutover(
  supabase: SupabaseClient,
  brandId: string,
  finalizedAtIso: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("brands")
    .select("payout_hold_cutover_at")
    .eq("id", brandId)
    .maybeSingle();
  if (error) {
    throw new Error(`brand payout cutover lookup failed: ${error.message}`);
  }
  const cutover = (data as Record<string, unknown> | null)
    ?.payout_hold_cutover_at;
  if (typeof cutover !== "string" || cutover.length === 0) return false;
  const cutoverMs = Date.parse(cutover);
  const finalizedMs = Date.parse(finalizedAtIso);
  if (!Number.isFinite(cutoverMs) || !Number.isFinite(finalizedMs)) {
    throw new Error("invalid_partner_split_cutover_timestamp");
  }
  return finalizedMs > cutoverMs;
}

async function resolvePartnerAtChargeTime(
  supabase: SupabaseClient,
  brandId: string,
  chargeCreatedIso: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc(
    "resolve_partner_for_brand_at_time",
    { p_brand_id: brandId, p_at: chargeCreatedIso },
  );
  if (error) {
    throw new Error(
      `resolve_partner_for_brand_at_time failed: ${error.message}`,
    );
  }
  return typeof data === "string" && data.length > 0 ? data : null;
}

/**
 * The single Stripe call into the #1174 writer. Both charge.succeeded (when
 * it carries a fee id) and application_fee.created (#3645) pass the same
 * canonical values — fee id, charge.created, fee amount, currency — so a
 * replay from either event is idempotent and any drift is rejected by the
 * writer's replay-mismatch check.
 */
async function recordStripePartnerOutcome(
  supabase: SupabaseClient,
  input: {
    applicationFeeId: string;
    orderId: string;
    brandId: string;
    partnerAccountId: string | null;
    chargeCreatedIso: string;
    applicationFeeAmount: number;
    currency: string;
  },
): Promise<"no_partner" | "held" | "transferred" | "pending_retry"> {
  const partnerShareCents = Math.round(
    input.applicationFeeAmount * PARTNER_SHARE_OF_FEE,
  );
  const { data: outcomeRow, error: outcomeError } = await supabase.rpc(
    "record_payout_partner_outcome",
    {
      p_key: input.applicationFeeId,
      p_order_id: input.orderId,
      p_brand_id: input.brandId,
      p_partner_account_id: input.partnerAccountId,
      p_provider_sale_at: input.chargeCreatedIso,
      p_mingla_fee_cents: input.applicationFeeAmount,
      p_partner_share_cents: input.partnerAccountId ? partnerShareCents : 0,
      p_currency: input.currency,
      p_provider: "stripe",
    },
  );
  if (outcomeError) {
    throw new Error(
      `record_payout_partner_outcome failed: ${outcomeError.message}`,
    );
  }
  if (!input.partnerAccountId) return "no_partner";
  const status =
    (outcomeRow as { held_status?: string } | null)?.held_status ?? "held";
  if (status === "held") return "held";
  if (status === "transferred") return "transferred";
  return "pending_retry";
}

export interface ApplicationFeeCreatedHandlerResult {
  brandId: string | null;
  status:
    | "no_partner"
    | "held"
    | "transferred"
    | "pending_retry"
    | "pre_cutover"
    | "no_application_fee"
    | "not_ticket_order";
}

/** The stored charge.succeeded payload for a charge (immutable provider
 * evidence written by this endpoint before routing). */
async function loadStoredSucceededCharge(
  supabase: SupabaseClient,
  chargeId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("payment_webhook_events")
    .select("payload")
    .eq("type", "charge.succeeded")
    .eq("payload->data->object->>id", chargeId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`stored charge lookup failed: ${error.message}`);
  }
  const payload = (data as { payload?: unknown } | null)?.payload;
  if (!payload || typeof payload !== "object") return null;
  const obj = ((payload as Record<string, unknown>).data as
    | Record<string, unknown>
    | undefined)?.object;
  return obj && typeof obj === "object"
    ? obj as Record<string, unknown>
    : null;
}

/** A ticket-checkout PaymentIntent (and its charge) carries
 * metadata.mingla_checkout_session_id; installment, venue, stay, RSVP and ad
 * credit charges do not, so they never wait for a ticket order. */
function isTicketCheckoutCharge(charge: Record<string, unknown>): boolean {
  const md = (charge["metadata"] ?? {}) as Record<string, unknown>;
  return typeof md.mingla_checkout_session_id === "string" &&
    md.mingla_checkout_session_id.length > 0 &&
    typeof md.mingla_installment_id !== "string";
}

/**
 * Webhook handler: application_fee.created (#3645).
 *
 * For our direct charges, charge.succeeded carries `application_fee: null`
 * (only `application_fee_amount`) and usually lands before the order row
 * exists, so it can never record the partner outcome. The fee object arrives
 * seconds later with the fee id; this handler records the same immutable
 * outcome through the same #1174 writer:
 *   - order: orders.stripe_charge_id = fee.charge (the order's own sale
 *     charge; later installment charges never match);
 *   - sale time: charge.created from the stored charge.succeeded payload;
 *   - partner: resolve_partner_for_brand_at_time(brand, charge.created);
 *   - only after the brand's payout_hold_cutover_at (same rule as today).
 * A ticket charge whose order or stored charge is not there yet throws
 * StripeWebhookRetryableError so Stripe redelivers instead of the event
 * silently succeeding.
 */
export async function handleApplicationFeeCreated(
  supabase: SupabaseClient,
  event: {
    id: string;
    type: string;
    data: { object: Record<string, unknown> };
  },
): Promise<ApplicationFeeCreatedHandlerResult> {
  const fee = event.data.object;
  const feeId = objectString(fee, "id");
  if (!feeId) throw new Error("application_fee.created missing fee id");
  const feeAmount = objectNumber(fee, "amount");
  const feeCurrency = (objectString(fee, "currency") ?? "").toLowerCase();
  const chargeRef = fee["charge"];
  const chargeId = typeof chargeRef === "string" && chargeRef.length > 0
    ? chargeRef
    : chargeRef && typeof chargeRef === "object"
    ? objectString(chargeRef as Record<string, unknown>, "id")
    : null;
  if (!chargeId || feeAmount === null || feeAmount <= 0) {
    return { brandId: null, status: "no_application_fee" };
  }
  if (feeCurrency.length !== 3) {
    throw new Error("application_fee.created missing currency");
  }

  const { data: orderRow, error: orderError } = await supabase
    .from("orders")
    .select("id")
    .eq("stripe_charge_id", chargeId)
    .maybeSingle();
  if (orderError) {
    throw new Error(`order lookup by charge failed: ${orderError.message}`);
  }
  const orderId = (orderRow as { id?: string } | null)?.id ?? null;

  const charge = await loadStoredSucceededCharge(supabase, chargeId);
  if (!orderId) {
    if (charge && !isTicketCheckoutCharge(charge)) {
      return { brandId: null, status: "not_ticket_order" };
    }
    throw new StripeWebhookRetryableError(
      charge
        ? "partner_attribution_order_pending"
        : "partner_attribution_charge_evidence_pending",
    );
  }
  if (!charge) {
    throw new StripeWebhookRetryableError(
      "partner_attribution_charge_evidence_pending",
    );
  }

  const chargeCreatedUnix = objectNumber(charge, "created");
  if (chargeCreatedUnix === null || chargeCreatedUnix <= 0) {
    throw new Error("stored charge missing canonical charge.created");
  }
  const chargeFeeAmount = objectNumber(charge, "application_fee_amount");
  const chargeCurrency = (objectString(charge, "currency") ?? "")
    .toLowerCase();
  if (
    (chargeFeeAmount !== null && chargeFeeAmount !== feeAmount) ||
    (chargeCurrency.length > 0 && chargeCurrency !== feeCurrency)
  ) {
    // The fee must be the charge's own fee; a mismatch would pin a value
    // charge.succeeded could never replay. Surface it, never guess.
    throw new Error("partner_attribution_fee_charge_mismatch");
  }

  const brandId = await resolveBrandIdForOrder(supabase, orderId);
  if (!brandId) {
    throw new Error("partner_attribution_order_brand_missing");
  }
  const chargeCreatedIso = new Date(chargeCreatedUnix * 1000).toISOString();
  const postCutover = await isAfterBrandPayoutCutover(
    supabase,
    brandId,
    chargeCreatedIso,
  );
  if (!postCutover) return { brandId, status: "pre_cutover" };

  const partnerAccountId = await resolvePartnerAtChargeTime(
    supabase,
    brandId,
    chargeCreatedIso,
  );
  const status = await recordStripePartnerOutcome(supabase, {
    applicationFeeId: feeId,
    orderId,
    brandId,
    partnerAccountId,
    chargeCreatedIso,
    applicationFeeAmount: feeAmount,
    currency: feeCurrency,
  });
  return { brandId, status };
}

/**
 * Webhook handler: charge.succeeded.
 *
 * Flow (idempotent throughout):
 *   1. Extract application_fee_id + amount + currency from the charge.
 *      No application_fee → no partner split possible, exit.
 *   2. Resolve order_id (metadata.mingla_order_id; fallback PI lookup) →
 *      brand_id via events join.
 *   3. resolve_partner_for_brand_at_time(brand_id, charge.created) → if NULL,
 *      no partner currently linked at sale time, exit.
 *   4. partner_share_cents = Math.round(application_fee_amount * 0.10).
 *      Math.round (not floor) so the partner doesn't lose 1 cent to integer
 *      truncation on every transfer.
 *   5. Probe partner Stripe state. Block if not connected OR currency mismatch.
 *   6. record_partner_split_attempt (INSERT pending OR retrieve existing).
 *      If existing row is 'transferred' or 'reversed*' → exit (webhook replay).
 *   7. Stripe Transfers.create with Idempotency-Key =
 *      `partner_split_<application_fee_id>` (per stripe-best-practices).
 *      Cite: https://docs.stripe.com/api/transfers/create
 *   8. On success → mark_partner_split_transferred. On retryable err → leave
 *      'pending', let Stripe redeliver the webhook. On non-retryable →
 *      mark_partner_split_failed.
 */
export async function handleChargeSucceeded(
  supabase: SupabaseClient,
  stripe: StripeClient,
  event: {
    id: string;
    type: string;
    data: { object: Record<string, unknown> };
  },
): Promise<ChargeSucceededHandlerResult> {
  const charge = event.data.object;
  const chargeId = objectString(charge, "id");
  if (!chargeId) {
    throw new Error("charge.succeeded missing charge.id");
  }

  const applicationFeeId = chargeApplicationFeeId(charge);
  const applicationFeeAmount = chargeApplicationFeeAmount(charge);
  if (!applicationFeeId || applicationFeeAmount === null) {
    // Charges without an application_fee — door sales, refunds, or
    // non-platform charges. Nothing to split.
    return { brandId: null, status: "no_application_fee" };
  }

  const currency = (objectString(charge, "currency") ?? "").toLowerCase();
  if (currency.length === 0) {
    throw new Error("charge.succeeded missing currency");
  }

  const orderId = await resolveOrderIdForCharge(supabase, charge);
  if (!orderId) {
    return { brandId: null, status: "no_order" };
  }
  const brandId = await resolveBrandIdForOrder(supabase, orderId);
  if (!brandId) {
    return { brandId: null, status: "no_order" };
  }

  // Pin the partner relationship to charge.created (unix seconds → ISO).
  const chargeCreatedUnix = objectNumber(charge, "created");
  const chargeCreatedIso = chargeCreatedUnix !== null &&
      chargeCreatedUnix > 0
    ? new Date(chargeCreatedUnix * 1000).toISOString()
    : new Date().toISOString();

  const { data: partnerLookup, error: partnerLookupErr } = await supabase.rpc(
    "resolve_partner_for_brand_at_time",
    { p_brand_id: brandId, p_at: chargeCreatedIso },
  );
  if (partnerLookupErr) {
    throw new Error(
      `resolve_partner_for_brand_at_time failed: ${partnerLookupErr.message}`,
    );
  }
  const partnerAccountId =
    typeof partnerLookup === "string" && partnerLookup.length > 0
      ? partnerLookup
      : null;

  // 10% of the application fee. Math.round so we don't steal a cent.
  const partnerShareCents = Math.round(
    applicationFeeAmount * PARTNER_SHARE_OF_FEE,
  );

  const postCutover = await isAfterBrandPayoutCutover(
    supabase,
    brandId,
    chargeCreatedIso,
  );
  if (postCutover) {
    if (chargeCreatedUnix === null || chargeCreatedUnix <= 0) {
      throw new Error("charge.succeeded missing canonical charge.created");
    }
    const status = await recordStripePartnerOutcome(supabase, {
      applicationFeeId,
      orderId,
      brandId,
      partnerAccountId,
      chargeCreatedIso,
      applicationFeeAmount,
      currency,
    });
    return { brandId, status };
  }
  if (!partnerAccountId) {
    return { brandId, status: "no_partner" };
  }

  // Always record the attempt first so we have a forensic row even if we
  // block before Stripe call. ON CONFLICT DO NOTHING handles webhook replay.
  const { data: priorRow, error: recordErr } = await supabase.rpc(
    "record_partner_split_attempt",
    {
      p_application_fee_id: applicationFeeId,
      p_order_id: orderId,
      p_brand_id: brandId,
      p_partner_account_id: partnerAccountId,
      p_mingla_fee_cents: applicationFeeAmount,
      p_partner_share_cents: partnerShareCents,
      p_currency: currency,
    },
  );
  if (recordErr) {
    throw new Error(
      `record_partner_split_attempt failed: ${recordErr.message}`,
    );
  }
  const priorStatus = (priorRow as { status?: string } | null)?.status ??
    "pending";
  if (
    priorStatus === "transferred" || priorStatus === "reversed" ||
    priorStatus === "reversed_pending"
  ) {
    return {
      brandId,
      status: priorStatus === "transferred" ? "transferred" : "no_partner",
    };
  }

  // Partner Stripe eligibility check (after recording the attempt so we can
  // mark the exact blocking reason on the row).
  const partnerStripe = await getPartnerStripeAccount(
    supabase,
    partnerAccountId,
  );
  if (
    !partnerStripe || !partnerStripe.stripe_account_id ||
    partnerStripe.detached_at !== null ||
    !partnerStripe.charges_enabled || !partnerStripe.payouts_enabled
  ) {
    await supabase.rpc("mark_partner_split_failed", {
      p_application_fee_id: applicationFeeId,
      p_reason: "blocked_no_stripe",
      p_error_message: "Partner has no active Stripe Connect account.",
    });
    return { brandId, status: "blocked_no_stripe" };
  }
  if (!partnerStripe.external_account_currencies.includes(currency)) {
    await supabase.rpc("mark_partner_split_failed", {
      p_application_fee_id: applicationFeeId,
      p_reason: "blocked_currency_mismatch",
      p_error_message: `Partner cannot settle in ${currency}. Available: ${
        partnerStripe.external_account_currencies.join(",") || "none"
      }`,
    });
    return { brandId, status: "blocked_currency_mismatch" };
  }

  // ZERO FX invariant: Transfer.currency = charge.currency.
  // Stripe Transfer create:
  //   POST /v1/transfers
  //   https://docs.stripe.com/api/transfers/create
  // #1029: source_transaction is intentionally absent because the source
  // charge belongs to the brand's connected account, not the platform.
  // Per stripe-best-practices: Idempotency-Key required for writes.
  try {
    // @ts-ignore — Stripe SDK Transfers namespace is runtime-provided.
    const transfer = await stripe.transfers.create(
      {
        amount: partnerShareCents,
        currency, // SOURCE CURRENCY — zero FX invariant
        destination: partnerStripe.stripe_account_id,
        description: `Mingla partner share for order ${orderId}`,
        metadata: {
          mingla_application_fee_id: applicationFeeId,
          mingla_order_id: orderId,
          mingla_brand_id: brandId,
          mingla_partner_account_id: partnerAccountId,
          mingla_orch: "ORCH-1054",
        },
      },
      {
        idempotencyKey: `partner_split_${applicationFeeId}`,
      },
    );
    const transferId = String((transfer as { id: string }).id);
    await supabase.rpc("mark_partner_split_transferred", {
      p_application_fee_id: applicationFeeId,
      p_transfer_id: transferId,
    });

    // ORCH-1081 — fire business.partner_first_split when this transfer is the
    // FIRST one for the (partner, brand). Best-effort + idempotent: the
    // notify-dispatch idempotencyKey collapses webhook replays to one push.
    // We detect "first" by checking whether partner_brand_links.first_split_at
    // was previously NULL — the partner_splits trigger sets it in the same
    // transaction, so by the time we get here it's set. The race-safe rule:
    // fire when transferred_at == first_split_at (∆ < 5s) which is true for
    // the first transferred row only.
    try {
      const { data: linkRow } = await supabase
        .from("partner_brand_links")
        .select("first_split_at, accepted_at")
        .eq("partner_account_id", partnerAccountId)
        .eq("brand_id", brandId)
        .is("cancelled_at", null)
        .maybeSingle();
      const firstSplitAt = (linkRow?.first_split_at as string | null) ?? null;
      // Only fire when first_split_at is freshly stamped (within 30s of now).
      // For webhook replays the trigger is a no-op (COALESCE preserves the
      // earliest timestamp), so this comparison stays true ONLY on first.
      const stampedRecently = firstSplitAt !== null &&
        Date.now() - new Date(firstSplitAt).getTime() < 30_000;
      if (stampedRecently) {
        // Resolve brand name + event title for nicer copy. Best-effort.
        const { data: brandRow } = await supabase
          .from("brands")
          .select("name")
          .eq("id", brandId)
          .maybeSingle();
        const brandName = (brandRow?.name as string | null) ?? "your brand";

        let eventTitle: string | null = null;
        const { data: orderRow } = await supabase
          .from("orders")
          .select("event_id")
          .eq("id", orderId)
          .maybeSingle();
        const eventId = (orderRow?.event_id as string | null) ?? null;
        if (eventId) {
          const { data: eventRow } = await supabase
            .from("events")
            .select("title")
            .eq("id", eventId)
            .maybeSingle();
          eventTitle = (eventRow?.title as string | null) ?? null;
        }

        const amount = formatMoneyCents(partnerShareCents, currency);
        const bodySuffix = eventTitle
          ? ` from ${eventTitle}. Tap to see your ledger.`
          : ". Tap to see your ledger.";
        await dispatchNotification({
          userId: partnerAccountId,
          brandId,
          type: "business.partner_first_split",
          title: `Your first split from ${brandName}!`,
          body: `${amount}${bodySuffix}`,
          data: {
            brandName,
            eventTitle: eventTitle ?? undefined,
            amountCents: partnerShareCents,
            currency,
            applicationFeeId,
          },
          relatedId: brandId,
          relatedType: "brand",
          idempotencyKey:
            `business.partner_first_split:${partnerAccountId}:${brandId}`,
          deepLink: `mingla-business://partner/earnings`,
        });
      }
    } catch (firstSplitErr) {
      // Best-effort — never fail the transfer flow on a notify error.
      console.warn(
        "[partner-splits] partner_first_split notify threw (non-fatal):",
        firstSplitErr instanceof Error
          ? firstSplitErr.message
          : String(firstSplitErr),
      );
    }

    return { brandId, status: "transferred" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Retryable: rate_limit, lock_timeout, api_connection_error, api_error.
    // Stripe surfaces these as type fields on StripeError. Be conservative —
    // anything that ISN'T an explicit account-invalid error leaves the row
    // pending so Stripe redelivers and we retry.
    const stripeErr = err as { type?: string; code?: string } | null;
    const errType = stripeErr?.type ?? "";
    const isPermanent = (errType === "StripeInvalidRequestError" &&
      stripeErr?.code !== "balance_insufficient") ||
      errType === "StripePermissionError";
    if (isPermanent) {
      await supabase.rpc("mark_partner_split_failed", {
        p_application_fee_id: applicationFeeId,
        p_reason: "failed",
        p_error_message: msg.slice(0, 1000),
      });
      return { brandId, status: "failed" };
    }
    // Leave pending; rethrow so the webhook returns non-2xx and Stripe retries.
    throw err;
  }
}

/**
 * Webhook handler shared between charge.refunded and charge.dispute.* events.
 *
 * Refund / dispute flow:
 *   1. Resolve the partner_splits row by application_fee_id.
 *   2. If status='transferred' AND stripe_transfer_id present → create
 *      Stripe TransferReversal (POST /v1/transfers/{id}/reversals;
 *      Idempotency-Key = `partner_split_reversal_<application_fee_id>`).
 *      Mark row 'reversed'.
 *   3. If status is pending/blocked/failed → mark 'reversed_pending' (no
 *      Transfer existed, nothing to reverse).
 *
 * NOTE: dispute funds-withdrawn behaviour is handled by Stripe at the
 * application-fee level (Mingla forfeits the fee). Our reversal flow ensures
 * the partner share isn't paid out for a charge that's been disputed/refunded.
 *
 * Stripe docs:
 *   - Transfer reversals: https://docs.stripe.com/api/transfer_reversals/create
 */
export async function handleChargeReversal(
  supabase: SupabaseClient,
  stripe: StripeClient,
  event: {
    id: string;
    type: string;
    data: { object: Record<string, unknown> };
  },
  source: "refund" | "dispute",
): Promise<void> {
  const obj = event.data.object;
  // For charge.refunded the object IS the charge (with application_fee on it).
  // For charge.dispute.* the object IS the dispute (carries charge id).
  let applicationFeeId: string | null = null;
  if (source === "refund") {
    applicationFeeId = chargeApplicationFeeId(obj);
  } else {
    // Dispute path: we need to load the charge to find application_fee_id.
    const chargeRef = objectString(obj, "charge");
    if (!chargeRef) return; // no charge attached → nothing to reverse
    try {
      // @ts-ignore — Stripe SDK Charges namespace is runtime-provided.
      const charge = await stripe.charges.retrieve(chargeRef, {
        idempotencyKey: `partner_split_dispute_lookup_${event.id}`,
      });
      applicationFeeId = chargeApplicationFeeId(
        charge as Record<string, unknown>,
      );
    } catch (lookupErr) {
      console.warn(
        "[partner-splits] dispute charge lookup failed (non-fatal):",
        lookupErr instanceof Error ? lookupErr.message : String(lookupErr),
      );
      return;
    }
  }
  if (!applicationFeeId) return; // no fee → no partner split → no reversal

  if (source === "refund") {
    // Issue #3872 (F5): a refund gives back the partner share in proportion
    // to the application fee Stripe returned; it is no longer a full reversal.
    await reversePartnerShareForRefund(supabase, stripe, obj, applicationFeeId);
    return;
  }

  const { data: row, error } = await supabase
    .from("partner_splits")
    .select("id, status, stripe_transfer_id, partner_share_cents")
    .eq("stripe_application_fee_id", applicationFeeId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `partner_splits lookup for reversal failed: ${error.message}`,
    );
  }
  if (!row) {
    // No partner split was recorded for this charge — common: charge had no
    // partner at sale time. Nothing to reverse.
    return;
  }

  const status = (row as Record<string, unknown>).status as string;
  const transferId = (row as Record<string, unknown>).stripe_transfer_id as
    | string
    | null;
  if (status === "transferred" && transferId) {
    try {
      // Stripe Transfer reversal:
      //   POST /v1/transfers/{transfer_id}/reversals
      //   https://docs.stripe.com/api/transfer_reversals/create
      // @ts-ignore — Stripe SDK Transfers.createReversal runtime-provided.
      const reversal = await stripe.transfers.createReversal(
        transferId,
        {
          // No amount → full reversal. metadata for forensics.
          metadata: {
            mingla_application_fee_id: applicationFeeId,
            mingla_source: source,
            mingla_orch: "ORCH-1054",
          },
        },
        {
          idempotencyKey: `partner_split_reversal_${applicationFeeId}`,
        },
      );
      const reversalId = String((reversal as { id: string }).id);
      await supabase.rpc("mark_partner_split_reversed", {
        p_application_fee_id: applicationFeeId,
        p_reversal_transfer_id: reversalId,
      });
    } catch (reversalErr) {
      // Leave row 'transferred' so a redeliver retries. Surface for ops.
      console.error(
        "[partner-splits] TransferReversal failed:",
        reversalErr instanceof Error
          ? reversalErr.message
          : String(reversalErr),
      );
      throw reversalErr;
    }
  } else {
    // Pending / blocked / failed — no money moved; just record the reversal
    // intent so we don't accidentally transfer later if the row was retried.
    await supabase.rpc("mark_partner_split_reversed", {
      p_application_fee_id: applicationFeeId,
      p_reversal_transfer_id: null,
    });
  }
}

/**
 * Issue #3872 (F5) — proportional partner give-back on `charge.refunded`.
 *
 * The partner share is 10% of Mingla's application fee. Stripe refunds the
 * application fee in proportion when a refund passes refund_application_fee,
 * so the partner gives back:
 *   target = floor(original share x fee refunded / fee)
 * minus what was already given back. The database decides (row lock):
 *   - not yet transferred → reduced in place, no Stripe call;
 *   - transferred → one TransferReversal for the difference, keyed by the
 *     cumulative target (`partner_split_reversal_<fee>_to_<target>`), so a
 *     replayed or out-of-order event can never reverse twice and a second
 *     partial refund reverses only its own part.
 * The refund id is not used in the key: since Stripe API 2022-11-15 a
 * charge.refunded payload no longer lists its refunds, while the cumulative
 * target is derived from Stripe's own application-fee totals.
 *   https://docs.stripe.com/api/application_fees/object (amount_refunded)
 *   https://docs.stripe.com/api/transfer_reversals/create (amount)
 */
export async function reversePartnerShareForRefund(
  supabase: SupabaseClient,
  stripe: StripeClient,
  charge: Record<string, unknown>,
  applicationFeeId: string,
): Promise<void> {
  let feeAmount: number | null = chargeApplicationFeeAmount(charge);
  let feeRefunded: number | null = null;
  const af = charge["application_fee"];
  if (af && typeof af === "object") {
    feeRefunded = objectNumber(af as Record<string, unknown>, "amount_refunded");
  }
  if (feeRefunded === null) {
    // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve of the platform's own fee
    // @ts-ignore — Stripe SDK ApplicationFees namespace is runtime-provided.
    const fee = await stripe.applicationFees.retrieve(applicationFeeId);
    feeRefunded = objectNumber(fee as Record<string, unknown>, "amount_refunded");
    feeAmount = objectNumber(fee as Record<string, unknown>, "amount") ?? feeAmount;
  }
  if (feeAmount === null || feeAmount <= 0 || feeRefunded === null) {
    throw new Error(`partner split refund: fee totals unavailable for ${applicationFeeId}`);
  }

  const { data: plan, error: planError } = await supabase.rpc(
    "issue_3872_partner_split_refund_plan",
    {
      p_application_fee_id: applicationFeeId,
      p_fee_amount_cents: feeAmount,
      p_fee_refunded_cents: feeRefunded,
    },
  );
  if (planError) {
    throw new Error(`partner split refund plan failed: ${planError.message}`);
  }
  const outcome = (plan as Record<string, unknown> | null)?.outcome;
  if (outcome !== "reverse") return; // reduced in place, nothing due, or no split

  const planRow = plan as Record<string, unknown>;
  const transferId = String(planRow.transfer_id ?? "");
  const target = Number(planRow.target_reversed_cents);
  const amount = Number(planRow.reverse_cents);
  if (!transferId || !Number.isInteger(target) || !Number.isInteger(amount) || amount <= 0) {
    throw new Error(`partner split refund plan malformed for ${applicationFeeId}`);
  }
  // @ts-ignore — Stripe SDK Transfers.createReversal runtime-provided.
  const reversal = await stripe.transfers.createReversal(
    transferId,
    {
      amount,
      metadata: {
        mingla_application_fee_id: applicationFeeId,
        mingla_source: "refund",
        mingla_target_reversed_cents: String(target),
        mingla_issue: "3872",
      },
    },
    { idempotencyKey: `partner_split_reversal_${applicationFeeId}_to_${target}` },
  );
  const { error: recordError } = await supabase.rpc(
    "issue_3872_partner_split_record_reversal",
    {
      p_application_fee_id: applicationFeeId,
      p_target_reversed_cents: target,
      p_reversal_id: String((reversal as { id: string }).id),
    },
  );
  if (recordError) {
    // The Stripe call is idempotent on the same key: a redelivery repeats it
    // safely and records again.
    throw new Error(`partner split reversal record failed: ${recordError.message}`);
  }
}

/**
 * Webhook handler: account.updated for PARTNER accounts.
 *
 * Called from the existing account.updated branch in stripeWebhookRouter
 * AFTER the brand-account path has run. Matches the Stripe account id against
 * partner_stripe_connect_accounts.stripe_account_id; if present, updates:
 *   - charges_enabled, payouts_enabled, requirements, capabilities
 *   - external_account_currencies (deduped lowercase set drawn from
 *     account.external_accounts.data[].currency)
 *
 * This closes the ORCH-1052 gate: until external_account_currencies is
 * populated, partner_can_accept_brand denies by default.
 *
 * Stripe docs:
 *   - account.updated event: https://docs.stripe.com/api/events/types#event_types-account.updated
 *   - external_accounts on Account: https://docs.stripe.com/api/accounts/object#account_object-external_accounts
 */
export async function syncPartnerAccountFromEvent(
  supabase: SupabaseClient,
  account: Record<string, unknown>,
): Promise<boolean> {
  const stripeAccountId = objectString(account, "id");
  if (!stripeAccountId) return false;

  // Match against partner table; if no row, this is a brand-only account
  // (or unknown) and we exit silently.
  const { data: partnerRow, error: lookupErr } = await supabase
    .from("partner_stripe_connect_accounts")
    .select("account_id")
    .eq("stripe_account_id", stripeAccountId)
    .maybeSingle();
  if (lookupErr) {
    throw new Error(`partner account lookup failed: ${lookupErr.message}`);
  }
  if (!partnerRow) return false;

  // Extract distinct lowercase currencies from external_accounts.data[].
  // external_accounts is included on the Account object as a paginated list:
  // https://docs.stripe.com/api/accounts/object#account_object-external_accounts
  const ext = account["external_accounts"] as
    | Record<string, unknown>
    | undefined;
  const extData = (ext?.["data"] ?? []) as Array<Record<string, unknown>>;
  const currencySet = new Set<string>();
  for (const e of extData) {
    const c = objectString(e, "currency");
    if (c) currencySet.add(c.toLowerCase());
  }
  const currencies = Array.from(currencySet).sort();

  const requirements = (account.requirements ?? {}) as Record<string, unknown>;
  const capabilities = (account.capabilities ?? {}) as Record<string, unknown>;

  const update: Record<string, unknown> = {
    charges_enabled: account.charges_enabled === true,
    payouts_enabled: account.payouts_enabled === true,
    requirements,
    capabilities,
    external_account_currencies: currencies,
    updated_at: new Date().toISOString(),
  };

  const { error: updateErr } = await supabase
    .from("partner_stripe_connect_accounts")
    .update(update)
    .eq("stripe_account_id", stripeAccountId);
  if (updateErr) {
    throw new Error(
      `partner account update failed: ${updateErr.message}`,
    );
  }
  return true;
}
