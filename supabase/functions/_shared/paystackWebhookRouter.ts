/**
 * paystackWebhookRouter — routes verified Paystack webhook events to the
 * existing order-finalize path (META-ORCH-1076 Phase 1).
 *
 * Mirrors the Stripe router split (_shared/stripeWebhookRouter.ts): the webhook
 * edge fn owns signature verify + the idempotent inbox; this module owns the
 * per-event business logic. charge.success → verify-by-reference → finalize via
 * the EXISTING biz_ticket_checkout_finalize RPC (no parallel finalize logic).
 *
 * Paystack docs cited inline (COMMS-0003):
 *   - Event envelope { event, data } + charge.success (NOT charge.succeeded):
 *       https://paystack.com/docs/payments/webhooks/
 *   - Verify Transaction (GET /transaction/verify/:reference; gate on
 *     data.status==="success" AND amount AND currency):
 *       https://paystack.com/docs/api/transaction/#verify
 *       https://paystack.com/docs/payments/verify-payments/
 *   - amount in subunits (kobo for NGN): https://paystack.com/docs/api/transaction/
 * Reference: Mingla_Artifacts/PAYSTACK_INTEGRATION_REFERENCE.md (Part 1.2, Part 4).
 */

// @ts-ignore — Deno ESM import; types resolved at runtime
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { writeAudit } from "./audit.ts";
import { qrTokenPepper } from "./ticketCheckout.ts";

// Verifier is injected so tests can stub the network call deterministically.
export type PaystackVerifier = (
  reference: string,
) => Promise<Record<string, unknown>>;

export interface PaystackChargeResult {
  status:
    | "finalized"
    | "replayed"
    | "orphan"
    | "amount_mismatch"
    | "currency_mismatch"
    | "verify_not_success";
  orderId?: string;
}

/**
 * Handle a Paystack `charge.success` event.
 *
 * Defense in depth (never trust the webhook body alone — §1.2):
 *   1. reference present (else throw → inbox marks retryable).
 *   2. verify-by-reference: data.status==="success".
 *   3. lookup session by stripe_payment_intent_id == reference.
 *   4. amount==session.total_cents (both kobo) AND currency=="NGN".
 *   5. finalize via biz_ticket_checkout_finalize (idempotent: order_id early-return).
 */
export async function handlePaystackChargeSuccess(
  supabase: SupabaseClient,
  data: Record<string, unknown>,
  verify: PaystackVerifier,
): Promise<PaystackChargeResult> {
  const reference = typeof data?.reference === "string" ? data.reference : "";
  if (!reference) {
    // Retryable — a charge.success with no reference is malformed.
    throw new Error("paystack_charge_success_missing_reference");
  }

  // 2. Verify-by-reference. Authoritative confirmation (the webhook body is a
  // hint; the verify call is the truth). Gate on data.status==="success".
  const txn = await verify(reference);
  const txnStatus = String(txn?.status ?? "").toLowerCase();
  if (txnStatus !== "success") {
    await writeAudit(supabase, {
      user_id: null,
      brand_id: null,
      action: "paystack.charge_verify_not_success",
      target_type: "paystack_transaction",
      target_id: reference,
      after: { verify_status: txnStatus },
    });
    return { status: "verify_not_success" };
  }

  // 3. Lookup the session by the persisted reference.
  const { data: session, error: sessionError } = await supabase
    .from("ticket_checkout_sessions")
    .select("id, status, order_id, total_cents, currency")
    .eq("stripe_payment_intent_id", reference)
    .maybeSingle();
  if (sessionError) {
    // Retryable — transient DB error.
    throw new Error(`paystack_session_lookup_failed: ${sessionError.message}`);
  }
  if (!session) {
    await writeAudit(supabase, {
      user_id: null,
      brand_id: null,
      action: "paystack.charge_orphan_reference",
      target_type: "paystack_transaction",
      target_id: reference,
      after: { note: "no session matches this reference" },
    });
    return { status: "orphan" };
  }

  // Idempotent fast-path: already finalized → return the order (mirrors the
  // finalize RPC's order_id early-return; cheap short-circuit).
  if (session.order_id) {
    return { status: "replayed", orderId: String(session.order_id) };
  }

  // 4. Amount + currency must match (§1.2 step 2 — "if the amount doesn't
  // match, don't deliver value"). amount is in subunits (kobo); session
  // total_cents is the all-in NGN total in kobo persisted at create.
  const verifiedAmount = Number(txn?.amount ?? NaN);
  const sessionTotal = Number(session.total_cents ?? NaN);
  const verifiedCurrency = String(txn?.currency ?? "").toUpperCase();

  if (!Number.isFinite(verifiedAmount) || verifiedAmount !== sessionTotal) {
    await markSessionFailed(supabase, String(session.id));
    await writeAudit(supabase, {
      user_id: null,
      brand_id: null,
      action: "paystack.charge_amount_mismatch",
      target_type: "ticket_checkout_session",
      target_id: String(session.id),
      after: { reference, verified_amount: verifiedAmount, session_total: sessionTotal },
    });
    return { status: "amount_mismatch" };
  }
  if (verifiedCurrency !== "NGN") {
    await markSessionFailed(supabase, String(session.id));
    await writeAudit(supabase, {
      user_id: null,
      brand_id: null,
      action: "paystack.charge_currency_mismatch",
      target_type: "ticket_checkout_session",
      target_id: String(session.id),
      after: { reference, verified_currency: verifiedCurrency },
    });
    return { status: "currency_mismatch" };
  }

  // 5. Finalize via the EXISTING RPC — order + line items + tickets + chat +
  // notifications, all reused. The Paystack reference goes in the PI-id slot
  // (text column, UNIQUE → idempotency); the Paystack txn id in the charge-id
  // slot; data.channel → payment_method type (card|bank|ussd|bank_transfer all
  // fall to online_card inside the RPC, acceptable v1).
  const channel = typeof txn?.channel === "string" ? txn.channel : "card";
  const txnId = txn?.id !== undefined && txn?.id !== null ? String(txn.id) : null;
  const { data: finalized, error: finalizeError } = await supabase.rpc(
    "biz_ticket_checkout_finalize",
    {
      p_checkout_session_id: String(session.id),
      p_stripe_payment_intent_id: reference,
      p_stripe_charge_id: txnId,
      p_stripe_payment_method_type: channel,
      p_qr_token_pepper: qrTokenPepper(),
      // Paystack Phase 1 has no installment plans — single full payment only
      // (ORCH-0921 gate: finalize callers must pass p_installment_plan_root).
      p_installment_plan_root: false,
    },
  );
  if (finalizeError || !finalized) {
    // Retryable — let the inbox retry the finalize.
    throw new Error(
      `paystack_finalize_failed: ${finalizeError?.message ?? "no result"}`,
    );
  }

  const orderId = String((finalized as Record<string, unknown>).orderId ?? "");
  return { status: "finalized", orderId };
}

async function markSessionFailed(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<void> {
  await supabase
    .from("ticket_checkout_sessions")
    .update({
      status: "failed",
      failed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
}
