/**
 * Issue #3645 — provider-neutral instalment scheduler.
 *
 * Pass A reconciles unresolved Paystack attempts, pass B sends the one claimed
 * pre-payment notice, and pass C charges due/retry rows through the shared
 * provider-neutral owner. Errors never expose provider references.
 *
 * CONTRACT (per I-PROPOSED-MANUAL-INSTALLMENT-ACTION-VIA-SHARED-HELPER):
 * - This cron calls the shared `_shared/installments/createInstallmentPI.ts`
 *   helper, which is the SINGLE OWNER of installment PI creation. No other
 *   code path may create a PaymentIntent that carries metadata
 *   `mingla_installment_id`.
 * - PI metadata MUST include mingla_installment_id, mingla_installment_ordinal,
 *   mingla_order_id, mingla_brand_id (webhook router discriminates on these).
 * - Idempotency key MUST include retry_count so each retry attempt is
 *   independently idempotent (Stripe returns existing PI on duplicate; new PI
 *   on next retry attempt).
 * - Customer + PaymentMethod live on the CONNECTED account — Stripe-Account
 *   header on every API call (no exceptions).
 * - Application fee = the brand's effective take rate + 3% service fee
 *   (#3645; #4130 brand overrides apply), via installmentFeeRate.ts.
 * - At-risk flag flips on retry_count >= 3 + cron halts further retries.
 * - Dunning email fires on each failure attempt until success or at_risk.
 *
 * Refund logic = Tr4 scope, NOT here.
 *
 * Invoked by pg_cron schedule 'orch-0869-process-scheduled-installments'
 * every 6 hours (see migration 20260610000000_tr3_installments.sql). Safe
 * to invoke twice — Stripe idempotency + DB predicate UPDATE serialise.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore — Deno ESM import
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import {
  chargeInstallment,
  type ChargeInstallmentOutcome,
} from "../_shared/installments/chargeInstallment.ts";
import { MAX_RETRY_ATTEMPTS } from "../_shared/installments/createInstallmentPI.ts";
import { NOTICE_LEAD_MS } from "../_shared/installments/installmentRetrySchedule.ts";
import {
  defaultDispatchBuyerEmail,
  defaultSendBuyerPush,
  sendInstallmentPayLink,
} from "../_shared/installments/installmentPayLinks.ts";
import { handleInstallmentPaystackCharge } from "../_shared/installments/paystackInstallmentWebhook.ts";
import { paystackVerifyTransaction } from "../_shared/paystack.ts";

const DEFAULT_BATCH_LIMIT = 500 as const;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

type SchedulerResult = {
  processed: number;
  collected: number;
  failed: number;
  at_risk_flagged: number;
  approval_required: number;
  pay_links_sent: number;
  notices_sent: number;
  reconciled: number;
  unknown: number;
  errors: Array<{ installment_id: string; reason: string }>;
};

export interface SchedulerDeps {
  now: () => Date;
  verifyPaystack: typeof paystackVerifyTransaction;
  handlePaystackCharge: typeof handleInstallmentPaystackCharge;
  charge: typeof chargeInstallment;
  sendPayLink: typeof sendInstallmentPayLink;
  dispatchBuyerEmail: typeof defaultDispatchBuyerEmail;
  sendBuyerPush: typeof defaultSendBuyerPush;
}

function rowObject(value: unknown): Record<string, unknown> {
  return (Array.isArray(value) ? value[0] : value) as Record<string, unknown>;
}

function safeReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/verify failed \(404\)/i.test(raw)) return "transaction_not_found";
  if (/timeout|network|fetch/i.test(raw)) {
    return "provider_temporarily_unavailable";
  }
  return "processing_failed";
}

function incrementOutcome(
  result: SchedulerResult,
  outcome: ChargeInstallmentOutcome,
): void {
  if (outcome === "collected") result.collected += 1;
  else if (outcome === "failed") result.failed += 1;
  else if (outcome === "at_risk_flagged") {
    result.failed += 1;
    result.at_risk_flagged += 1;
  } else if (outcome === "approval_required") result.approval_required += 1;
  else if (outcome === "pay_link_sent") result.pay_links_sent += 1;
  else if (outcome === "unknown") result.unknown += 1;
}

async function resolveAttempt(
  supabase: SupabaseClient,
  attemptId: string,
  outcome: "failed" | "unknown",
  gatewayResponse: string,
  countFailure: boolean,
): Promise<void> {
  const { error } = await supabase.rpc(
    "issue_3645_resolve_installment_attempt",
    {
      p_attempt_id: attemptId,
      p_outcome: outcome,
      p_provider_transaction_id: null,
      p_gateway_response: gatewayResponse,
      p_approval_url: null,
      p_provider_fee_cents: null,
      p_verified_amount_cents: null,
      p_count_failure: countFailure,
    },
  );
  if (error !== null) {
    throw new Error(`attempt_resolve_failed:${error.message}`);
  }
}

async function passAReconcile(
  supabase: SupabaseClient,
  result: SchedulerResult,
  limit: number,
  deps: SchedulerDeps,
): Promise<void> {
  const now = deps.now();
  const { data, error } = await supabase
    .from("order_installment_charge_attempts")
    .select(
      "id,installment_id,method,state,reference,created_at,approval_url_expires_at",
    )
    .in("state", ["created", "unknown", "paused"])
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error !== null) {
    throw new Error(`reconcile_query_failed:${error.message}`);
  }

  for (const raw of data ?? []) {
    const attempt = raw as Record<string, unknown>;
    const installmentId = String(attempt.installment_id);
    const state = String(attempt.state);
    const createdAt = Date.parse(String(attempt.created_at));
    const approvalExpiry = Date.parse(
      String(attempt.approval_url_expires_at ?? ""),
    );
    if (state === "created" && now.getTime() - createdAt < FIFTEEN_MINUTES_MS) {
      continue;
    }
    if (state === "paused") {
      if (!Number.isFinite(approvalExpiry) || approvalExpiry >= now.getTime()) {
        continue;
      }
      const { data: installment, error: installmentError } = await supabase
        .from("order_installments").select("status").eq("id", installmentId)
        .maybeSingle();
      if (installmentError !== null) {
        result.errors.push({
          installment_id: installmentId,
          reason: "installment_lookup_failed",
        });
        continue;
      }
      if ((installment as { status?: string } | null)?.status === "collected") {
        const { error: abandonError } = await supabase.rpc(
          "issue_3645_abandon_attempt",
          {
            p_attempt_id: String(attempt.id),
          },
        );
        if (abandonError === null) result.reconciled += 1;
        else {result.errors.push({
            installment_id: installmentId,
            reason: "attempt_abandon_failed",
          });}
      }
      continue;
    }

    try {
      const txn = await deps.verifyPaystack(String(attempt.reference));
      const providerState = String(txn.status ?? "").toLowerCase();
      if (providerState === "success") {
        await deps.handlePaystackCharge(
          supabase,
          String(attempt.reference),
          txn,
        );
        result.reconciled += 1;
      } else if (providerState === "failed" || providerState === "abandoned") {
        if (
          state === "created" &&
          ["pay_link", "approve"].includes(String(attempt.method))
        ) {
          const { error: abandonError } = await supabase.rpc(
            "issue_3645_abandon_attempt",
            {
              p_attempt_id: String(attempt.id),
            },
          );
          if (abandonError !== null) {
            throw new Error(`attempt_abandon_failed:${abandonError.message}`);
          }
        } else {
          await resolveAttempt(
            supabase,
            String(attempt.id),
            "failed",
            providerState,
            true,
          );
        }
        result.reconciled += 1;
      } else {
        result.unknown += 1;
      }
    } catch (err) {
      const missing = /verify failed \(404\)/i.test(
        err instanceof Error ? err.message : String(err),
      );
      if (
        missing && String(attempt.method) === "auto_card" &&
        now.getTime() - createdAt >= ONE_HOUR_MS
      ) {
        try {
          await resolveAttempt(
            supabase,
            String(attempt.id),
            "failed",
            "not_created",
            false,
          );
          result.reconciled += 1;
        } catch {
          result.errors.push({
            installment_id: installmentId,
            reason: "attempt_resolve_failed",
          });
        }
      } else {
        result.errors.push({
          installment_id: installmentId,
          reason: safeReason(err),
        });
      }
    }
  }
}

async function resetNoticeClaim(
  supabase: SupabaseClient,
  installmentId: string,
): Promise<void> {
  await supabase.from("order_installments")
    .update({ pre_charge_notice_sent_at: null })
    .eq("id", installmentId);
}

async function passBNotices(
  supabase: SupabaseClient,
  result: SchedulerResult,
  limit: number,
  deps: SchedulerDeps,
): Promise<void> {
  const now = deps.now();
  const leadEnd = new Date(now.getTime() + NOTICE_LEAD_MS).toISOString();
  const { data, error } = await supabase
    .from("order_installments")
    .select(
      `id,order_id,ordinal,buyer_total_cents,amount_cents,currency,due_at,collection_method,
      orders!inner(cancelled_at,buyer_user_id,payment_card_last4,events!inner(status,brand_id,title))`,
    )
    .eq("status", "scheduled")
    .is("cancelled_at", null)
    .is("pre_charge_notice_sent_at", null)
    .is("orders.cancelled_at", null)
    .neq("orders.events.status", "cancelled")
    .gt("due_at", now.toISOString())
    .lte("due_at", leadEnd)
    .order("due_at", { ascending: true })
    .limit(limit);
  if (error !== null) throw new Error(`notice_query_failed:${error.message}`);

  for (const raw of data ?? []) {
    const row = raw as Record<string, unknown>;
    const installmentId = String(row.id);
    const { data: claimed, error: claimError } = await supabase
      .from("order_installments")
      .update({ pre_charge_notice_sent_at: now.toISOString() })
      .eq("id", installmentId)
      .is("pre_charge_notice_sent_at", null)
      .select("id")
      .maybeSingle();
    if (claimError !== null || claimed === null) continue;
    try {
      if (String(row.collection_method) === "pay_link") {
        const sent = await deps.sendPayLink(supabase, {
          installmentId,
          purpose: "pay",
        });
        if (!sent.ok || !sent.emailSent) {
          await resetNoticeClaim(supabase, installmentId);
          result.errors.push({
            installment_id: installmentId,
            reason: "notice_delivery_failed",
          });
          continue;
        }
        result.pay_links_sent += 1;
      } else {
        const order = rowObject(row.orders);
        const event = rowObject(order.events);
        const sent = await deps.dispatchBuyerEmail(
          "installment_pre_charge_notice",
          {
            orderId: String(row.order_id),
            installmentId,
            amountCents: Number(row.buyer_total_cents ?? row.amount_cents),
            currency: String(row.currency),
            dueAt: String(row.due_at),
            cardLast4: typeof order.payment_card_last4 === "string"
              ? order.payment_card_last4
              : null,
          },
        );
        if (!sent) {
          await resetNoticeClaim(supabase, installmentId);
          result.errors.push({
            installment_id: installmentId,
            reason: "notice_delivery_failed",
          });
          continue;
        }
        if (typeof order.buyer_user_id === "string") {
          await deps.sendBuyerPush({
            userId: order.buyer_user_id,
            brandId: typeof event.brand_id === "string" ? event.brand_id : null,
            type: "installment_upcoming_charge",
            title: "Upcoming trip payment",
            body: `Your payment for ${String(event.title)} is due soon.`,
            data: { orderId: String(row.order_id), installmentId },
            relatedId: installmentId,
            idempotencyKey: `installment_notice:${installmentId}`,
          });
        }
      }
      result.notices_sent += 1;
    } catch {
      await resetNoticeClaim(supabase, installmentId);
      result.errors.push({
        installment_id: installmentId,
        reason: "notice_delivery_failed",
      });
    }
  }
}

async function passCDueAndRetry(
  supabase: SupabaseClient,
  result: SchedulerResult,
  limit: number,
  dryRun: boolean,
  deps: SchedulerDeps,
): Promise<void> {
  const nowIso = deps.now().toISOString();
  const select =
    `id,order_id,status,provider,collection_method,buyer_action,due_at,next_retry_at,
    orders!inner(cancelled_at,events!inner(status))`;
  const { data: dueRows, error: dueError } = await supabase
    .from("order_installments").select(select)
    .eq("status", "scheduled").is("cancelled_at", null).is(
      "in_flight_attempt_id",
      null,
    )
    .is("orders.cancelled_at", null).neq("orders.events.status", "cancelled")
    .lte("due_at", nowIso).order("due_at", { ascending: true }).limit(limit);
  if (dueError !== null) {
    throw new Error(`due_query_failed:${dueError.message}`);
  }
  const { data: retryRows, error: retryError } = await supabase
    .from("order_installments").select(select)
    .eq("status", "failed").is("cancelled_at", null).is(
      "in_flight_attempt_id",
      null,
    )
    .is("orders.cancelled_at", null).neq("orders.events.status", "cancelled")
    .lte("next_retry_at", nowIso).lt("retry_count", MAX_RETRY_ATTEMPTS)
    .order("next_retry_at", { ascending: true })
    .limit(Math.max(0, limit - (dueRows?.length ?? 0)));
  if (retryError !== null) {
    throw new Error(`retry_query_failed:${retryError.message}`);
  }

  const autoRetryIds = (retryRows ?? [])
    .filter((row) =>
      String((row as Record<string, unknown>).collection_method) === "auto_card"
    )
    .map((row) => String((row as Record<string, unknown>).id));
  if (autoRetryIds.length > 0 && !dryRun) {
    const { error: flipError } = await supabase.from("order_installments")
      .update({ status: "scheduled", updated_at: nowIso })
      .in("id", autoRetryIds).eq("status", "failed");
    if (flipError !== null) {
      throw new Error(`retry_flip_failed:${flipError.message}`);
    }
  }

  const rows = [
    ...(dueRows ?? []).map((row) => ({
      row: row as Record<string, unknown>,
      trigger: "cron" as const,
    })),
    ...(retryRows ?? []).map((row) => ({
      row: row as Record<string, unknown>,
      trigger: "retry" as const,
    })),
  ];
  for (const item of rows) {
    const installmentId = String(item.row.id);
    result.processed += 1;
    try {
      const outcome = await deps.charge({
        supabase,
        installmentId,
        trigger: item.trigger,
        dryRun,
      });
      incrementOutcome(result, outcome.outcome);
    } catch {
      result.errors.push({
        installment_id: installmentId,
        reason: "charge_failed",
      });
    }
  }
}

export async function processScheduledInstallments(
  supabase: SupabaseClient,
  input: { dryRun?: boolean; limit?: number; deps?: Partial<SchedulerDeps> } =
    {},
): Promise<SchedulerResult> {
  const deps: SchedulerDeps = {
    now: () => new Date(),
    verifyPaystack: paystackVerifyTransaction,
    handlePaystackCharge: handleInstallmentPaystackCharge,
    charge: chargeInstallment,
    sendPayLink: sendInstallmentPayLink,
    dispatchBuyerEmail: defaultDispatchBuyerEmail,
    sendBuyerPush: defaultSendBuyerPush,
    ...(input.deps ?? {}),
  };
  const limit =
    typeof input.limit === "number" && input.limit > 0 && input.limit <= 5000
      ? Math.floor(input.limit)
      : DEFAULT_BATCH_LIMIT;
  const result: SchedulerResult = {
    processed: 0,
    collected: 0,
    failed: 0,
    at_risk_flagged: 0,
    approval_required: 0,
    pay_links_sent: 0,
    notices_sent: 0,
    reconciled: 0,
    unknown: 0,
    errors: [],
  };
  try {
    await passAReconcile(supabase, result, limit, deps);
  } catch {
    result.errors.push({
      installment_id: "scheduler",
      reason: "reconcile_pass_failed",
    });
  }
  try {
    await passBNotices(supabase, result, limit, deps);
  } catch {
    result.errors.push({
      installment_id: "scheduler",
      reason: "notice_pass_failed",
    });
  }
  try {
    await passCDueAndRetry(
      supabase,
      result,
      limit,
      input.dryRun === true,
      deps,
    );
  } catch {
    result.errors.push({
      installment_id: "scheduler",
      reason: "charge_pass_failed",
    });
  }
  return result;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

if (import.meta.main) {
  serve(async (req: Request) => {
    if (req.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405);
    }
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      return jsonResponse({ error: "supabase_env_missing" }, 500);
    }
    if ((req.headers.get("authorization") ?? "") !== `Bearer ${key}`) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }
    let body: { dryRun?: boolean; limit?: number } = {};
    try {
      body = await req.json();
    } catch {
      // Empty cron bodies are valid.
    }
    const supabase: SupabaseClient = createClient(url, key);
    return jsonResponse(await processScheduledInstallments(supabase, body));
  });
}
