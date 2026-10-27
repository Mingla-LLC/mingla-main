/**
 * Issue #3645 — Paystack charges for later trip instalments.
 *
 * MINGLA-INVARIANT: I-3645-PS-5 | issue #3645 | a verified success for an instalment that is already paid or no longer due is refunded in full automatically
 *
 * Every instalment money attempt has its own deterministic reference
 * (mingla-inst-<installment uuid>-<a|l|p><n>) recorded before the provider call.
 * A charge.success (or a pay-page status check) is trusted only after verify by
 * reference; the amount and currency must equal the attempt. The single writer
 * of instalment state is issue_3645_resolve_installment_attempt.
 */
// @ts-ignore — Deno ESM import
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { writeAudit } from "../audit.ts";
import {
  createPaystackRefund,
  isRetryablePaystackRefundError,
  paystackRefundCanonicalState,
  paystackRefundOutcomeStatus,
  paystackRefundTransaction,
} from "../paystackRefunds.ts";
import { sendOpsAlertEmail } from "../stripeOpsAlertEmail.ts";
import { resolveAlertRecipientValue } from "../secretBundle.ts";
import { defaultDispatchBuyerEmail, type DispatchBuyerEmail } from "./installmentPayLinks.ts";

export const INSTALLMENT_REFERENCE_PATTERN = /^mingla-inst-[0-9a-f-]{36}-[alp]\d+$/;

export function isInstallmentPaystackReference(reference: string | null | undefined): boolean {
  return typeof reference === "string" && INSTALLMENT_REFERENCE_PATTERN.test(reference);
}

/** The bind payload, built from the VERIFIED transaction only (never the webhook body). */
export function paystackAuthorizationFromVerifiedTxn(
  txn: Record<string, unknown>,
  sourceReference: string,
): Record<string, unknown> | null {
  const auth = txn.authorization;
  if (auth === null || typeof auth !== "object" || Array.isArray(auth)) return null;
  const a = auth as Record<string, unknown>;
  const customer = (txn.customer !== null && typeof txn.customer === "object" ? txn.customer : {}) as Record<
    string,
    unknown
  >;
  const s = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  return {
    authorization_code: s(a.authorization_code),
    reusable: a.reusable === true,
    channel: s(a.channel) ?? s(txn.channel),
    card_type: s(a.card_type) ?? s(a.brand),
    last4: s(a.last4),
    exp_month: s(a.exp_month),
    exp_year: s(a.exp_year),
    bank: s(a.bank),
    signature: s(a.signature),
    customer_code: s(customer.customer_code),
    authorization_email: s(customer.email),
    source_reference: sourceReference,
  };
}

export type InstallmentChargeStatus =
  | "installment_collected"
  | "installment_replayed"
  | "installment_refund_due"
  | "amount_mismatch"
  | "orphan";

export interface InstallmentWebhookDeps {
  createPaystackRefund: typeof createPaystackRefund;
  dispatchBuyerEmail: DispatchBuyerEmail;
  alertOps: (subject: string, paragraphs: string[]) => Promise<void>;
}

