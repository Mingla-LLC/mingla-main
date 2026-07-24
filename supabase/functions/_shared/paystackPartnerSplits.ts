/**
 * paystackPartnerSplits — ORCH-1331 [partner Paystack payout rail].
 *
 * The Paystack twin of _shared/partnerSplits.ts (Stripe rail): on a verified
 * NGN `charge.success` whose order finalized, record a partner_splits row and
 * pay the partner 10% of Mingla's persisted platform fee via a POST-HOC
 * Paystack Transfer from Mingla's Balance (SPEC §4.1 Option B — the LIVE
 * checkout initialize call is NEVER touched).
 *
 * CONSTITUTIONAL (I-PROPOSED-1331-PARTNER-SPLIT-FAIL-SOFT): this module is
 * invoked from paystack-webhook inside a dedicated catch-and-log wrapper. A
 * split failure can NEVER fail, delay, or alter the ack of a ticket checkout,
 * an order finalize, or the charge.success webhook.
 *
 * COMMERCIAL CONTRACT (I-PROPOSED-1331-PARTNER-SHARE-FROM-PLATFORM-FEE):
 *   partnerShareKobo = Math.round(minglaFeeKobo * PARTNER_SHARE_OF_FEE)
 * where minglaFeeKobo = orders.stripe_application_fee_amount_cents (the
 * Paystack flat `transaction_charge` skim persisted by finalize) and
 * PARTNER_SHARE_OF_FEE is IMPORTED from _shared/partnerSplits.ts — one
 * constant, never duplicated. The share always comes out of Mingla's cut,
 * never the brand's settlement, never the buyer's total. Zero FX: the rail is
 * NGN-only (transfer_currency = charge currency = 'ngn').
 *
 * TRANSFER IDEMPOTENCY (SPEC §4.1): Paystack has no Idempotency-Key header;
 * the transfer `reference` IS the key. reference = "psplit_<id>_a<attempt>".
 * attempt_count bumps ONLY on a DEFINITIVE failure (transfer.failed webhook /
 * unambiguous 4xx); ambiguous outcomes (timeout, 5xx, 429, insufficient
 * balance) re-use the same reference so a duplicate can never pay twice.
 *
 * Paystack docs: https://paystack.com/docs/api/transfer/ +
 * https://paystack.com/docs/transfers/single-transfers/ (OTP + reference
 * retry semantics). Reference: Mingla_Artifacts/PAYSTACK_INTEGRATION_REFERENCE.md
 */

// @ts-ignore — Deno ESM
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
// SINGLE SOURCE of the share rate (I-PROPOSED-1331-PARTNER-SHARE-FROM-PLATFORM-FEE).
import { PARTNER_SHARE_OF_FEE } from "./partnerSplits.ts";
import {
  PaystackApiError,
  paystackFetchTransfer,
  paystackInitiateTransfer,
} from "./paystack.ts";
import { sendOpsAlertEmail } from "./stripeOpsAlertEmail.ts";
import { dispatchNotification, formatMoneyCents } from "./stripeEdgeAuth.ts";
import { writeAudit } from "./audit.ts";

/** Definitive-failure cap: at the 5th burned attempt the row finalizes 'failed'. */
export const MAX_PAYSTACK_TRANSFER_ATTEMPTS = 5;

