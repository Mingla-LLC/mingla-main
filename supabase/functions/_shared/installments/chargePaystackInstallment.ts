/**
 * Issue #3645 — automatic charge of one Paystack trip instalment on the
 * buyer's saved card.
 *
 * MINGLA-INVARIANT: I-3645-PS-1 | issue #3645 | an attempt (with its deterministic reference) is begun under lock before any Paystack call; a second attempt is refused while one is unresolved
 * MINGLA-INVARIANT: I-3645-PS-2 | issue #3645 | saved card details are read only here, sent only to Paystack, and never logged, audited or returned
 * MINGLA-INVARIANT: I-3645-PS-3 | issue #3645 | the charge amount is the price locked at checkout (attempt amount); this module never prices
 *
 * The ONLY caller of paystackChargeAuthorization. Reached only through
 * chargeInstallment.ts. Charges with the email the card was saved with
 * (Paystack only honours that email), the attempt's locked all-in amount, and
 * the same split fields as the deposit for this brand.
 */
// @ts-ignore — Deno ESM import
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applicationFeeWithReferralShare } from "../attribution.ts";
import { formatMoneyFromCents } from "../email/currency.ts";
import { paystackTicketSplitFields } from "../ngPaystackSplit.ts";
import {
  classifyPaystackChargeResponse,
  paystackChargeAuthorization,
  type PaystackChargeAuthorizationParams,
  type PaystackChargeAuthorizationResponse,
} from "../paystack.ts";
import {
  defaultInstallmentNotifyDeps,
  type InstallmentNotifyDeps,
  sendInstallmentPayLink,
} from "./installmentPayLinks.ts";
import {
  defaultInstallmentWebhookDeps,
  type InstallmentWebhookDeps,
  refundInstallmentAttempt,
} from "./paystackInstallmentWebhook.ts";

export type PaystackChargeOutcome =
  | "collected"
  | "failed"
  | "at_risk_flagged"
  | "approval_required"
  | "pay_link_sent"
  | "unknown"
  | "skipped";

export interface ChargePaystackDeps
  extends InstallmentNotifyDeps, InstallmentWebhookDeps {
  chargeAuthorization: (
    params: PaystackChargeAuthorizationParams,
  ) => Promise<PaystackChargeAuthorizationResponse>;
}

export function defaultChargePaystackDeps(
  supabase: SupabaseClient,
): ChargePaystackDeps {
  return {
    ...defaultInstallmentNotifyDeps(supabase),
    ...defaultInstallmentWebhookDeps(),
    chargeAuthorization: (params) => paystackChargeAuthorization(params),
  };
}

interface ChargeContext {
  installmentId: string;
  orderId: string;
  ordinal: number;
  currency: string;
  amountCents: number;
  plannedFeeCents: number;
  referralShareMinor: number;
  brandId: string;
  brandName: string;
  eventId: string;
  buyerUserId: string | null;
  buyerFirstName: string | null;
  subaccountCode: string | null;
  isCutover: boolean;
  tripTitle: string;
}

async function loadContext(
  supabase: SupabaseClient,
  installmentId: string,
): Promise<ChargeContext | null> {
  const { data, error } = await supabase
    .from("order_installments")
    .select(
      "id, order_id, ordinal, currency, buyer_total_cents, amount_cents, planned_application_fee_cents, referral_share_minor, orders!inner(id, event_id, buyer_user_id, buyer_name, events!inner(id, title, brand_id, brands!inner(id, name, paystack_subaccount_code, payout_hold_cutover_at)))",
    )
    .eq("id", installmentId)
    .maybeSingle();
  if (error !== null) {
    throw new Error(`paystack instalment load failed: ${error.message}`);
  }
  if (data === null) return null;
  const r = data as Record<string, unknown>;
  const one = (v: unknown) =>
    (Array.isArray(v) ? v[0] : v) as Record<string, unknown>;
  const order = one(r.orders);
  const event = one(order.events);
  const brand = one(event.brands);
  return {
    installmentId,
    orderId: String(r.order_id),
    ordinal: Number(r.ordinal),
    currency: String(r.currency).trim(),
    amountCents: Number(r.buyer_total_cents ?? r.amount_cents),
    plannedFeeCents: Number(r.planned_application_fee_cents ?? 0),
    referralShareMinor: Number(r.referral_share_minor ?? 0),
    brandId: String(brand.id),
    brandName: String(brand.name ?? ""),
    eventId: String(event.id),
    buyerUserId: typeof order.buyer_user_id === "string"
      ? order.buyer_user_id
      : null,
    buyerFirstName: typeof order.buyer_name === "string"
      ? order.buyer_name.trim().split(/\s+/)[0] || null
      : null,
    subaccountCode: typeof brand.paystack_subaccount_code === "string"
      ? brand.paystack_subaccount_code
      : null,
    isCutover: brand.payout_hold_cutover_at !== null &&
      brand.payout_hold_cutover_at !== undefined,
    tripTitle: String(event.title ?? ""),
  };
}

