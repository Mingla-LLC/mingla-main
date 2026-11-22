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
// #3645: one retry rule for both rails (due_at + 3d, + 7d, at risk on the third).
import {
  MAX_RETRY_ATTEMPTS,
  nextRetryAtAfterFailure,
} from "./installments/installmentRetrySchedule.ts";
import {
  installmentFeeCents,
  resolveInstallmentFeeRate,
} from "./installments/installmentFeeRate.ts";
import { rollOverMissedPayment } from "./installments/missedRollover.ts";
import { planV2SchemaAvailable } from "./installments/planV2Schema.ts";
import { claimPaidInFullNotice } from "./installments/paidInFullNotice.ts";
import { returnOrderOverpaymentsBestEffort } from "./installments/overpaymentLane.ts";
import { installmentOpsAlert } from "./installments/installmentOpsAlert.ts";
// The one reader of a PaymentIntent's charge id. The router imports this
// module too; the cycle is safe because both sides only export function
// declarations and neither calls the other while the module loads.
import { paymentIntentChargeId } from "./stripeWebhookRouter.ts";

type StripeWebhookEvent = {
  type: string;
  data: { object: Record<string, unknown> };
};

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

  // Charge id from the PaymentIntent. The pinned Stripe API sends
  // `latest_charge` (an id, or an object when expanded) and no `charges` list,
  // so reading only `charges.data[0]` saved a null charge id on every
  // collected installment. The shared helper reads `latest_charge` first.
  const chargeId = paymentIntentChargeId(pi);

  // issue #4522 (F6) — before the #4522 migrations are applied the row has
  // no `kind`; every read below then takes exactly the pre-#4522 shape.
  const planV2 = await planV2SchemaAvailable(supabase);

  // Predicate-bound UPDATE: only mark collected if row is still scheduled
  // (or failed: cron may have written failed before the webhook arrived).
  // Idempotent — concurrent cron + webhook arrivals serialize safely.
  const collectedUpdate = {
    status: "collected",
    stripe_payment_intent_id: piId,
    stripe_charge_id: chargeId,
    collected_at: new Date().toISOString(),
    // Clear any prior failure state
    failed_at: null,
    failure_reason: null,
    next_retry_at: null,
    updated_at: new Date().toISOString(),
  };
  const { data: updated, error } = planV2
    ? await supabase.from("order_installments").update(collectedUpdate)
      .eq("id", installmentId).in("status", ["scheduled", "failed"])
      .select("id, order_id, ordinal, amount_cents, kind").maybeSingle()
    : await supabase.from("order_installments").update(collectedUpdate)
      .eq("id", installmentId).in("status", ["scheduled", "failed"])
      .select("id, order_id, ordinal, amount_cents").maybeSingle();

  if (error) {
    throw new Error(`installment collected update failed: ${error.message}`);
  }

  // The fee Stripe actually took; if the PaymentIntent does not carry it, the
  // brand's effective rate (the same one createInstallmentPI charged).
  const applicationFeeFromPi = async (
    piObj: Record<string, unknown>,
    amountCents: number,
  ): Promise<number> => {
    const appFeeRaw = piObj["application_fee_amount"];
    if (typeof appFeeRaw === "number") return Math.max(0, Math.trunc(appFeeRaw));
    return installmentFeeCents(
      amountCents,
      await resolveInstallmentFeeRate(supabase, brandId),
    );
  };

  const recordProviderSaleOrThrow = async (
    amountCents: number,
  ): Promise<void> => {
    const applicationFeeAmountCents = await applicationFeeFromPi(pi, amountCents);
    const { data: feeRpcData, error: feeRpcError } = await supabase.rpc(
      "record_order_installment_provider_sale",
      {
        p_installment_id: installmentId,
        p_application_fee_amount_cents: applicationFeeAmountCents,
        p_provider_fee_cents: 0,
      },
    );
    if (feeRpcError !== null) {
      throw new Error(
        `record_order_installment_provider_sale failed: ${feeRpcError.message}`,
      );
    }
    const feeResult = (feeRpcData ?? null) as {
      ok?: boolean;
      reason?: string;
      status?: string;
    } | null;
    if (feeResult === null || feeResult.ok !== true) {
      const reason = String(feeResult?.reason ?? "unknown");
      // Cancel race: charge succeeded but row is not collected. Never ack —
      // inbox must retry / ops recover (refund) the succeeded PI.
      throw new Error(
        `record_order_installment_provider_sale rejected:${reason}:status=${
          feeResult?.status ?? "?"
        }:installment=${installmentId}`,
      );
    }
  };

  if (updated === null) {
    // Already collected (replay) or row missing/cancelled. Missing or
    // cancelled must fail closed — never mark the money event processed.
    const loadReplayRow = async () =>
      planV2
        ? await supabase.from("order_installments")
          .select("id, amount_cents, status, payout_accounting_state, application_fee_amount_cents, kind")
          .eq("id", installmentId).maybeSingle()
        : await supabase.from("order_installments")
          .select("id, amount_cents, status, payout_accounting_state, application_fee_amount_cents")
          .eq("id", installmentId).maybeSingle();
    let { data: existing, error: existingError } = await loadReplayRow();
    if (existingError !== null) {
      throw new Error(`installment replay load failed: ${existingError.message}`);
    }
    // issue #4522 (F1/F2) — the charge landed on a row that is no longer
    // open: a released flexible payment confirmed late is collected and
    // settled once; a planned row superseded while its charge was landing is
    // held as an overpayment. Either way the money is recorded, never looped.
    if (
      planV2 && existing !== null &&
      String((existing as Record<string, unknown>).status ?? "") === "superseded"
    ) {
      const received = Number(pi["amount_received"] ?? pi["amount"]);
      const { data: late, error: lateError } = await supabase.rpc(
        "issue_4522_record_late_collection",
        {
          p_installment_id: installmentId,
          p_amount_minor: Number.isSafeInteger(received) && received > 0 ? received : null,
          p_provider_ref: piId,
          p_charge_ref: chargeId,
        },
      );
      const lateResult = (late ?? null) as { ok?: boolean; outcome?: string; reason?: string } | null;
      if (lateError !== null || lateResult?.ok !== true) {
        throw new Error(
          `issue_4522_record_late_collection failed: ${
            lateError?.message ?? lateResult?.reason ?? "unknown"
          }`,
        );
      }
      if (lateResult.outcome === "held") {
        console.warn(
          `[installment-webhook] payment_intent.succeeded for superseded ${installmentId} — held as an overpayment`,
        );
        const lateOrder = await orderIdOf(supabase, installmentId);
        if ((lateResult as { alertOps?: boolean }).alertOps === true) {
          await installmentOpsAlert("Late trip payment for an unexpected amount", [
            "A traveler's released flexible trip payment was confirmed late for an amount Mingla never asked for.",
            `Instalment: ${installmentId}`,
            `PaymentIntent: ${piId}; received: ${String(pi["amount_received"] ?? pi["amount"] ?? "?")}`,
            "It was recorded and is being refunded in full automatically. The plan was not changed.",
          ]);
        }
        // issue #4522 (N2) — the money goes straight back to the traveler.
        if (lateOrder !== null) await returnOrderOverpaymentsBestEffort(supabase, lateOrder);
        return brandId;
      }
      // A released flexible payment confirmed late was collected and settled
      // just now: its email and any money it held follow the same rules.
      await afterFlexSettle(
        supabase,
        ((lateResult as { settle?: FlexSettleResult }).settle ?? null),
        "stripe_late_success",
      );
      ({ data: existing, error: existingError } = await loadReplayRow());
      if (existingError !== null) {
        throw new Error(`installment replay load failed: ${existingError.message}`);
      }
    }
    if (existing === null) {
      throw new Error(
        `installment_pi_succeeded missing installment row ${installmentId}`,
      );
    }
    const existingRow = existing as Record<string, unknown>;
    const existingStatus = String(existingRow.status ?? "");
    if (existingStatus === "cancelled") {
      throw new Error(
        `installment_pi_succeeded on cancelled installment ${installmentId}: durable refund/recovery required`,
      );
    }
    const accountingState = String(existingRow.payout_accounting_state ?? "");
    const feesMissing = existingRow.application_fee_amount_cents == null;
    if (accountingState !== "ready" || feesMissing) {
      await recordProviderSaleOrThrow(Number(existingRow.amount_cents ?? 0));
    }
    // issue #4522 — a replay finishes a settle a crash interrupted (idempotent);
    // a late or retried settlement that completes the balance sends the
    // paid-in-full email (claimed once per order) and any money held goes back.
    if (existingStatus === "collected") {
      const settled = await settleFlexPaymentIfFlex(supabase, installmentId, existingRow.kind);
      await afterFlexSettle(supabase, settled, "stripe_webhook_replay");
    }
    console.log(
      `[installment-webhook] payment_intent.succeeded for ${installmentId} — replay accounting ok`,
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

  // #3645 / #2036 — record fees so a collected installment can enter the payout
  // ledger once issue_2036_installment_payout_ready() is flipped. Throw on RPC
  // failure so the webhook inbox retries (collect already stuck; accounting must
  // catch up on replay).
  await recordProviderSaleOrThrow(
    Number((updated as Record<string, unknown>).amount_cents ?? 0),
  );
  // issue #4522 — a flexible payment re-spreads the open balance, once.
  const settled = await settleFlexPaymentIfFlex(
    supabase,
    installmentId,
    (updated as Record<string, unknown>).kind,
  );
  // issue #4522 (edge case) — a planned charge that landed for more than its
  // row now owes (re-spread between the cron's claim and the PaymentIntent id
  // being saved): the row keeps its amount and the excess goes back.
  if (planV2 && (updated as Record<string, unknown>).kind === "scheduled") {
    const received = Number(pi["amount_received"] ?? pi["amount"]);
    const rowAmount = Number((updated as Record<string, unknown>).amount_cents ?? 0);
    if (Number.isSafeInteger(received) && received > rowAmount) {
      const { error: excessError } = await supabase.rpc("issue_4522_hold_collected_excess", {
        p_installment_id: installmentId,
        p_received_minor: received,
        p_provider_ref: piId,
      });
      if (excessError !== null) {
        throw new Error(`issue_4522_hold_collected_excess failed: ${excessError.message}`);
      }
      await returnOrderOverpaymentsBestEffort(
        supabase,
        String((updated as Record<string, unknown>).order_id),
      );
    }
  }
  if (settled !== null && Number(settled.heldMinor ?? 0) > 0) {
    await returnOrderOverpaymentsBestEffort(supabase, String(settled.orderId ?? ""));
  }

  // Check if this was the LAST installment for the order → fire "fully paid" confirmation.
  // Simple check: count remaining scheduled/failed installments for the order.
  const orderId = String((updated as Record<string, unknown>).order_id);

  // #3645 (Q-2, both rails): an at-risk booking clears once nothing of the
  // order is failed. Throw so the inbox retries if the clear cannot be written.
  const { error: clearError } = await supabase.rpc(
    "issue_3645_clear_at_risk_if_settled",
    { p_order_id: orderId },
  );
  if (clearError !== null) {
    throw new Error(`issue_3645_clear_at_risk_if_settled failed: ${clearError.message}`);
  }
  const { count: remainingCount, error: countError } = await supabase
    .from("order_installments")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .in("status", ["scheduled", "failed"]);

  if (
    countError === null && remainingCount === 0 &&
    // issue #4522 (N7) — once per order with the #4522 schema; unchanged before it.
    await claimPaidInFullNotice(supabase, orderId, "stripe_webhook")
  ) {
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

/**
 * issue #4522 — after a flexible ("pay any amount") payment is collected, the
 * open planned rows are re-spread once (`issue_4522_settle_flex_payment` is
 * idempotent on replay). Throws so the webhook inbox retries on failure. A
 * planned row (kind `scheduled`) is untouched, byte for byte.
 */
export interface FlexSettleResult {
  ok?: boolean;
  reason?: string;
  replayed?: boolean;
  paidInFull?: boolean;
  completedBalance?: boolean;
  heldMinor?: number;
  orderId?: string;
}

export async function settleFlexPaymentIfFlex(
  supabase: SupabaseClient,
  installmentId: string,
  kind: unknown,
): Promise<FlexSettleResult | null> {
  if (kind !== "flex") return null;
  const { data, error } = await supabase.rpc("issue_4522_settle_flex_payment", {
    p_installment_id: installmentId,
  });
  const result = (data ?? null) as FlexSettleResult | null;
  if (error !== null || result === null || result.ok !== true) {
    throw new Error(
      `issue_4522_settle_flex_payment failed: ${
        error?.message ?? result?.reason ?? "unknown"
      }`,
    );
  }
  return result;
}

/** POST the existing paid-in-full email (same template and dispatcher as the normal path). */
async function dispatchPaidInFullEmail(orderId: string): Promise<void> {
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
        body: JSON.stringify({ kind: "installment_plan_paid_in_full", orderId }),
      });
    }
  } catch (err) {
    console.error(
      "[installment-webhook] fully-paid notification dispatch failed (non-fatal)",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * issue #4522 (N7 / N2) — after a late, retried or replayed flexible
 * settlement: the paid-in-full email when the balance is complete (claimed
 * once per order, never twice), and any money held goes back.
 */
export async function afterFlexSettle(
  supabase: SupabaseClient,
  settled: FlexSettleResult | null,
  source: string,
  sendEmail: (orderId: string) => Promise<void> = dispatchPaidInFullEmail,
): Promise<void> {
  if (settled === null) return;
  const orderId = String(settled.orderId ?? "");
  if (orderId === "") return;
  if (Number(settled.heldMinor ?? 0) > 0) {
    await returnOrderOverpaymentsBestEffort(supabase, orderId);
  }
  if (settled.paidInFull === true && await claimPaidInFullNotice(supabase, orderId, source)) {
    await sendEmail(orderId);
  }
}

async function orderIdOf(supabase: SupabaseClient, installmentId: string): Promise<string | null> {
  const { data } = await supabase.from("order_installments").select("order_id")
    .eq("id", installmentId).maybeSingle();
  const id = (data as { order_id?: unknown } | null)?.order_id;
  return typeof id === "string" ? id : null;
}

/** issue #4522 — record a flexible payment's failure, then close the row. */
export async function closeFailedFlexPayment(
  supabase: SupabaseClient,
  installmentId: string,
  piId: string | null,
  failureReason: string,
): Promise<void> {
  const { error: failError } = await supabase
    .from("order_installments")
    .update({
      status: "failed",
      stripe_payment_intent_id: piId,
      failed_at: new Date().toISOString(),
      failure_reason: failureReason,
      next_retry_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", installmentId)
    .eq("kind", "flex")
    .eq("status", "scheduled");
  if (failError !== null) {
    throw new Error(`flex failure update failed: ${failError.message}`);
  }
  const { error } = await supabase.rpc("issue_4522_close_failed_flex", {
    p_installment_id: installmentId,
  });
  if (error !== null) {
    throw new Error(`issue_4522_close_failed_flex failed: ${error.message}`);
  }
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
  const planV2 = await planV2SchemaAvailable(supabase);
  const { data: existing, error: fetchError } = planV2
    ? await supabase.from("order_installments")
      .select("id, order_id, ordinal, retry_count, status, due_at, kind")
      .eq("id", installmentId).maybeSingle()
    : await supabase.from("order_installments")
      .select("id, order_id, ordinal, retry_count, status, due_at")
      .eq("id", installmentId).maybeSingle();
  if (fetchError !== null) {
    throw new Error(`installment fetch failed: ${fetchError.message}`);
  }
  if (existing === null) {
    console.log(`[installment-webhook] payment_intent.payment_failed for unknown installment ${installmentId}`);
    return brandId;
  }
  // issue #4522 — a failed flexible payment is closed, never retried, and
  // sends no dunning: the planned rows it would have paid are unchanged.
  if (String((existing as Record<string, unknown>).kind ?? "") === "flex") {
    await closeFailedFlexPayment(supabase, installmentId, piId, failureReason);
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
  const lastRetry = nextRetryCount >= MAX_RETRY_ATTEMPTS;
  const nextRetryAt = lastRetry
    ? null
    : nextRetryAtAfterFailure(String(existingRow.due_at), nextRetryCount);

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

  // issue #4522 (D-7) — a v2 auto-adjust order rolls the missed payment onto
  // its later rows; otherwise the booking is flagged at risk as before.
  const willBeAtRisk = lastRetry &&
    !(planV2 && await rollOverMissedPayment(supabase, installmentId));
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
