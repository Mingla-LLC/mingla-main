/**
 * ORCH-0869 [Tr3 Installment Payments] — Stripe webhook handlers for
 * installment PaymentIntent events.
 *
 * Discriminated by metadata `mingla_installment_id` (set by the cron in
 * process-scheduled-installments/index.ts). The webhook router in
 * stripeWebhookRouter.ts checks this metadata BEFORE falling through to
 * the existing handleTicketCheckoutPaymentIntent handler.
 *
 * Per SPEC §3.2.3.
 *
 * Two events:
 *   - payment_intent.succeeded  → flip ledger row to status='collected'
 *   - payment_intent.payment_failed → flip ledger row to status='failed'
 *                                     + retry_count++ + dunning email
 *                                     + at_risk flag at retry_count >= 3
 *
 * Note: the CRON ALSO writes failure rows on each attempt (in case the
 * synchronous PI confirm errors with a non-recoverable error). The webhook
 * is the AUTHORITATIVE success-state writer (off_session PIs that need
 * 3DS challenge return processing first, succeed only via webhook). The
 * UPDATE on the row is idempotent: we use predicate-bound UPDATEs.
 */

// @ts-ignore — Deno ESM import
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { writeAudit } from "./audit.ts";

type StripeWebhookEvent = {
  type: string;
  data: { object: Record<string, unknown> };
};

const MAX_RETRY_ATTEMPTS = 3 as const;

const RETRY_INTERVAL_HOURS_BY_RETRY_COUNT = {
  1: 72,   // 3 days
  2: 168,  // 7 days
} as const;

function objectString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

function objectMetadata(obj: Record<string, unknown>): Record<string, unknown> {
  const m = obj["metadata"];
  return m && typeof m === "object" && !Array.isArray(m)
    ? (m as Record<string, unknown>)
    : {};
}