async function resolveAttempt(
  supabase: SupabaseClient,
  attemptId: string,
  outcome: "succeeded" | "failed" | "paused" | "unknown",
  fields: {
    transactionId?: string | null;
    gateway?: string | null;
    approvalUrl?: string | null;
    feeCents?: number | null;
    amountCents?: number | null;
    countFailure?: boolean;
  },
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(
    "issue_3645_resolve_installment_attempt",
    {
      p_attempt_id: attemptId,
      p_outcome: outcome,
      p_provider_transaction_id: fields.transactionId ?? null,
      p_gateway_response: fields.gateway ?? null,
      p_approval_url: fields.approvalUrl ?? null,
      p_provider_fee_cents: fields.feeCents ?? null,
      p_verified_amount_cents: fields.amountCents ?? null,
      p_count_failure: fields.countFailure ?? true,
    },
  );
  if (error !== null) {
    throw new Error(
      `issue_3645_resolve_installment_attempt failed: ${error.message}`,
    );
  }
  return (data ?? {}) as Record<string, unknown>;
}

async function downgrade(
  supabase: SupabaseClient,
  installmentId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc("issue_3645_downgrade_to_pay_link", {
    p_installment_id: installmentId,
    p_reason: reason,
  });
  if (error !== null) {
    throw new Error(
      `issue_3645_downgrade_to_pay_link failed: ${error.message}`,
    );
  }
}

/** Dunning email (with a fresh pay link), buyer push and host notice for one counted failure. */
export async function notifyPaystackInstallmentFailure(
  supabase: SupabaseClient,
  installmentId: string,
  resolved: Record<string, unknown>,
  depsIn: Partial<ChargePaystackDeps> = {},
): Promise<void> {
  const deps = { ...defaultChargePaystackDeps(supabase), ...depsIn };
  const ctx = await loadContext(supabase, installmentId);
  if (ctx === null) return;
  await notifyFailure(supabase, ctx, resolved, deps);
}

async function notifyFailure(
  supabase: SupabaseClient,
  ctx: ChargeContext,
  resolved: Record<string, unknown>,
  deps: ChargePaystackDeps,
): Promise<void> {
  const atRisk = resolved.outcome === "at_risk";
  const retryCount = Number(resolved.retry_count ?? 0);
  const nextRetryAt = typeof resolved.next_retry_at === "string"
    ? resolved.next_retry_at
    : null;
  // Fresh pay link for the dunning email's button (the buyer can pay any way).
  const link = await sendInstallmentPayLink(supabase, {
    installmentId: ctx.installmentId,
    purpose: "pay",
    deps,
    notify: false,
  }).catch(() => ({ ok: false as const, reason: "pay_link_failed" }));
  await deps.dispatchBuyerEmail("installment_dunning", {
    orderId: ctx.orderId,
    installmentId: ctx.installmentId,
    installmentOrdinal: ctx.ordinal,
    failureReason: String(resolved.failure_reason ?? "card_declined"),
    retryCount,
    nextRetryAt,
    provider: "paystack",
    actionUrl: link.ok ? link.url : null,
    actionLabel: link.ok ? "Pay now" : null,
  });
  if (ctx.buyerUserId !== null) {
    await deps.sendBuyerPush({
      userId: ctx.buyerUserId,
      brandId: ctx.brandId,
      type: "installment_payment_failed",
      title: atRisk
        ? "Your booking is at risk"
        : "Your payment didn't go through",
      body:
        `We couldn't take your payment for ${ctx.tripTitle}. Tap to pay securely.`,
      data: { orderId: ctx.orderId, installmentId: ctx.installmentId },
      relatedId: ctx.installmentId,
      idempotencyKey:
        `installment_payment_failed:${ctx.installmentId}:${retryCount}`,
      deepLink: link.ok ? link.url : null,
    });
  }
  await notifyHostFailure(ctx, resolved, deps);
}

