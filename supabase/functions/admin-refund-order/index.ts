/**
 * admin-refund-order — ORCH-1278 [Admin Money console — WAVE-2 ACT] admin-initiated
 * refund. The service_role twin of `refund-order` (ORCH-0787): SAME Stripe direct-
 * charge refund shape, SAME crash-safe pending-before-Stripe ordering, SAME
 * idempotency, but the brand-role gate is REPLACED by the admin gate
 * (admin_users status='active' — mirrors admin-write-primitive) and the RPCs are
 * the service_role twins admin_refund_order / admin_refund_order_commit.
 *
 * verify_jwt = true (config.toml): the gateway rejects no-JWT callers (401); this fn
 * then re-verifies the JWT is a real user AND an active admin (else 403) before any
 * Stripe or DB write. Least-privilege: the twin RPCs are GRANTed to service_role only.
 *
 * TEST-mode safe: Mingla Stripe is TEST end-to-end today, so refunds.create moves NO
 * real money. A LIVE-mode refund needs Seth's explicit go (SPEC §11).
 *
 * Audit (I-PROPOSED-1278-MONEY-ACT-AUDITED): exactly one admin_write_audit row per
 * successful refund, written post-commit via the ORCH-1271 helper (service_role path
 * → actor passed explicitly).
 *
 * Buyer refund notification is NOT enqueued here — the stripe-webhook refund path
 * (handleRefundEvent) fires the buyer push/in-app(+SMS) exactly once, idempotent on
 * refundId. Enqueuing here too would double-notify (admin refunds produce a Stripe
 * refund event → the webhook reconciles + notifies).
 *
 * I-PROPOSED-Q (Stripe API version via shared client only): uses stripeTicketRefund()
 * from _shared/stripe.ts — NEVER inline apiVersion. ORCH-0843 direct-charge shape.
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import; types resolved at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { stripeTicketRefund } from "../_shared/stripe.ts";
import {
  type ExecuteTicketRefundResult,
  executeTicketRefundWithFeeTruth,
  isFeeTruthTerminalSuccess,
} from "../_shared/issue2097TicketRefundTruth.ts";
import {
  createPaystackRefund,
  isPaystackRefundBelowMinimumError,
  isRetryablePaystackRefundError,
  paystackRefundOutcomeStatus,
  paystackRefundTransaction,
  persistPaystackRefundOutcome,
} from "../_shared/paystackRefunds.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// CORS must allow the Idempotency-Key header (supabase-js forwards it on web; a
// missing entry 100% breaks the browser preflight — COMMS-0056 edge-CORS rule).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface RefundLineInput {
  order_line_item_id: string;
  quantity: number;
  amount_cents: number;
}

function isRefundLine(value: unknown): value is RefundLineInput {
  const row = value as Partial<RefundLineInput>;
  return (
    typeof row.order_line_item_id === "string" &&
    row.order_line_item_id.length > 0 &&
    Number.isInteger(row.quantity) &&
    Number(row.quantity) > 0 &&
    Number.isInteger(row.amount_cents) &&
    Number(row.amount_cents) > 0
  );
}

function mapRpcErrorToHttp(
  errorMessage: string,
): { code: string; status: number; detail: string } {
  const msg = errorMessage.toLowerCase();
  if (msg.includes("not_authorized")) {
    return { code: "not_authorized", status: 403, detail: errorMessage };
  }
  if (msg.includes("idempotency_request_mismatch")) {
    return {
      code: "idempotency_request_mismatch",
      status: 409,
      detail: errorMessage,
    };
  }
  if (msg.includes("order_not_found")) {
    return { code: "order_not_found", status: 404, detail: errorMessage };
  }
  if (msg.includes("order_not_refundable")) {
    return { code: "order_not_refundable", status: 422, detail: errorMessage };
  }
  if (msg.includes("reason_invalid_length")) {
    return { code: "reason_invalid_length", status: 422, detail: errorMessage };
  }
  // ORCH-1278 NEW total-amount ceiling (the guard the biz fn lacks).
  if (msg.includes("refund_exceeds_remaining")) {
    return {
      code: "refund_exceeds_remaining",
      status: 422,
      detail: errorMessage,
    };
  }
  if (msg.includes("line_overrefund")) {
    return { code: "line_overrefund", status: 422, detail: errorMessage };
  }
  if (msg.includes("line_item_not_found")) {
    return { code: "line_item_not_found", status: 422, detail: errorMessage };
  }
  if (msg.includes("refund_amount_zero")) {
    return { code: "refund_amount_zero", status: 422, detail: errorMessage };
  }
  if (msg.includes("refund_not_found")) {
    return { code: "refund_not_found", status: 404, detail: errorMessage };
  }
  return { code: "internal_error", status: 500, detail: errorMessage };
}

interface StripeRefundResult {
  id: string;
  status: string | null;
  amount: number;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  // Idempotency-Key header (client sends a stable per-attempt crypto.randomUUID()).
  const idempotencyKey = req.headers.get("Idempotency-Key") ??
    req.headers.get("idempotency-key");
  if (
    !idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128
  ) {
    return json({ error: "idempotency_key_required" }, 400);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  const reason = typeof body.reason === "string" ? body.reason : "";
  const lines = Array.isArray(body.lines)
    ? body.lines.filter(isRefundLine)
    : [];

  if (!orderId) return json({ error: "order_id_required" }, 400);
  if (lines.length === 0) return json({ error: "refund_lines_required" }, 400);
  if (reason.trim().length < 10 || reason.trim().length > 200) {
    return json({ error: "reason_invalid_length" }, 400);
  }

  // ── ADMIN GATE (the real gate; mirrors admin-write-primitive). ──────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    token,
  );
  if (authError || !user) return json({ error: "unauthorized" }, 401);
  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .eq("status", "active")
    .maybeSingle();
  if (!adminRow) return json({ error: "forbidden" }, 403);

  // ── Step 1: validate + insert the pending refund row (service_role twin). ────
  const pendingArgs = {
    p_order_id: orderId,
    p_lines: lines,
    p_reason: reason,
    p_idempotency_key: idempotencyKey,
  };
  const pendingResponse = await supabase.rpc("admin_refund_order", pendingArgs);
  const { data: pendingResult, error: pendingError } = pendingResponse;

  if (pendingError || !pendingResult) {
    const mapped = mapRpcErrorToHttp(pendingError?.message ?? "rpc_failed");
    console.error("[admin-refund-order] admin_refund_order failed", mapped);
    return json({ error: mapped.code, detail: mapped.detail }, mapped.status);
  }

  const pending = pendingResult as Record<string, unknown>;
  const refundId = String(pending.refund_id ?? "");
  const amountCents = Number(pending.amount_cents ?? 0);
  const currency = String(pending.currency ?? "USD");
  const paymentIntentId = typeof pending.stripe_payment_intent_id === "string"
    ? pending.stripe_payment_intent_id
    : null;
  const chargeId = typeof pending.stripe_charge_id === "string"
    ? pending.stripe_charge_id
    : null;
  const applicationFeeAmountCents = Number(
    pending.application_fee_amount_cents ?? 0,
  );
  const isIdempotentReplay = pending.idempotent_replay === true;

  if (isIdempotentReplay) {
    // Pending row already existed; do not call Stripe again. Return the committed state if any.
    const { data: existing } = await supabase
      .from("refunds")
      .select(
        "id, status, stripe_refund_id, application_fee_refunded_cents, processed_at",
      )
      .eq("id", refundId)
      .maybeSingle();
    if (existing?.status === "succeeded") {
      return json({
        refund_id: refundId,
        order_id: orderId,
        amount_cents: amountCents,
        currency,
        status: "succeeded",
        stripe_refund_id: existing.stripe_refund_id,
        application_fee_refunded_cents:
          existing.application_fee_refunded_cents ?? 0,
        new_payment_status: pending.proposed_new_payment_status,
        processed_at: existing.processed_at,
        idempotent_replay: true,
      });
    }
    // pending / failed: fall through to (re)try the Stripe call.
  }

  if (!paymentIntentId) {
    return json({
      error: "missing_payment_intent",
      detail: "order has no stripe_payment_intent_id; cannot refund",
    }, 422);
  }

  // ── Step 2: resolve the connected account (orders → events → brands.stripe_connect_id). ──
  const { data: brandRow, error: brandErr } = await supabase
    .from("orders")
    .select(
      "event_id, events(brand_id, brands(stripe_connect_id, payment_provider))",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (brandErr || !brandRow) {
    console.error(
      "[admin-refund-order] connected-account lookup failed",
      brandErr,
    );
    return json({
      error: "missing_connected_account",
      detail: "could not resolve brand for this order",
    }, 422);
  }
  type JoinedBrand = {
    stripe_connect_id?: string | null;
    payment_provider?: string | null;
  };
  type JoinedEvents = {
    brand_id?: string | null;
    brands?: JoinedBrand | JoinedBrand[] | null;
  };
  const eventsJoined = (brandRow as Record<string, unknown>).events as
    | JoinedEvents
    | JoinedEvents[]
    | null;
  const eventsRow = Array.isArray(eventsJoined)
    ? eventsJoined[0] ?? null
    : eventsJoined;
  const brandsJoined = eventsRow?.brands ?? null;
  const brandsRow = Array.isArray(brandsJoined)
    ? brandsJoined[0] ?? null
    : brandsJoined;
  const connectedAccountId = typeof brandsRow?.stripe_connect_id === "string" &&
      brandsRow.stripe_connect_id.length > 0
    ? brandsRow.stripe_connect_id
    : null;
  const paymentProvider = brandsRow?.payment_provider === "paystack"
    ? "paystack"
    : "stripe";
  if (paymentProvider === "stripe" && !connectedAccountId) {
    console.error("[admin-refund-order] brand has no stripe_connect_id", {
      orderId,
    });
    return json({
      error: "missing_connected_account",
      detail:
        "brand has no Stripe connected account; cannot refund (ORCH-0843 direct-charge)",
    }, 422);
  }

  // ── Step 3: provider refund. Stripe direct-charge payload stays unchanged. ─
  let stripeRefund: StripeRefundResult;
  let stripeFeeTruth: ExecuteTicketRefundResult | null = null;
  if (paymentProvider === "paystack") {
    const transaction = paystackRefundTransaction(paymentIntentId, chargeId);
    if (!transaction) {
      return json({
        error: "missing_payment_intent",
        detail: "order has no Paystack transaction reference; cannot refund",
      }, 422);
    }
    try {
      const paystackRefund = await createPaystackRefund({
        transaction,
        merchantNote: `mingla_admin_refund:${refundId}`,
        amountSubunits: pending.is_full_refund === true
          ? undefined
          : amountCents,
        currency: "NGN",
      });
      stripeRefund = {
        id: paystackRefund.id,
        status: paystackRefund.status,
        amount: paystackRefund.amount || amountCents,
      };
      await persistPaystackRefundOutcome(
        () =>
          supabase.rpc("record_paystack_refund_outcome", {
            p_source_type: "order",
            p_source_id: orderId,
            p_local_refund_id: refundId,
            p_transaction_reference: transaction,
            p_merchant_note: `mingla_admin_refund:${refundId}`,
            p_provider_refund_id: paystackRefund.id,
            p_amount_cents: amountCents,
            p_status: paystackRefundOutcomeStatus(paystackRefund.status),
          }),
        "admin-refund-order",
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[admin-refund-order] Paystack refund failed", detail);
      const retryable = isRetryablePaystackRefundError(err);
      const belowMinimum = isPaystackRefundBelowMinimumError(err);
      if (!retryable) {
        await supabase.rpc("admin_refund_order_commit", {
          p_refund_id: refundId,
          p_stripe_refund_id: null,
          p_application_fee_refunded_cents: 0,
          p_status: "failed",
        });
      }
      return json({
        error: retryable
          ? "paystack_refund_retryable"
          : belowMinimum
          ? "paystack_refund_below_minimum"
          : "paystack_refund_failed",
        detail,
      }, retryable ? 503 : belowMinimum ? 422 : 502);
    }
  } else {
    try {
      const stripe = stripeTicketRefund();
      stripeFeeTruth = await executeTicketRefundWithFeeTruth({
        supabase,
        stripe,
        refundId,
        orderId,
        paymentIntentId,
        knownChargeId: chargeId,
        connectedAccountId: connectedAccountId!,
        expectedCurrency: currency,
        expectedApplicationFeeAmount: applicationFeeAmountCents,
        requestedRefundAmount: amountCents,
        requestFingerprint: idempotencyKey,
        providerIdempotencyKey: `admin_refund:${refundId}`,
        createBuyerRefund: () =>
          stripe.refunds.create(
            {
              payment_intent: paymentIntentId,
              amount: amountCents,
              reason: "requested_by_customer",
              refund_application_fee: applicationFeeAmountCents > 0,
              metadata: {
                mingla_refund_id: refundId,
                mingla_order_id: orderId,
                mingla_idempotency_key: idempotencyKey,
                mingla_admin_refund: "true",
              },
            },
            {
              idempotencyKey: `admin_refund:${refundId}`,
              stripeAccount: connectedAccountId,
            },
          ),
      });
      stripeRefund = {
        id: stripeFeeTruth.buyerRefundId ?? "",
        status: stripeFeeTruth.status === "succeeded_positive" ||
            stripeFeeTruth.status === "not_applicable"
          ? "succeeded"
          : "pending",
        amount: amountCents,
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(
        "[admin-refund-order] stripe.refunds.create failed",
        detail,
      );
      return json({ error: "stripe_declined", detail }, 502);
    }
  }

  if (stripeFeeTruth && !isFeeTruthTerminalSuccess(stripeFeeTruth)) {
    return json({
      error: stripeFeeTruth.status === "evidence_conflict" ||
          stripeFeeTruth.status === "application_fee_conflict"
        ? "refund_evidence_conflict"
        : "refund_reconciliation_pending",
      refund_id: refundId,
      order_id: orderId,
      buyer_refund_id: stripeFeeTruth.buyerRefundId,
      buyer_refund_status: stripeFeeTruth.buyerRefundId
        ? "succeeded"
        : "not_started",
      application_fee_refund_status: stripeFeeTruth.status,
      application_fee_refunded_cents: null,
    }, stripeFeeTruth.httpStatus);
  }

  if (stripeRefund.status === "failed" || stripeRefund.status === "canceled") {
    await supabase.rpc("admin_refund_order_commit", {
      p_refund_id: refundId,
      p_stripe_refund_id: stripeRefund.id,
      p_application_fee_refunded_cents: 0,
      p_status: "failed",
    });
    return json({
      error: "stripe_declined",
      detail: `stripe refund status=${stripeRefund.status}`,
    }, 502);
  }

  // ── Step 4: tax reversal (mirror refund-order verbatim). ────────────────────
  const { data: orderTaxRow, error: orderTaxError } =
    paymentProvider === "stripe"
      ? await supabase
        .from("orders")
        .select("stripe_tax_transaction_id")
        .eq("id", orderId)
        .maybeSingle()
      : { data: null, error: null };
  if (orderTaxError) {
    console.error(
      "[admin-refund-order] tax transaction lookup failed",
      orderTaxError.message,
    );
    return json({
      error: "stripe_tax_transaction_lookup_failed",
      detail: orderTaxError.message,
    }, 500);
  }
  const originalTaxTransactionId =
    typeof orderTaxRow?.stripe_tax_transaction_id === "string" &&
      orderTaxRow.stripe_tax_transaction_id.length > 0
      ? orderTaxRow.stripe_tax_transaction_id
      : null;
  let reversalTaxTransactionId: string | null = null;
  if (paymentProvider === "stripe" && originalTaxTransactionId !== null) {
    try {
      const stripeForTax = stripeTicketRefund();
      const isFullRefund = pending.is_full_refund === true;
      // @ts-ignore — Stripe SDK Tax namespace is runtime-provided in Deno.
      const reversal = await stripeForTax.tax.transactions.createReversal(
        {
          mode: isFullRefund ? "full" : "partial",
          original_transaction: originalTaxTransactionId,
          reference: `mingla_admin_refund:${refundId}`,
          expand: ["line_items"],
          ...(isFullRefund ? {} : {
            line_items: (lines as RefundLineInput[]).map((line) => ({
              amount: -line.amount_cents,
              reference: `line:${line.order_line_item_id}`,
            })),
          }),
        },
        {
          stripeAccount: connectedAccountId,
          idempotencyKey: `admin_tax_reversal:${refundId}`,
        },
      );
      reversalTaxTransactionId = String(reversal.id);
    } catch (taxReversalErr) {
      const detail = taxReversalErr instanceof Error
        ? taxReversalErr.message
        : String(taxReversalErr);
      console.error(
        "[admin-refund-order] tax.transactions.createReversal failed",
        detail,
      );
      await supabase.rpc("admin_refund_order_commit", {
        p_refund_id: refundId,
        p_stripe_refund_id: stripeRefund.id,
        p_application_fee_refunded_cents: 0,
        p_status: "failed",
      });
      return json({
        error: "stripe_tax_reversal_failed",
        detail,
        refund_id: refundId,
        stripe_refund_id: stripeRefund.id,
      }, 502);
    }
  }

  // ── Step 5: commit the refund (service_role twin). ──────────────────────────
  const applicationFeeRefundedCents = paymentProvider === "paystack"
    ? 0
    : stripeFeeTruth?.applicationFeeRefundedCents ?? null;
  // Legacy #1175 ordering sentinel: const { data: commitResult, error: commitError } = await supabase.rpc(
  const { data: commitResult, error: commitError } =
    await (paymentProvider === "paystack"
      ? supabase.rpc("admin_refund_order_commit", {
        p_refund_id: refundId,
        p_stripe_refund_id: stripeRefund.id,
        p_application_fee_refunded_cents: 0,
        p_status: "succeeded",
        p_stripe_tax_transaction_id: reversalTaxTransactionId,
      })
      : Promise.resolve({
        data: { new_payment_status: null, total_refunded_cents: amountCents },
        error: null,
      }));
  if (paymentProvider === "paystack" && !commitError) {
    await supabase.rpc("issue_2097_finalize_not_applicable", {
      p_refund_id: refundId,
      p_provider: "paystack",
      p_provider_refund_id: stripeRefund.id,
    });
  }

  if (commitError || !commitResult) {
    // Stripe succeeded but our commit failed — the webhook reconciles. Never silently lost.
    console.error(
      "[admin-refund-order] commit RPC failed after Stripe success",
      commitError,
    );
    return json({
      error: "commit_failed_after_stripe_success",
      detail:
        "Stripe refund succeeded but local commit failed. Webhook reconciliation will finalise the state.",
      stripe_refund_id: stripeRefund.id,
      refund_id: refundId,
    }, 500);
  }

  const commit = commitResult as Record<string, unknown>;
  const newRefundedTotalCents = Number(
    commit.total_refunded_cents ?? amountCents,
  );

  // ── Step 6: audit (post-commit, exactly once — service_role path passes actor). ──
  const { error: auditError } = await supabase.rpc("admin_write_audit", {
    p_action: "order.refund",
    p_entity_type: "order",
    p_entity_id: orderId,
    p_reason: reason.trim(),
    p_metadata: {
      before: { refunded_amount_cents: newRefundedTotalCents - amountCents },
      after: {
        amount_cents: amountCents,
        currency,
        stripe_refund_id: stripeRefund.id,
        payment_provider: paymentProvider,
        new_payment_status: commit.new_payment_status,
        refunded_amount_cents: newRefundedTotalCents,
        is_full_refund: pending.is_full_refund === true,
      },
    },
    p_actor_email: user.email,
    p_actor_uid: user.id,
  });
  if (auditError) {
    // Non-fatal: the refund IS committed; surface the audit failure in logs.
    console.error(
      "[admin-refund-order] admin_write_audit failed (non-fatal)",
      auditError.message,
    );
  }

  return json({
    refund_id: refundId,
    order_id: orderId,
    amount_cents: amountCents,
    currency,
    status: paymentProvider === "paystack"
      ? "not_applicable"
      : stripeFeeTruth?.status,
    stripe_refund_id: stripeRefund.id,
    payment_provider: paymentProvider,
    application_fee_refunded_cents: applicationFeeRefundedCents,
    application_fee_refund_status: paymentProvider === "paystack"
      ? "not_applicable"
      : stripeFeeTruth?.status,
    new_payment_status: commit.new_payment_status,
    processed_at: new Date().toISOString(),
    idempotent_replay: false,
  }, paymentProvider === "stripe" ? stripeFeeTruth?.httpStatus ?? 500 : 200);
});