async function defaultAlertOps(subject: string, paragraphs: string[]): Promise<void> {
  const value = resolveAlertRecipientValue("stripe_disputes", "STRIPE_DISPUTE_ALERT_EMAILS");
  const recipients = Array.isArray(value)
    ? value.map((v) => String(v).trim()).filter(Boolean)
    : String(value ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  if (recipients.length === 0) {
    console.warn("[installment-paystack] ops alert recipients missing", { subject });
    return;
  }
  try {
    await sendOpsAlertEmail({ subject, paragraphs, recipients });
  } catch (err) {
    console.error("[installment-paystack] ops alert failed", {
      subject,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function defaultInstallmentWebhookDeps(): InstallmentWebhookDeps {
  return {
    createPaystackRefund,
    dispatchBuyerEmail: defaultDispatchBuyerEmail,
    alertOps: defaultAlertOps,
  };
}

interface AttemptRow {
  id: string;
  installment_id: string;
  method: string;
  state: string;
  amount_cents: number;
  reference: string;
  provider_transaction_id: string | null;
}

async function loadAttempt(
  supabase: SupabaseClient,
  by: { reference?: string; id?: string },
): Promise<AttemptRow | null> {
  let q = supabase
    .from("order_installment_charge_attempts")
    .select("id, installment_id, method, state, amount_cents, reference, provider_transaction_id");
  q = by.reference !== undefined ? q.eq("reference", by.reference) : q.eq("id", by.id);
  const { data, error } = await q.maybeSingle();
  if (error !== null) throw new Error(`instalment attempt load failed: ${error.message}`);
  return (data ?? null) as AttemptRow | null;
}

/**
 * Apply a VERIFIED Paystack success to its instalment attempt. Idempotent:
 * webhook retries, the pay page's status check and the cron reconcile may all
 * call it for the same reference. Throws on anything retryable so the webhook
 * inbox retries.
 */
export async function handleInstallmentPaystackCharge(
  supabase: SupabaseClient,
  reference: string,
  txn: Record<string, unknown>,
  depsIn: Partial<InstallmentWebhookDeps> = {},
): Promise<{ status: InstallmentChargeStatus; installmentId?: string }> {
  const deps = { ...defaultInstallmentWebhookDeps(), ...depsIn };
  const attempt = await loadAttempt(supabase, { reference });
  if (attempt === null) {
    await writeAudit(supabase, {
      user_id: null,
      brand_id: null,
      event_id: null,
      action: "paystack.charge_orphan_reference",
      target_type: "paystack_transaction",
      target_id: reference,
      after: { note: "installment reference matches no attempt" },
    });
    return { status: "orphan" };
  }

  const currencyOk = String(txn.currency ?? "").toUpperCase() === "NGN";
  const verifiedAmount = currencyOk ? Number(txn.amount) : null;
  const { data, error } = await supabase.rpc("issue_3645_resolve_installment_attempt", {
    p_attempt_id: attempt.id,
    p_outcome: "succeeded",
    p_provider_transaction_id: txn.id === undefined || txn.id === null ? null : String(txn.id),
    p_gateway_response: typeof txn.gateway_response === "string" ? txn.gateway_response : null,
    p_approval_url: null,
    p_provider_fee_cents: Number.isFinite(Number(txn.fees)) ? Math.max(0, Math.trunc(Number(txn.fees))) : 0,
    p_verified_amount_cents: verifiedAmount,
  });
  if (error !== null) throw new Error(`issue_3645_resolve_installment_attempt failed: ${error.message}`);
  const result = (data ?? {}) as Record<string, unknown>;

  if (result.ok !== true) {
    if (result.reason === "amount_mismatch") {
      await writeAudit(supabase, {
        user_id: null,
        brand_id: null,
        event_id: null,
        action: "paystack.charge_amount_mismatch",
        target_type: "order_installment",
        target_id: attempt.installment_id,
        after: {
          attempt_id: attempt.id,
          expected_cents: attempt.amount_cents,
          verified_cents: Number(txn.amount ?? 0),
          currency_ok: currencyOk,
        },
      });
      await deps.alertOps("Paystack instalment amount mismatch", [
        "A Paystack instalment payment was verified for a different amount or currency than Mingla asked for.",
        `Instalment: ${attempt.installment_id}`,
        `Expected: ${attempt.amount_cents} kobo; verified: ${String(txn.amount ?? "?")} ${String(txn.currency ?? "?")}`,
        "Nothing was collected or refunded automatically. Review it in the Paystack dashboard.",
      ]);
      return { status: "amount_mismatch", installmentId: attempt.installment_id };
    }
    throw new Error(`instalment attempt resolve refused: ${String(result.reason ?? "unknown")}`);
  }

  const outcome = String(result.outcome ?? "");
  if (outcome === "refund_due") {
    await refundInstallmentAttempt(supabase, attempt.id, deps);
    return { status: "installment_refund_due", installmentId: attempt.installment_id };
  }
  if (outcome === "replayed") return { status: "installment_replayed", installmentId: attempt.installment_id };
  if (outcome !== "collected") throw new Error(`unexpected instalment outcome ${outcome}`);

  const orderId = String(result.order_id ?? "");
  if (Number(result.remaining ?? 1) === 0 && orderId !== "") {
    await deps.dispatchBuyerEmail("installment_plan_paid_in_full", { orderId });
  }

  // A buyer who paid a later payment by a reusable card moves to automatic
  // charging for the payments still scheduled (same rule as the deposit).
  if (attempt.method !== "auto_card" && orderId !== "") {
    const auth = paystackAuthorizationFromVerifiedTxn(txn, reference);
    if (auth !== null && auth.reusable === true) {
      const { error: upgradeError } = await supabase.rpc("issue_3645_paystack_plan_bind", {
        p_order_id: orderId,
        p_authorization: auth,
        p_upgrade: true,
      });
      if (upgradeError !== null) {
        // Collection already stands; the upgrade is best-effort and the next
        // payment simply stays a pay link.
        console.error("[installment-paystack] card upgrade failed", {
          installmentId: attempt.installment_id,
          error: upgradeError.message,
        });
      }
    }
  }
  return { status: "installment_collected", installmentId: attempt.installment_id };
}

/**
 * Full automatic refund of a success that arrived for an instalment already
 * paid or no longer due. Never touches the instalment's own refunded amount
 * (the duplicate was never its collecting payment). Retryable provider errors
 * throw (the inbox retries; the merchant note dedupes the refund).
 */
export async function refundInstallmentAttempt(
  supabase: SupabaseClient,
  attemptId: string,
  depsIn: Partial<InstallmentWebhookDeps> = {},
): Promise<{ ok: boolean; reason?: string }> {
  const deps = { ...defaultInstallmentWebhookDeps(), ...depsIn };
  const attempt = await loadAttempt(supabase, { id: attemptId });
  if (attempt === null) throw new Error("refund attempt missing");
  if (attempt.state === "refunded") return { ok: true, reason: "already_refunded" };
  if (attempt.state !== "refund_due") return { ok: false, reason: `attempt_${attempt.state}` };

  const { data: inst, error: instError } = await supabase
    .from("order_installments")
    .select("id, order_id, currency")
    .eq("id", attempt.installment_id)
    .maybeSingle();
  if (instError !== null || inst === null) {
    throw new Error(`refund instalment load failed: ${instError?.message ?? "missing"}`);
  }
  const orderId = String((inst as Record<string, unknown>).order_id);
  const merchantNote = `mingla_inst_dup:${attempt.id}`;

  // Local refund row (idempotent by merchant note), tagged to the instalment
  // so it never counts against the deposit.
  const { data: existing } = await supabase
    .from("refunds")
    .select("id")
    .eq("order_installment_id", attempt.installment_id)
    .eq("metadata->>idempotency_key", merchantNote)
    .maybeSingle();
  let refundId = (existing as { id?: string } | null)?.id ?? null;
  if (refundId === null) {
    const { data: inserted, error: insertError } = await supabase
      .from("refunds")
      .insert({
        order_id: orderId,
        order_installment_id: attempt.installment_id,
        amount_cents: attempt.amount_cents,
        currency: "NGN",
        reason: "duplicate_installment_payment",
        status: "pending",
        metadata: { idempotency_key: merchantNote, kind: "installment_duplicate_refund" },
      })
      .select("id")
      .single();
    if (insertError !== null) throw new Error(`duplicate refund row failed: ${insertError.message}`);
    refundId = String((inserted as { id: string }).id);
  }

  const transaction = paystackRefundTransaction(attempt.reference, attempt.provider_transaction_id);
  if (transaction === null) throw new Error("duplicate refund has no transaction reference");
  let refund;
  try {
    refund = await deps.createPaystackRefund({ transaction, merchantNote, currency: "NGN" });
  } catch (err) {
    if (isRetryablePaystackRefundError(err)) throw err;
    await deps.alertOps("Paystack duplicate instalment refund failed", [
      "Mingla could not refund a duplicate instalment payment automatically.",
      `Instalment: ${attempt.installment_id}`,
      `Amount: ${attempt.amount_cents} kobo`,
      "Refund it by hand in the Paystack dashboard.",
    ]);
    await supabase.from("refunds").update({ status: "failed" }).eq("id", refundId).eq("status", "pending");
    return { ok: false, reason: "refund_failed" };
  }

  const status = paystackRefundOutcomeStatus(refund.status ?? null);
  const { error: outcomeError } = await supabase.rpc("record_paystack_refund_outcome", {
    p_source_type: "order_installment",
    p_source_id: attempt.installment_id,
    p_local_refund_id: refundId,
    p_transaction_reference: transaction,
    p_merchant_note: merchantNote,
    p_provider_refund_id: refund.id ?? null,
    p_amount_cents: attempt.amount_cents,
    p_status: status,
  });
  if (outcomeError !== null) throw new Error(`record_paystack_refund_outcome failed: ${outcomeError.message}`);
  if (status === "failed") {
    await deps.alertOps("Paystack duplicate instalment refund failed", [
      "Paystack declined the automatic refund of a duplicate instalment payment.",
      `Instalment: ${attempt.installment_id}`,
      `Amount: ${attempt.amount_cents} kobo`,
      "Refund it by hand in the Paystack dashboard.",
    ]);
    return { ok: false, reason: "refund_failed" };
  }

  if (paystackRefundCanonicalState(refund.status ?? null) === "processed") {
    await supabase.from("refunds").update({
      status: "succeeded",
      application_fee_refund_status: "not_applicable",
      application_fee_refunded_cents: 0,
      processed_at: new Date().toISOString(),
    }).eq("id", refundId).eq("status", "pending");
  }
  // The refund is accepted by Paystack: the attempt is settled.
  await supabase.from("order_installment_charge_attempts")
    .update({ state: "refunded" })
    .eq("id", attempt.id)
    .eq("state", "refund_due");
  await deps.dispatchBuyerEmail("installment_duplicate_refunded", {
    orderId,
    installmentId: attempt.installment_id,
    attemptId: attempt.id,
    amountCents: attempt.amount_cents,
    currency: "NGN",
  });
  return { ok: true };
}