async function notifyHostFailure(
  ctx: ChargeContext,
  resolved: Record<string, unknown>,
  deps: ChargePaystackDeps,
): Promise<void> {
  const atRisk = resolved.outcome === "at_risk";
  const retryCount = Number(resolved.retry_count ?? 0);
  const nextRetryAt = typeof resolved.next_retry_at === "string"
    ? resolved.next_retry_at
    : null;
  const amount = formatMoneyFromCents(ctx.amountCents, ctx.currency);
  const buyer = ctx.buyerFirstName ?? "A buyer";
  const idem = `${ctx.installmentId}:${retryCount}`;
  await deps.notifyHost({
    brandId: ctx.brandId,
    type: atRisk
      ? "business.installment_at_risk"
      : "business.installment_failed",
    title: atRisk ? "Booking at risk" : "Instalment didn't go through",
    body: atRisk
      ? `${buyer}'s booking for ${ctx.tripTitle} is at risk after 3 missed payments. Review it in Trip Money.`
      : `A ${amount} instalment for ${ctx.tripTitle} didn't go through. We'll try again${
        nextRetryAt ? ` on ${nextRetryAt.slice(0, 10)}` : ""
      }.`,
    data: {
      orderId: ctx.orderId,
      installmentId: ctx.installmentId,
      retryCount,
    },
    relatedId: ctx.installmentId,
    idempotencyKey: `${
      atRisk ? "business.installment_at_risk" : "business.installment_failed"
    }:${idem}`,
    deepLink: `mingla-business://trip/${ctx.eventId}/money`,
  });
}

export async function chargePaystackInstallment(input: {
  supabase: SupabaseClient;
  installmentId: string;
  atRiskOverride?: boolean;
  deps?: Partial<ChargePaystackDeps>;
}): Promise<
  { outcome: PaystackChargeOutcome; reason?: string; reference?: string }