function nextRetryAtFor(retryCount: number): string | null {
  const hours = RETRY_INTERVAL_HOURS_BY_RETRY_COUNT[
    retryCount as keyof typeof RETRY_INTERVAL_HOURS_BY_RETRY_COUNT
  ];
  if (hours === undefined) return null;
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

/**
 * Returns true if the event's PaymentIntent metadata carries an
 * `mingla_installment_id` — i.e., this is a Tr3 installment PI, NOT the
 * existing ticket-checkout PI handled by handleTicketCheckoutPaymentIntent.
 *
 * Used by the webhook router for discrimination BEFORE calling the
 * existing handler.
 */
export function isInstallmentPaymentIntentEvent(
  event: StripeWebhookEvent,
): boolean {
  if (
    event.type !== "payment_intent.succeeded" &&
    event.type !== "payment_intent.payment_failed"
  ) {
    return false;
  }
  const metadata = objectMetadata(event.data.object);
  return typeof metadata["mingla_installment_id"] === "string";
}

export async function handleInstallmentPaymentSucceeded(
  supabase: SupabaseClient,
  event: StripeWebhookEvent,
): Promise<string | null> {
  const pi = event.data.object;
  const piId = objectString(pi, "id");
  if (piId === null) {
    throw new Error("installment_pi_succeeded missing payment_intent.id");
  }

  const metadata = objectMetadata(pi);
  const installmentId = typeof metadata["mingla_installment_id"] === "string"
    ? metadata["mingla_installment_id"]
    : null;
  if (installmentId === null) {
    throw new Error("installment_pi_succeeded missing mingla_installment_id metadata");
  }

  const brandId = typeof metadata["mingla_brand_id"] === "string"
    ? metadata["mingla_brand_id"]
    : null;

  // Charge id from PI (Stripe expands latest_charge by default for many events).
  const charges = pi["charges"] as { data?: Array<Record<string, unknown>> } | undefined;
  const latestCharge = charges?.data?.[0] ?? null;
  const chargeId = latestCharge !== null ? objectString(latestCharge, "id") : null;

  // Predicate-bound UPDATE: only mark collected if row is still scheduled.
  // Idempotent — concurrent cron + webhook arrivals serialize safely.
  const { data: updated, error } = await supabase
    .from("order_installments")
    .update({
      status: "collected",
      stripe_payment_intent_id: piId,
      stripe_charge_id: chargeId,
      collected_at: new Date().toISOString(),
      // Clear any prior failure state
      failed_at: null,
      failure_reason: null,
      next_retry_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", installmentId)
    .in("status", ["scheduled", "failed"]) // tolerate the case where cron already wrote failed before webhook arrived
    .select("id, order_id, ordinal, amount_cents")
    .maybeSingle();

  if (error) {
    throw new Error(`installment collected update failed: ${error.message}`);
  }
  if (updated === null) {
    // Row already collected (replay) or row missing — both ok.
    console.log(
      `[installment-webhook] payment_intent.succeeded for ${installmentId} — no-op (already collected or row missing)`,
    );
    return brandId;
  }

  await writeAudit(supabase, {
    user_id: null,
    brand_id: brandId,
    event_id: null,
    action: "tr3.installment_collected",
    target_type: "order_installment",
    target_id: installmentId,
    after: {
      ordinal: (updated as Record<string, unknown>).ordinal,
      amount_cents: (updated as Record<string, unknown>).amount_cents,
      stripe_payment_intent_id: piId,
      stripe_charge_id: chargeId,
    },
  });

  // Check if this was the LAST installment for the order → fire "fully paid" confirmation.
  // Simple check: count remaining scheduled/failed installments for the order.
  const orderId = String((updated as Record<string, unknown>).order_id);
  const { count: remainingCount, error: countError } = await supabase
    .from("order_installments")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .in("status", ["scheduled", "failed"]);

  if (countError === null && remainingCount === 0) {
    // Fire fully-paid notification via existing dispatcher.
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl !== undefined && serviceKey !== undefined) {
        await fetch(`${supabaseUrl}/functions/v1/ticket-confirmation-dispatch`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${serviceKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            kind: "installment_plan_paid_in_full",
            orderId,
          }),
        });
      }
    } catch (err) {
      console.error(
        "[installment-webhook] fully-paid notification dispatch failed (non-fatal)",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return brandId;
}

export async function handleInstallmentPaymentFailed(
  supabase: SupabaseClient,
  event: StripeWebhookEvent,
): Promise<string | null> {
  const pi = event.data.object;
  const piId = objectString(pi, "id");
  const metadata = objectMetadata(pi);
  const installmentId = typeof metadata["mingla_installment_id"] === "string"
    ? metadata["mingla_installment_id"]
    : null;
  if (installmentId === null) {
    throw new Error("installment_pi_failed missing mingla_installment_id metadata");
  }
  const brandId = typeof metadata["mingla_brand_id"] === "string"
    ? metadata["mingla_brand_id"]
    : null;
  const lastErr = pi["last_payment_error"] as Record<string, unknown> | undefined;
  const failureReason = lastErr !== undefined
    ? `${objectString(lastErr, "code") ?? objectString(lastErr, "type") ?? "unknown"}:${objectString(lastErr, "message") ?? ""}`.slice(0, 500)
    : "payment_failed_no_detail";

  // Fetch current row to compute retry transitions correctly. The cron may
  // already have written a failed row + retry_count for this attempt — in
  // that case the webhook's job is to confirm + ensure dunning fires.
  const { data: existing, error: fetchError } = await supabase
    .from("order_installments")
    .select("id, order_id, ordinal, retry_count, status")
    .eq("id", installmentId)
    .maybeSingle();
  if (fetchError !== null) {
    throw new Error(`installment fetch failed: ${fetchError.message}`);
  }
  if (existing === null) {
    console.log(`[installment-webhook] payment_intent.payment_failed for unknown installment ${installmentId}`);
    return brandId;
  }

  const existingRow = existing as Record<string, unknown>;
  const currentRetryCount = Number(existingRow.retry_count ?? 0);
  const currentStatus = String(existingRow.status ?? "");
  // If the cron already wrote 'failed' for this attempt, retry_count is
  // already incremented. We only increment here if the webhook fires
  // independently (cron synced confirm threw but webhook is the only
  // failure-event source for off_session PIs needing 3DS challenge).
  const shouldIncrement = currentStatus === "scheduled";
  const nextRetryCount = shouldIncrement ? currentRetryCount + 1 : currentRetryCount;
  const willBeAtRisk = nextRetryCount >= MAX_RETRY_ATTEMPTS;
  const nextRetryAt = willBeAtRisk ? null : nextRetryAtFor(nextRetryCount);

  await supabase
    .from("order_installments")
    .update({
      status: "failed",
      stripe_payment_intent_id: piId,
      failed_at: new Date().toISOString(),
      failure_reason: failureReason,
      retry_count: nextRetryCount,
      next_retry_at: nextRetryAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", installmentId)
    .in("status", ["scheduled", "failed"]);

  if (willBeAtRisk) {
    await supabase
      .from("orders")
      .update({
        at_risk: true,
        at_risk_since: new Date().toISOString(),
      })
      .eq("id", String(existingRow.order_id))
      .eq("at_risk", false);
  }

  await writeAudit(supabase, {
    user_id: null,
    brand_id: brandId,
    event_id: null,
    action: "tr3.installment_failed_webhook",
    target_type: "order_installment",
    target_id: installmentId,
    after: {
      ordinal: existingRow.ordinal,
      retry_count: nextRetryCount,
      next_retry_at: nextRetryAt,
      failure_reason: failureReason,
      at_risk_flipped: willBeAtRisk,
    },
  });

  // Fire dunning email via existing dispatcher (dedup-safe because the cron
  // already fired; the dispatcher's idempotency is the buyer-email-level
  // delivery dedup which is operator-acceptable for now).
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl !== undefined && serviceKey !== undefined) {
      await fetch(`${supabaseUrl}/functions/v1/ticket-confirmation-dispatch`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${serviceKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "installment_dunning",
          orderId: String(existingRow.order_id),
          installmentId,
          installmentOrdinal: existingRow.ordinal,
          failureReason,
        }),
      });
    }
  } catch (err) {
    console.error(
      "[installment-webhook] dunning email dispatch failed (non-fatal)",
      err instanceof Error ? err.message : err,
    );
  }

  return brandId;
}