/** Ops-alert recipients (SPEC binds seth@usemingla.com as the default). */
export function paystackPartnerAlertRecipients(): string[] {
  const raw = Deno.env.get("PAYSTACK_PARTNER_ALERT_EMAILS") ??
    "seth@usemingla.com";
  return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

// Dependency injection (mirrors the PaystackVerifier injection in
// paystackWebhookRouter.ts) so tests stub the network deterministically.
export interface PaystackPartnerSplitDeps {
  initiateTransfer: typeof paystackInitiateTransfer;
  fetchTransfer: typeof paystackFetchTransfer;
  sendOpsAlert: typeof sendOpsAlertEmail;
  notify: typeof dispatchNotification;
}

export function defaultPaystackPartnerSplitDeps(): PaystackPartnerSplitDeps {
  return {
    initiateTransfer: paystackInitiateTransfer,
    fetchTransfer: paystackFetchTransfer,
    sendOpsAlert: sendOpsAlertEmail,
    notify: dispatchNotification,
  };
}

export interface PaystackSplitArgs {
  /** The verified Paystack transaction reference (charge.success). */
  reference: string;
  /** The finalized Mingla order id. */
  orderId: string;
  /** Verified txn paid_at (ISO) — pins the partner relationship at sale time. */
  paidAtIso: string | null;
}

export interface PaystackSplitResult {
  brandId: string | null;
  status:
    | "held"
    | "transferred"
    | "pending"
    | "blocked_no_paystack"
    | "blocked_currency_mismatch"
    | "no_partner"
    | "no_application_fee"
    | "no_order"
    | "failed";
}

/** Context for a single transfer attempt against a pending split row. */
export interface SplitAttemptContext {
  id: string;
  /** stripe_application_fee_id — 'paystack:' + reference (the ledger key). */
  key: string;
  orderId: string;
  brandId: string;
  partnerAccountId: string;
  partnerShareCents: number;
  attemptCount: number;
  errorMessage: string | null;
  recipientCode: string;
}

interface ActiveRecipient {
  recipientCode: string;
}

/** Load the partner's ACTIVE Paystack recipient (null when absent/detached). */
export async function resolveActivePaystackRecipient(
  supabase: SupabaseClient,
  partnerAccountId: string,
): Promise<ActiveRecipient | null> {
  const { data, error } = await supabase
    .from("partner_paystack_accounts")
    .select("recipient_code, detached_at")
    .eq("account_id", partnerAccountId)
    .maybeSingle();
  if (error) {
    throw new Error(`partner paystack lookup failed: ${error.message}`);
  }
  if (!data) return null;
  const raw = data as Record<string, unknown>;
  const recipientCode = typeof raw.recipient_code === "string" &&
      raw.recipient_code.length > 0
    ? raw.recipient_code
    : null;
  const detached = raw.detached_at !== null && raw.detached_at !== undefined;
  if (!recipientCode || detached) return null;
  return { recipientCode };
}

/** Resolve brand_id for an order via events (orders has NO brand_id column —
 * orders → events → brands.id is the canonical path, mirror of
 * partnerSplits.ts resolveBrandIdForOrder). */
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

/** Direct service-role error_message note on a still-pending row (retryable /
 * ambiguous outcomes — attempt_count is NOT bumped; same reference re-used). */
async function noteSplitError(
  supabase: SupabaseClient,
  key: string,
  message: string,
): Promise<void> {
  const { error } = await supabase
    .from("partner_splits")
    .update({ error_message: message.slice(0, 1000) })
    .eq("stripe_application_fee_id", key)
    .eq("status", "pending");
  if (error) {
    console.warn(
      "[paystack-partner-splits] error_message note failed (non-fatal):",
      error.message,
    );
  }
}

/**
 * ORCH-1081 mirror — fire business.partner_first_split when this transfer is
 * the FIRST for the (partner, brand). Same 30s stamped-recently window, same
 * idempotencyKey (collapses webhook replays to one push), same deep link.
 * Best-effort: never fails the transfer flow.
 */
async function fireFirstSplitPush(
  supabase: SupabaseClient,
  deps: PaystackPartnerSplitDeps,
  args: {
    partnerAccountId: string;
    brandId: string;
    orderId: string;
    partnerShareCents: number;
    currency: string;
  },
): Promise<void> {
  try {
    const { data: linkRow } = await supabase
      .from("partner_brand_links")
      .select("first_split_at, accepted_at")
      .eq("partner_account_id", args.partnerAccountId)
      .eq("brand_id", args.brandId)
      .is("cancelled_at", null)
      .maybeSingle();
    const firstSplitAt = (linkRow?.first_split_at as string | null) ?? null;
    const stampedRecently = firstSplitAt !== null &&
      Date.now() - new Date(firstSplitAt).getTime() < 30_000;
    if (!stampedRecently) return;

    const { data: brandRow } = await supabase
      .from("brands")
      .select("name")
      .eq("id", args.brandId)
      .maybeSingle();
    const brandName = (brandRow?.name as string | null) ?? "your brand";

    let eventTitle: string | null = null;
    const { data: orderRow } = await supabase
      .from("orders")
      .select("event_id")
      .eq("id", args.orderId)
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

    const amount = formatMoneyCents(args.partnerShareCents, args.currency);
    const bodySuffix = eventTitle
      ? ` from ${eventTitle}. Tap to see your ledger.`
      : ". Tap to see your ledger.";
    await deps.notify({
      userId: args.partnerAccountId,
      brandId: args.brandId,
      type: "business.partner_first_split",
      title: `Your first split from ${brandName}!`,
      body: `${amount}${bodySuffix}`,
      data: {
        brandName,
        eventTitle: eventTitle ?? undefined,
        amountCents: args.partnerShareCents,
        currency: args.currency,
      },
      relatedId: args.brandId,
      relatedType: "brand",
      idempotencyKey:
        `business.partner_first_split:${args.partnerAccountId}:${args.brandId}`,
      deepLink: `mingla-business://partner/earnings`,
    });
  } catch (firstSplitErr) {
    // Best-effort — never fail the transfer flow on a notify error.
    console.warn(
      "[paystack-partner-splits] partner_first_split notify threw (non-fatal):",
      firstSplitErr instanceof Error
        ? firstSplitErr.message
        : String(firstSplitErr),
    );
  }
}

/** Classify a synchronous transfer error. Ambiguous/retryable outcomes keep
 * the SAME reference (no attempt bump); definitive 4xx burns the attempt. */
function classifyTransferError(
  err: unknown,
): { kind: "retryable" | "definitive"; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const isBalance = /insufficient/i.test(message) || /balance/i.test(message);
  if (isBalance) return { kind: "retryable", message };
  // P2-1331-DUPLICATE-REFERENCE-SHAPE defense-in-depth (REWORK): the rail's
  // double-pay defense assumes Paystack's documented behavior that re-using a
  // reference returns the ORIGINAL transfer. If live Paystack instead answers
  // a 4xx "duplicate/already exists" error for a re-used reference, minting a
  // NEW reference could double-pay the in-flight original — so re-using the
  // SAME reference (retryable, no attempt bump) is the only money-safe
  // posture. Over-matching errs toward a stalled-pending row (recoverable,
  // visible in error_message), never toward a double payment.
  const isDuplicateReference = /duplicate/i.test(message) ||
    /reference.*(exists|already)/i.test(message);
  if (isDuplicateReference) return { kind: "retryable", message };
  if (err instanceof PaystackApiError) {
    if (err.status >= 500 || err.status === 429) {
      return { kind: "retryable", message };
    }
    return { kind: "definitive", message };
  }
  // Network / timeout / non-HTTP throw — ambiguous; the transfer MAY have gone
  // through. Same reference on retry so a duplicate can never pay twice.
  return { kind: "retryable", message };
}

/**
 * Attempt (or re-attempt) the Paystack Transfer for a pending split row.
 * SPEC §4.5.2 — returns the row's resulting posture.
 */
export async function attemptTransferForSplit(
  supabase: SupabaseClient,
  ctx: SplitAttemptContext,
  deps: PaystackPartnerSplitDeps = defaultPaystackPartnerSplitDeps(),
): Promise<"transferred" | "pending" | "failed"> {
  // §4.1 idempotency contract: reference = psplit_<id>_a<attempt_count>.
  const reference = `psplit_${ctx.id}_a${ctx.attemptCount}`;

  try {
    const transfer = await deps.initiateTransfer({
      amountSubunits: ctx.partnerShareCents,
      recipientCode: ctx.recipientCode,
      reference,
      reason: `Mingla partner share for order ${ctx.orderId}`,
    });
    const transferStatus = String(transfer.status ?? "").toLowerCase();

    if (transferStatus === "success") {
      await supabase.rpc("mark_partner_split_transferred", {
        p_application_fee_id: ctx.key,
        p_transfer_id: transfer.transfer_code,
      });
      await fireFirstSplitPush(supabase, deps, {
        partnerAccountId: ctx.partnerAccountId,
        brandId: ctx.brandId,
        orderId: ctx.orderId,
        partnerShareCents: ctx.partnerShareCents,
        currency: "ngn",
      });
      return "transferred";
    }

    if (transferStatus === "otp") {
      // OPS-2 unmet (transfer OTP still enabled). Retryable OPERATIONAL block:
      // do NOT burn the attempt; note the row; ONE ops alert (deduped on the
      // prior error_message).
      const alreadyAlerted = ctx.errorMessage === "otp_required";
      await noteSplitError(supabase, ctx.key, "otp_required");
      if (!alreadyAlerted) {
        await deps.sendOpsAlert({
          subject:
            "[Mingla ops] Paystack partner transfer blocked: OTP enabled",
          paragraphs: [
            'A Paystack partner transfer returned status "otp" — transfer OTP confirmation is still enabled on the Mingla Paystack integration (OPS-2).',
            `Split row: ${ctx.id} (order ${ctx.orderId}, ${ctx.partnerShareCents} kobo).`,
            'Disable "Confirm transfers before sending" (Dashboard → Settings → Preferences) or run the Transfer Control disable_otp flow. The retry sweep re-attempts every 30 minutes.',
          ],
          recipients: paystackPartnerAlertRecipients(),
        });
      }
      return "pending";
    }

    // "pending" (and any other in-flight status): transfer initiated —
    // stamp the reference + transfer_code; transfer.success flips the row.
    await supabase.rpc("mark_paystack_partner_split_attempted", {
      p_key: ctx.key,
      p_payout_reference: reference,
      p_transfer_code: transfer.transfer_code,
    });
    return "pending";
  } catch (err) {
    const { kind, message } = classifyTransferError(err);
    if (kind === "retryable") {
      // Ambiguous / operational (insufficient balance, 5xx, 429, network):
      // leave pending, note the error, SAME reference next sweep.
      await noteSplitError(supabase, ctx.key, message);
      return "pending";
    }
    // Definitive 4xx (invalid recipient, malformed): burn the attempt so the
    // next try uses a NEW reference; finalize 'failed' + ops alert at the cap.
    await supabase.rpc("bump_paystack_partner_split_attempt", {
      p_key: ctx.key,
      p_error: message.slice(0, 1000),
    });
    if (ctx.attemptCount + 1 >= MAX_PAYSTACK_TRANSFER_ATTEMPTS) {
      await supabase.rpc("mark_partner_split_failed", {
        p_application_fee_id: ctx.key,
        p_reason: "failed",
        p_error_message: message.slice(0, 1000),
      });
      await deps.sendOpsAlert({
        subject: "[Mingla ops] Paystack partner split failed permanently",
        paragraphs: [
          `Partner split ${ctx.id} (order ${ctx.orderId}) exhausted ${MAX_PAYSTACK_TRANSFER_ATTEMPTS} transfer attempts and is finalized 'failed'.`,
          `Last error: ${message.slice(0, 500)}`,
        ],
        recipients: paystackPartnerAlertRecipients(),
      });
      return "failed";
    }
    return "pending";
  }
}

/**
 * SPEC §4.5.1 — the charge.success split fan-out. Called from paystack-webhook
 * AFTER finalize resolves (finalized OR replayed — replay re-entry is safe;
 * the UNIQUE ledger key dedupes). May throw internally; the webhook wiring
 * (§4.6) wraps the call in a catch-and-log block so ticketing is untouched.
 */
export async function handlePaystackPartnerSplit(
  supabase: SupabaseClient,
  args: PaystackSplitArgs,
  deps: PaystackPartnerSplitDeps = defaultPaystackPartnerSplitDeps(),
): Promise<PaystackSplitResult> {
  const key = `paystack:${args.reference}`;

  // 1. Fee lookup — the commercial source of truth. orders.stripe_application_
  // fee_amount_cents = the Paystack flat transaction_charge skim persisted by
  // biz_ticket_checkout_finalize. NULL/0 → no Mingla fee → nothing to split
  // (the partner share NEVER comes from the brand's share —
  // I-PROPOSED-1331-PARTNER-SHARE-FROM-PLATFORM-FEE).
  const { data: orderRow, error: orderErr } = await supabase
    .from("orders")
    .select("id, currency, stripe_application_fee_amount_cents")
    .eq("id", args.orderId)
    .maybeSingle();
  if (orderErr) {
    throw new Error(`order lookup for split failed: ${orderErr.message}`);
  }
  if (!orderRow) {
    return { brandId: null, status: "no_order" };
  }
  const rawFee = (orderRow as Record<string, unknown>)
    .stripe_application_fee_amount_cents;
  const minglaFeeKobo = typeof rawFee === "number" && Number.isFinite(rawFee)
    ? rawFee
    : 0;
  if (minglaFeeKobo <= 0) {
    return { brandId: null, status: "no_application_fee" };
  }
  const orderCurrency = String(
    (orderRow as Record<string, unknown>).currency ?? "",
  ).toUpperCase();

  // 2. Brand via the canonical orders → events join.
  const brandId = await resolveBrandIdForOrder(supabase, args.orderId);
  if (!brandId) {
    return { brandId: null, status: "no_order" };
  }

  // 3. Pin the partner relationship to the verified paid_at moment.
  const pinIso = args.paidAtIso ?? new Date().toISOString();
  const { data: partnerLookup, error: partnerLookupErr } = await supabase.rpc(
    "resolve_partner_for_brand_at_time",
    { p_brand_id: brandId, p_at: pinIso },
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

  // 4. Share math — EXACT Stripe mirror, to the kobo. Math.round, not floor
  // ("so we don't steal a cent"). Rate imported from _shared/partnerSplits.ts.
  const partnerShareKobo = Math.round(minglaFeeKobo * PARTNER_SHARE_OF_FEE);

  if (await isAfterBrandPayoutCutover(supabase, brandId, pinIso)) {
    if (!args.paidAtIso || !Number.isFinite(Date.parse(args.paidAtIso))) {
      throw new Error("paystack charge missing canonical paid_at");
    }
    const { data: outcomeRow, error: outcomeError } = await supabase.rpc(
      "record_payout_partner_outcome",
      {
        p_key: key,
        p_order_id: args.orderId,
        p_brand_id: brandId,
        p_partner_account_id: partnerAccountId,
        p_provider_sale_at: pinIso,
        p_mingla_fee_cents: minglaFeeKobo,
        p_partner_share_cents: partnerAccountId ? partnerShareKobo : 0,
        p_currency: "ngn",
        p_provider: "paystack",
      },
    );
    if (outcomeError) {
      throw new Error(
        `record_payout_partner_outcome failed: ${outcomeError.message}`,
      );
    }
    if (!partnerAccountId) {
      return { brandId, status: "no_partner" };
    }
    const heldStatus =
      (outcomeRow as { held_status?: string } | null)?.held_status ?? "held";
    if (heldStatus === "held") return { brandId, status: "held" };
    if (heldStatus === "transferred") {
      return { brandId, status: "transferred" };
    }
    return { brandId, status: "pending" };
  }
  if (!partnerAccountId) {
    return { brandId, status: "no_partner" };
  }

  // 5. Record the attempt FIRST (forensic row even when blocked). Idempotent.
  const { data: recordRow, error: recordErr } = await supabase.rpc(
    "record_paystack_partner_split_attempt",
    {
      p_reference: args.reference,
      p_order_id: args.orderId,
      p_brand_id: brandId,
      p_partner_account_id: partnerAccountId,
      p_mingla_fee_cents: minglaFeeKobo,
      p_partner_share_cents: partnerShareKobo,
    },
  );
  if (recordErr) {
    throw new Error(
      `record_paystack_partner_split_attempt failed: ${recordErr.message}`,
    );
  }
  const record = (recordRow ?? {}) as {
    id?: string;
    status?: string;
    attempt_count?: number;
    error_message?: string | null;
  };
  const priorStatus = record.status ?? "pending";
  if (
    priorStatus === "transferred" || priorStatus === "reversed" ||
    priorStatus === "reversed_pending"
  ) {
    // Webhook replay — mirrors partnerSplits.ts:289-293.
    return {
      brandId,
      status: priorStatus === "transferred" ? "transferred" : "no_partner",
    };
  }
  if (
    priorStatus === "blocked_no_paystack" ||
    priorStatus === "blocked_currency_mismatch" || priorStatus === "failed"
  ) {
    // Terminal-blocked replay: the sweep never selects these; do not re-attempt.
    return {
      brandId,
      status: priorStatus as PaystackSplitResult["status"],
    };
  }
  const splitId = record.id ?? "";
  if (splitId.length === 0) {
    throw new Error("record_paystack_partner_split_attempt returned no id");
  }

  // 6. Eligibility.
  const recipient = await resolveActivePaystackRecipient(
    supabase,
    partnerAccountId,
  );
  if (!recipient) {
    await supabase.rpc("mark_partner_split_failed", {
      p_application_fee_id: key,
      p_reason: "blocked_no_paystack",
      p_error_message: "Partner has no active Paystack payout account.",
    });
    return { brandId, status: "blocked_no_paystack" };
  }
  // Defensive zero-FX guard (checkout already hard-gates NGN): the rail pays
  // NGN only; a non-NGN order can never ride it.
  if (orderCurrency !== "NGN") {
    await supabase.rpc("mark_partner_split_failed", {
      p_application_fee_id: key,
      p_reason: "blocked_currency_mismatch",
      p_error_message: `Paystack partner rail is NGN-only; order currency is ${
        orderCurrency || "unknown"
      }.`,
    });
    return { brandId, status: "blocked_currency_mismatch" };
  }

  // 7. Transfer attempt.
  const outcome = await attemptTransferForSplit(supabase, {
    id: splitId,
    key,
    orderId: args.orderId,
    brandId,
    partnerAccountId,
    partnerShareCents: partnerShareKobo,
    attemptCount: record.attempt_count ?? 0,
    errorMessage: record.error_message ?? null,
    recipientCode: recipient.recipientCode,
  }, deps);
  return { brandId, status: outcome };
}

/**
 * SPEC §4.5.3 — transfer.* webhook events. Non-matching references (not our
 * psplit_ prefix) are a no-op so future non-partner transfers are unaffected.
 */
export async function handlePaystackTransferEvent(
  supabase: SupabaseClient,
  eventName: string,
  data: Record<string, unknown>,
  deps: PaystackPartnerSplitDeps = defaultPaystackPartnerSplitDeps(),
): Promise<void> {
  const reference = typeof data?.reference === "string" ? data.reference : "";
  const match = reference.match(/^psplit_(.+)_a(\d+)$/);
  if (!match) return;
  const splitId = match[1];
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(splitId)
  ) {
    return;
  }

  const { data: row, error } = await supabase
    .from("partner_splits")
    .select(
      "id, status, stripe_application_fee_id, stripe_transfer_id, attempt_count, partner_account_id, brand_id, order_id, partner_share_cents, transfer_currency",
    )
    .eq("id", splitId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `partner_splits lookup for transfer event failed: ${error.message}`,
    );
  }
  if (!row) return;
  const r = row as Record<string, unknown>;
  const key = String(r.stripe_application_fee_id ?? "");
  const status = String(r.status ?? "");
  const attemptCount = Number(r.attempt_count ?? 0);
  const transferCode = typeof data?.transfer_code === "string"
    ? data.transfer_code
    : (typeof r.stripe_transfer_id === "string" ? r.stripe_transfer_id : null);

  if (eventName === "transfer.success") {
    // Idempotent — the RPC only flips pending|failed.
    await supabase.rpc("mark_partner_split_transferred", {
      p_application_fee_id: key,
      p_transfer_id: transferCode,
    });
    await fireFirstSplitPush(supabase, deps, {
      partnerAccountId: String(r.partner_account_id ?? ""),
      brandId: String(r.brand_id ?? ""),
      orderId: String(r.order_id ?? ""),
      partnerShareCents: Number(r.partner_share_cents ?? 0),
      currency: String(r.transfer_currency ?? "ngn"),
    });
    return;
  }

  if (eventName === "transfer.failed") {
    // Definitive failure — burn the attempt (new reference next sweep).
    if (status !== "pending") return; // late/duplicate event on a settled row

    // P1-1331-STALE-TRANSFER-CODE (REWORK) idempotency guard: only a
    // DEFINITIVE failure of the row's CURRENT in-flight transfer burns the
    // attempt. The in-flight transfer is identified by the row's
    // stripe_transfer_id and its reference psplit_<id>_a<attempt_count>
    // (attempt_count is unchanged between initiate and the definitive bump).
    //  * row has NO transfer code → already cleared by a prior bump (or never
    //    stamped): a replayed transfer.failed is a no-op — no double-bump.
    //  * event transfer_code ≠ row's current code → stale event for an OLDER
    //    attempt: no-op — never bump for, or clear, a DIFFERENT in-flight
    //    transfer (that would re-open the double-initiate seam).
    //  * event reference attempt ≠ row attempt_count → same staleness, for
    //    payloads that omit transfer_code.
    const currentTransferCode = typeof r.stripe_transfer_id === "string" &&
        r.stripe_transfer_id.length > 0
      ? r.stripe_transfer_id
      : null;
    if (!currentTransferCode) return;
    const eventTransferCode = typeof data?.transfer_code === "string"
      ? data.transfer_code
      : null;
    if (
      eventTransferCode !== null && eventTransferCode !== currentTransferCode
    ) {
      return;
    }
    const eventAttempt = Number(match[2]);
    if (eventAttempt !== attemptCount) return;

    const reason = typeof data?.reason === "string"
      ? data.reason
      : (typeof data?.message === "string" ? data.message : "transfer.failed");
    await supabase.rpc("bump_paystack_partner_split_attempt", {
      p_key: key,
      p_error: reason.slice(0, 1000),
    });
    if (attemptCount + 1 >= MAX_PAYSTACK_TRANSFER_ATTEMPTS) {
      await supabase.rpc("mark_partner_split_failed", {
        p_application_fee_id: key,
        p_reason: "failed",
        p_error_message: reason.slice(0, 1000),
      });
      await deps.sendOpsAlert({
        subject: "[Mingla ops] Paystack partner split failed permanently",
        paragraphs: [
          `Partner split ${splitId} exhausted ${MAX_PAYSTACK_TRANSFER_ATTEMPTS} transfer attempts (transfer.failed) and is finalized 'failed'.`,
          `Last reason: ${reason.slice(0, 500)}`,
        ],
        recipients: paystackPartnerAlertRecipients(),
      });
      return;
    }
    // P1-1331-STALE-TRANSFER-CODE (REWORK): the failed transfer is DEAD for
    // this exact code — clear stripe_transfer_id (+ the stale
    // payout_reference) so the reconcile-first sweep takes the INITIATE path
    // with the bumped psplit_<id>_a<attempt+1> reference instead of
    // re-reconciling the dead transfer forever (SC-9 / SPEC §4.5.3 "row stays
    // pending — sweep retries with new reference"). Mirrors the
    // reconcile-reversed clear in partner-paystack-split-retry/index.ts.
    // At the cap (above) the code is intentionally KEPT on the finalized
    // 'failed' row for forensics.
    const { error: clearErr } = await supabase
      .from("partner_splits")
      .update({ stripe_transfer_id: null, payout_reference: null })
      .eq("id", splitId)
      .eq("status", "pending");
    if (clearErr) {
      throw new Error(
        `failed transfer_code clear failed: ${clearErr.message}`,
      );
    }
    return;
  }

  if (eventName === "transfer.reversed") {
    // Bank returned the funds AFTER success — money is back in Mingla's
    // balance. BINDING (SPEC §4.5.3): back to pending for re-attempt; the
    // sweep retries (cap → failed). first_split_at, if stamped, stays
    // (COALESCE semantics — the money is re-sent or ops-resolved).
    if (status !== "transferred") return;
    const { error: revertErr } = await supabase
      .from("partner_splits")
      .update({
        status: "pending",
        error_message: "transfer_reversed_by_bank",
        transferred_at: null,
        stripe_transfer_id: null,
        attempt_count: attemptCount + 1,
      })
      .eq("id", splitId)
      .eq("status", "transferred");
    if (revertErr) {
      throw new Error(`transfer.reversed revert failed: ${revertErr.message}`);
    }
    await deps.sendOpsAlert({
      subject: "[Mingla ops] Paystack partner transfer reversed by bank",
      paragraphs: [
        `Partner split ${splitId} was reversed by the recipient bank (transfer.reversed). The funds are back in the Mingla Paystack balance; the retry sweep will re-attempt. The partner may need to fix their bank details.`,
      ],
      recipients: paystackPartnerAlertRecipients(),
    });
    return;
  }
}

