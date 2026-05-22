/**
 * ORCH-0914 shared installment PaymentIntent owner.
 *
 * Supersedes the old cron-only ownership rule by making this helper the single
 * owner of installment PI creation. `process-scheduled-installments` and
 * `manual-charge-installment` both call this module; no other path should call
 * `stripe.paymentIntents.create` with `mingla_installment_id` metadata.
 */

// @ts-ignore — Deno ESM import
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { stripeTicketCheckout } from "../stripe.ts";
import { writeAudit } from "../audit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

export const MINGLA_APPLICATION_FEE_RATE = 0.015 as const;
export const MAX_RETRY_ATTEMPTS = 3 as const;

// Retry cadence (per SPEC §3.2.1 + Open Polish §9): Day-3 then Day-7 then at-risk.
const RETRY_INTERVAL_HOURS_BY_RETRY_COUNT = {
  1: 72,
  2: 168,
} as const;

export type InstallmentRow = {
  id: string;
  order_id: string;
  ordinal: number;
  amount_cents: number;
  currency: string;
  due_at: string;
  status: string;
  retry_count: number;
  stripe_payment_intent_id: string | null;
};

export type OrderRow = {
  id: string;
  event_id: string;
  stripe_customer_id_on_connected_account: string | null;
  saved_payment_method_id: string | null;
  buyer_user_id: string | null;
  buyer_email: string;
  at_risk: boolean;
};

export type BrandRow = {
  id: string;
  contact_email: string | null;
  name: string;
};

export type StripeAccount = {
  brand_id: string;
  stripe_account_id: string;
};

export type CreateInstallmentPIResult = {
  ok: boolean;
  chargeId?: string;
  error?: string;
  outcome?: "collected" | "failed" | "skipped" | "at_risk_flagged";
  reason?: string;
};

export type CreateInstallmentPIInput = {
  installmentId: string;
  brandId: string;
  override?: { atRisk?: boolean };
  supabase?: SupabaseClient;
  installment?: InstallmentRow;
  order?: OrderRow;
  brand?: BrandRow;
  stripeAccount?: StripeAccount;
  dryRun?: boolean;
};

function nextRetryAtFor(retryCount: number): string | null {
  const hours = RETRY_INTERVAL_HOURS_BY_RETRY_COUNT[
    retryCount as keyof typeof RETRY_INTERVAL_HOURS_BY_RETRY_COUNT
  ];
  if (hours === undefined) return null;
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

function serviceClient(): SupabaseClient {
  if (SUPABASE_URL === undefined || SUPABASE_SERVICE_ROLE_KEY === undefined) {
    throw new Error("supabase_env_missing");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fireDunningEmail(
  supabase: SupabaseClient,
  installment: InstallmentRow,
  order: OrderRow,
  brand: BrandRow,
  failureReason: string,
): Promise<void> {
  try {
    if (SUPABASE_URL === undefined || SUPABASE_SERVICE_ROLE_KEY === undefined) {
      return;
    }
    await fetch(`${SUPABASE_URL}/functions/v1/ticket-confirmation-dispatch`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        kind: "installment_dunning",
        orderId: order.id,
        installmentId: installment.id,
        installmentOrdinal: installment.ordinal,
        amountCents: installment.amount_cents,
        currency: installment.currency,
        failureReason,
        brandContactEmail: brand.contact_email,
        brandName: brand.name,
      }),
    });
  } catch (err) {
    console.error(
      "[createInstallmentPI] dunning email dispatch failed",
      err instanceof Error ? err.message : err,
    );
  }
}

async function loadInstallmentContext(
  supabase: SupabaseClient,
  installmentId: string,
  brandId: string,
): Promise<{
  installment: InstallmentRow;
  order: OrderRow;
  brand: BrandRow;
  stripeAccount: StripeAccount;
} | { error: string }> {
  const { data: installment } = await supabase
    .from("order_installments")
    .select("id, order_id, ordinal, amount_cents, currency, due_at, status, retry_count, stripe_payment_intent_id")
    .eq("id", installmentId)
    .maybeSingle();
  if (installment === null) return { error: "installment_not_found" };

  const inst = installment as InstallmentRow;
  const { data: order } = await supabase
    .from("orders")
    .select("id, event_id, stripe_customer_id_on_connected_account, saved_payment_method_id, buyer_user_id, buyer_email, at_risk")
    .eq("id", inst.order_id)
    .maybeSingle();
  if (order === null) return { error: "order_not_found" };

  const { data: brand } = await supabase
    .from("brands")
    .select("id, contact_email, name")
    .eq("id", brandId)
    .maybeSingle();
  if (brand === null) return { error: "brand_not_found" };

  const { data: stripeAccount } = await supabase
    .from("stripe_connect_accounts")
    .select("brand_id, stripe_account_id")
    .eq("brand_id", brandId)
    .is("detached_at", null)
    .maybeSingle();
  if (stripeAccount === null) return { error: "stripe_account_missing" };

  return {
    installment: inst,
    order: order as OrderRow,
    brand: brand as BrandRow,
    stripeAccount: stripeAccount as StripeAccount,
  };
}