> {
  const { supabase } = input;
  const deps = {
    ...defaultChargePaystackDeps(supabase),
    ...(input.deps ?? {}),
  };
  const ctx = await loadContext(supabase, input.installmentId);
  if (ctx === null) {
    return { outcome: "skipped", reason: "installment_not_found" };
  }
  if (ctx.currency !== "NGN") {
    return { outcome: "skipped", reason: "currency_not_ngn" };
  }

  const fee = applicationFeeWithReferralShare(ctx.plannedFeeCents, {
    shareMinor: ctx.referralShareMinor,
  });
  const { data: begun, error: beginError } = await supabase.rpc(
    "issue_3645_begin_installment_attempt",
    {
      p_installment_id: ctx.installmentId,
      p_method: "auto_card",
      p_application_fee_cents: fee,
      p_atrisk_override: input.atRiskOverride === true,
    },
  );
  if (beginError !== null) {
    throw new Error(
      `issue_3645_begin_installment_attempt failed: ${beginError.message}`,
    );
  }
  const attempt = (begun ?? {}) as Record<string, unknown>;
  if (attempt.ok !== true) {
    return {
      outcome: "skipped",
      reason: String(attempt.reason ?? "not_chargeable"),
    };
  }
  const attemptId = String(attempt.attempt_id);
  const reference = String(attempt.reference);
  const amountCents = Number(attempt.amount_cents);
  const feeCents = Number(attempt.application_fee_cents);

  // The saved card (never logged).
  const { data: authRows, error: authError } = await supabase.rpc(
    "issue_3645_installment_authorization_for_charge",
    { p_installment_id: ctx.installmentId },
  );
  if (authError !== null) {
    await resolveAttempt(supabase, attemptId, "failed", {
      gateway: "authorization_lookup_failed",
      countFailure: false,
    });
    throw new Error("saved card lookup failed");
  }
  const auth = (Array.isArray(authRows) ? authRows[0] : authRows) as
    | { authorization_code?: string; authorization_email?: string }
    | undefined;
  if (!auth?.authorization_code || !auth?.authorization_email) {
    await resolveAttempt(supabase, attemptId, "failed", {
      gateway: "authorization_missing",
      countFailure: false,
    });
    await downgrade(supabase, ctx.installmentId, "authorization_missing");
    const link = await sendInstallmentPayLink(supabase, {
      installmentId: ctx.installmentId,
      purpose: "pay",
      deps,
    });
    return {
      outcome: link.ok ? "pay_link_sent" : "skipped",
      reason: link.ok ? undefined : link.reason,
      reference,
    };
  }

  const response = await deps.chargeAuthorization({
    authorizationCode: auth.authorization_code,
    email: auth.authorization_email,
    amountSubunits: amountCents,
    currency: "NGN",
    reference,
    metadata: {
      mingla_installment_id: ctx.installmentId,
      mingla_installment_ordinal: String(ctx.ordinal),
      mingla_order_id: ctx.orderId,
      mingla_brand_id: ctx.brandId,
    },
    ...paystackTicketSplitFields(ctx.isCutover, ctx.subaccountCode, feeCents),
  });
  const cls = classifyPaystackChargeResponse(response);

  if (cls.outcome === "succeeded") {
    // A cancel may have won the race while the charge was in flight: the
    // resolver answers refund_due and the money goes straight back.
    const resolved = await resolveAttempt(supabase, attemptId, "succeeded", {
      transactionId: cls.transactionId,
      gateway: cls.gatewayResponse,
      feeCents: cls.feesSubunits,
      amountCents: cls.amountSubunits,
    });
    if (resolved.outcome === "refund_due") {
      await refundInstallmentAttempt(supabase, attemptId, deps);
      return {
        outcome: "skipped",
        reason: String(resolved.reason ?? "refund_due"),
        reference,
      };
    }
    if (
      resolved.ok !== true ||
      (resolved.outcome !== "collected" && resolved.outcome !== "replayed")
    ) {
      return {
        outcome: "unknown",
        reason: String(resolved.reason ?? resolved.outcome ?? "unresolved"),
        reference,
      };
    }
    if (
      resolved.outcome === "collected" && Number(resolved.remaining ?? 1) === 0
    ) {
      await deps.dispatchBuyerEmail("installment_plan_paid_in_full", {
        orderId: ctx.orderId,
      });
    }
    return { outcome: "collected", reference };
  }

  if (cls.outcome === "paused") {
    const resolved = await resolveAttempt(supabase, attemptId, "paused", {
      transactionId: cls.transactionId,
      gateway: cls.gatewayResponse,
      approvalUrl: cls.approvalUrl,
    });
    await sendInstallmentPayLink(supabase, {
      installmentId: ctx.installmentId,
      purpose: "approve",
      deps,
    });
    if (resolved.outcome === "at_risk") {
      await notifyHostFailure(ctx, resolved, deps);
    }
    return {
      outcome: resolved.outcome === "at_risk"
        ? "at_risk_flagged"
        : "approval_required",
      reference,
    };
  }

  if (cls.outcome === "failed") {
    const resolved = await resolveAttempt(supabase, attemptId, "failed", {
      transactionId: cls.transactionId,
      gateway: cls.gatewayResponse,
    });
    if (cls.authorizationUnusable) {
      await downgrade(supabase, ctx.installmentId, "authorization_unusable");
    }
    await notifyFailure(supabase, ctx, resolved, deps);
    return {
      outcome: resolved.outcome === "at_risk" ? "at_risk_flagged" : "failed",
      reason: "declined",
      reference,
    };
  }

  // Timeout / 5xx / still running: the charge may exist. Leave the attempt in
  // flight; the next cron pass verifies the reference before any retry.
  await resolveAttempt(supabase, attemptId, "unknown", {
    gateway: cls.gatewayResponse,
  });
  return { outcome: "unknown", reason: cls.gatewayResponse, reference };
}