/**
 * SPEC §4.5.4 — refund.processed. The refund object carries the parent
 * transaction reference as `transaction_reference` [verify-in-webhook-log:
 * pin the exact field from a captured LIVE payload during the post-deploy
 * smoke; the object-form fallback covers the documented alternate shape].
 */
export async function handlePaystackRefundProcessed(
  supabase: SupabaseClient,
  data: Record<string, unknown>,
  deps: PaystackPartnerSplitDeps = defaultPaystackPartnerSplitDeps(),
): Promise<void> {
  let reference = typeof data?.transaction_reference === "string"
    ? data.transaction_reference
    : "";
  if (!reference && data?.transaction && typeof data.transaction === "object") {
    const txRef = (data.transaction as Record<string, unknown>).reference;
    if (typeof txRef === "string") reference = txRef;
  }
  if (!reference) {
    console.warn(
      "[paystack-partner-splits] refund.processed carried no transaction reference — skipping split reversal check",
    );
    return;
  }

  const key = `paystack:${reference}`;
  const { data: row, error } = await supabase
    .from("partner_splits")
    .select(
      "id, status, order_id, partner_account_id, partner_share_cents, reversal_owed_at",
    )
    .eq("stripe_application_fee_id", key)
    .maybeSingle();
  if (error) {
    throw new Error(
      `partner_splits lookup for refund failed: ${error.message}`,
    );
  }
  if (!row) return; // no partner split for this charge — nothing to reverse
  const r = row as Record<string, unknown>;
  const status = String(r.status ?? "");
  const splitId = String(r.id ?? "");

  if (
    status === "held" || status === "pending" || status === "failed" ||
    status.startsWith("blocked_")
  ) {
    // Money never left — permanently prevent payment (the sweep only selects
    // 'pending'; 'reversed_pending' can never transfer). Mirrors the Stripe
    // rail's reversed_pending semantics.
    await supabase.rpc("mark_partner_split_reversed", {
      p_application_fee_id: key,
      p_reversal_transfer_id: null,
    });
    return;
  }

  if (status === "transferred") {
    // HONEST NO-CLAW-BACK (SPEC §4.5.6): Paystack cannot reverse a completed
    // transfer (transfer.reversed is bank-initiated only). Compensating
    // action: stamp reversal_owed_at once, audit, ops-alert. The row's
    // partner-visible status REMAINS 'transferred' — the ledger never lies.
    if (r.reversal_owed_at === null || r.reversal_owed_at === undefined) {
      const { error: owedErr } = await supabase
        .from("partner_splits")
        .update({ reversal_owed_at: new Date().toISOString() })
        .eq("id", splitId)
        .is("reversal_owed_at", null);
      if (owedErr) {
        throw new Error(`reversal_owed_at stamp failed: ${owedErr.message}`);
      }
      await writeAudit(supabase, {
        user_id: null,
        brand_id: null,
        action: "paystack.partner_split_reversal_owed",
        target_type: "partner_split",
        target_id: splitId,
        after: {
          split_id: splitId,
          order_id: r.order_id ?? null,
          partner_account_id: r.partner_account_id ?? null,
          partner_share_cents: r.partner_share_cents ?? null,
        },
      });
      await deps.sendOpsAlert({
        subject:
          "[Mingla ops] Partner split reversal owed (NGN refund after payout)",
        paragraphs: [
          `An NGN refund was processed for a charge whose partner split was ALREADY paid out. Paystack has no transfer claw-back — the partner share is owed back to Mingla.`,
          `Split ${splitId} · order ${String(r.order_id ?? "?")} · ${
            Number(r.partner_share_cents ?? 0)
          } kobo · partner ${String(r.partner_account_id ?? "?")}.`,
          "Recovery is an ops action (net against the partner's future splits or recover off-platform).",
        ],
        recipients: paystackPartnerAlertRecipients(),
      });
    }
    return;
  }
  // reversed / reversed_pending — replay; no-op.
}