export async function createInstallmentPI(
  input: CreateInstallmentPIInput,
): Promise<CreateInstallmentPIResult> {
  const supabase = input.supabase ?? serviceClient();
  let installment = input.installment;
  let order = input.order;
  let brand = input.brand;
  let stripeAccount = input.stripeAccount;

  if (
    installment === undefined ||
    order === undefined ||
    brand === undefined ||
    stripeAccount === undefined
  ) {
    const loaded = await loadInstallmentContext(
      supabase,
      input.installmentId,
      input.brandId,
    );
    if ("error" in loaded) {
      return {
        ok: false,
        error: loaded.error,
        outcome: "skipped",
        reason: loaded.error,
      };
    }
    installment = loaded.installment;
    order = loaded.order;
    brand = loaded.brand;
    stripeAccount = loaded.stripeAccount;
  }

  if (
    order.stripe_customer_id_on_connected_account === null ||
    order.saved_payment_method_id === null
  ) {
    if (input.dryRun !== true) {
      await supabase
        .from("order_installments")
        .update({
          status: "failed",
          failed_at: new Date().toISOString(),
          failure_reason: "saved_payment_method_missing",
          retry_count: installment.retry_count + 1,
          next_retry_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", installment.id)
        .eq("status", "scheduled");
    }
    return {
      ok: false,
      error: "saved_payment_method_missing",
      outcome: "failed",
      reason: "saved_payment_method_missing",
    };
  }

  if (order.at_risk && input.override?.atRisk !== true) {
    return {
      ok: false,
      error: "order_at_risk_no_more_retries",
      outcome: "skipped",
      reason: "order_at_risk_no_more_retries",
    };
  }

  if (input.dryRun === true) {
    console.log(
      `[createInstallmentPI] DRY RUN — would charge installment ${installment.id} (order ${installment.order_id} ordinal ${installment.ordinal}) for ${installment.amount_cents} ${installment.currency}`,
    );
    return { ok: true, outcome: "collected", reason: "dry_run" };
  }

  const stripe = stripeTicketCheckout();
  const applicationFeeAmountCents = Math.round(
    installment.amount_cents * MINGLA_APPLICATION_FEE_RATE,
  );
  const idempotencyKey = `installment:${installment.order_id}:${installment.ordinal}:${installment.retry_count}`;

  try {
    // orch-strict-grep-allow stripe-no-idempotency-key — idempotencyKey IS passed via the request-options second arg; SPEC §3.2.1 retry-aware format diverges from generateIdempotencyKey's epoch-ms shape because cron + webhook need deterministic per-(installment,attempt) keys to prevent double-charge.
    // @ts-ignore — Stripe SDK namespace runtime-provided in Deno.
    const pi = await stripe.paymentIntents.create(
      {
        amount: installment.amount_cents,
        currency: installment.currency.toLowerCase(),
        customer: order.stripe_customer_id_on_connected_account,
        payment_method: order.saved_payment_method_id,
        confirm: true,
        off_session: true,
        payment_method_types: ["card"],
        ...(applicationFeeAmountCents > 0
          ? { application_fee_amount: applicationFeeAmountCents }
          : {}),
        metadata: {
          mingla_installment_id: installment.id,
          mingla_installment_ordinal: String(installment.ordinal),
          mingla_order_id: order.id,
          mingla_brand_id: brand.id,
        },
      },
      {
        idempotencyKey,
        stripeAccount: stripeAccount.stripe_account_id,
      },
    );

    await supabase
      .from("order_installments")
      .update({
        stripe_payment_intent_id: pi.id,
        failed_at: null,
        failure_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", installment.id);

    await writeAudit(supabase, {
      user_id: null,
      brand_id: brand.id,
      event_id: order.event_id,
      action: "tr3.installment_pi_created",
      target_type: "order_installment",
      target_id: installment.id,
      after: {
        ordinal: installment.ordinal,
        amount_cents: installment.amount_cents,
        stripe_payment_intent_id: pi.id,
        retry_count: installment.retry_count,
      },
    });

    return {
      ok: true,
      chargeId: pi.id,
      outcome: "collected",
      reason: "pi_created",
    };
  } catch (err) {
    const stripeErr = err as {
      message?: string;
      code?: string;
      type?: string;
      statusCode?: number;
    };
    const reason = `${stripeErr.code ?? stripeErr.type ?? "unknown"}:${
      stripeErr.message ?? ""
    }`.slice(0, 500);
    const nextRetryCount = installment.retry_count + 1;
    const willBeAtRisk = nextRetryCount >= MAX_RETRY_ATTEMPTS;
    const nextRetryAt = willBeAtRisk ? null : nextRetryAtFor(nextRetryCount);

    await supabase
      .from("order_installments")
      .update({
        status: "failed",
        failed_at: new Date().toISOString(),
        failure_reason: reason,
        retry_count: nextRetryCount,
        next_retry_at: nextRetryAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", installment.id)
      .eq("status", "scheduled");

    if (willBeAtRisk) {
      await supabase
        .from("orders")
        .update({
          at_risk: true,
          at_risk_since: new Date().toISOString(),
        })
        .eq("id", order.id)
        .eq("at_risk", false);
    }

    await writeAudit(supabase, {
      user_id: null,
      brand_id: brand.id,
      event_id: order.event_id,
      action: "tr3.installment_pi_failed",
      target_type: "order_installment",
      target_id: installment.id,
      after: {
        ordinal: installment.ordinal,
        retry_count: nextRetryCount,
        next_retry_at: nextRetryAt,
        failure_reason: reason,
        at_risk_flipped: willBeAtRisk,
      },
    });

    await fireDunningEmail(supabase, installment, order, brand, reason);

    return {
      ok: false,
      error: reason,
      outcome: willBeAtRisk ? "at_risk_flagged" : "failed",
      reason,
    };
  }
}
