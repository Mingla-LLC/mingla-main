/**
 * refund-order — ORCH-0787 organiser-initiated refund for online ticket orders.
 *
 * Flow per SPEC §3.1 (charge-shape per ORCH-0843 amended Path B):
 *   1. Validate request shape + JWT.
 *   2. Call biz_refund_order RPC (pending refund row + line items + caller permission gate).
 *   3. Look up the connected account id for this order's brand
 *      (orders → events → brands.stripe_connect_id) so we can issue the
 *      refund against the connected account (direct-charge shape).
 *   4. Call Stripe Refunds API with the Stripe-Account header (third-arg
 *      request option `stripeAccount`) — direct-charge shape per
 *      ORCH-0843. reverse_transfer is no longer needed (it was destination-
 *      charge syntax). refund_application_fee:true still tells Stripe to
 *      also refund the platform's application_fee_amount cut taken at
 *      charge time (Mingla's 1.5%).
 *   5. Call biz_refund_order_commit to flip refund.status, advance orders.payment_status,
 *      void affected tickets, update the denormalised refunded_amount_cents cache.
 *   6. Enqueue ticket_order_notifications row for the buyer (consumed by ORCH-0785 dispatcher).
 *   7. Write audit row + return success.
 *
 * I-PROPOSED-Q (Stripe API version via shared client only): uses stripeTicketRefund() from
 * _shared/stripe.ts. NEVER inline apiVersion literal.
 *
 * I-PROPOSED-H (RLS-RETURNING-OWNER-GAP): the RPC runs as SECURITY DEFINER and writes via
 * service-role client, so the helper-based RLS policy on public.refunds never blocks the
 * SELECT-for-RETURNING path. The direct-predicate SELECT policy added in migration 20260520000000
 * is the defense-in-depth backstop for any future caller that uses .insert().select() chains.
 *
 * ORCH-0843 — DO NOT re-introduce reverse_transfer; the charge object now lives on the
 * connected account so reverse_transfer is meaningless. CI gate
 * orch-0843-stripe-direct-charges-only.mjs enforces.
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { stripeTicketRefund } from "../_shared/stripe.ts";
import { writeAudit } from "../_shared/audit.ts";
import {
  dispatchTicketConfirmation,
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
  userClient,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";

interface RefundLineInput {
  order_line_item_id: string;
  quantity: number;
  amount_cents: number;
}

interface RefundOrderRequest {
  order_id: string;
  lines: RefundLineInput[];
  reason: string;
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

function mapRpcErrorToHttp(errorMessage: string): {
  code: string;
  status: number;
  detail: string;
} {
  // ORCH-0787 RPC raises with predictable prefixes (P0001..P0012 + permission_denied + line_overrefund:...)
  const msg = errorMessage.toLowerCase();
  if (msg.includes("permission_denied")) {
    return { code: "permission_denied", status: 403, detail: errorMessage };
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
  // Stripe Refund object: when refund_application_fee was true, the
  // application fee refund nests on a separate object; we read the platform's
  // recorded fee refund via the Refund.metadata or follow-up call. Defensive default 0.
  application_fee_refunded?: boolean;
}

serve(async (req: Request): Promise<Response> => {
  // @ts-ignore — ticketCorsHeaders typed as readonly record at runtime
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const idempotencyKey = req.headers.get("Idempotency-Key") ??
    req.headers.get("idempotency-key");
  if (
    !idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128
  ) {
    return jsonResponse({ error: "idempotency_key_required" }, 400);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  const reason = typeof body.reason === "string" ? body.reason : "";
  const lines = Array.isArray(body.lines)
    ? body.lines.filter(isRefundLine)
    : [];

  if (!orderId) return jsonResponse({ error: "order_id_required" }, 400);
  if (lines.length === 0) {
    return jsonResponse({ error: "refund_lines_required" }, 400);
  }
  if (reason.trim().length < 10 || reason.trim().length > 200) {
    return jsonResponse({ error: "reason_invalid_length" }, 400);
  }

  const userId = await userIdFromAuthHeader(req);
  if (!userId) return jsonResponse({ error: "unauthenticated" }, 401);

  // Auth-context RPCs (biz_refund_order, biz_refund_order_commit) read auth.uid()
  // to gate by brand role + stamp initiated_by. They MUST be called via a
  // JWT-bearing client so PostgREST surfaces the caller's sub claim inside
  // the SECURITY DEFINER body. Service-role is retained for non-auth-context
  // ops (orders lookup, notifications, audit, failure-path commit).
  const supabase = serviceClient();
  const supabaseAsUser = userClient(req);

  // Step 1: validate + insert pending refund row.
  const { data: pendingResult, error: pendingError } = await supabaseAsUser.rpc(
    "biz_refund_order",
    {
      p_order_id: orderId,
      p_lines: lines,
      p_reason: reason,
      p_idempotency_key: idempotencyKey,
    },
  );

  if (pendingError || !pendingResult) {
    const mapped = mapRpcErrorToHttp(pendingError?.message ?? "rpc_failed");
    console.error("[refund-order] biz_refund_order failed", mapped);
    return jsonResponse(
      { error: mapped.code, detail: mapped.detail },
      mapped.status,
    );
  }

  const pending = pendingResult as Record<string, unknown>;
  const refundId = String(pending.refund_id ?? "");
  const amountCents = Number(pending.amount_cents ?? 0);
  const currency = String(pending.currency ?? "GBP");
  const paymentIntentId = typeof pending.stripe_payment_intent_id === "string"
    ? pending.stripe_payment_intent_id
    : null;
  const applicationFeeAmountCents = Number(
    pending.application_fee_amount_cents ?? 0,
  );
  const isIdempotentReplay = pending.idempotent_replay === true;

  if (isIdempotentReplay) {
    // The pending row already existed; do not call Stripe again. Just look up the current
    // committed state if any and return it.
    const { data: existing } = await supabase
      .from("refunds")
      .select(
        "id, status, stripe_refund_id, application_fee_refunded_cents, processed_at",
      )
      .eq("id", refundId)
      .maybeSingle();
    if (existing?.status === "succeeded") {
      return jsonResponse({
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
    // If pending or failed: fall through to retry the Stripe call.
  }

  if (!paymentIntentId) {
    return jsonResponse(
      {
        error: "missing_payment_intent",
        detail: "order has no stripe_payment_intent_id; cannot refund",
      },
      422,
    );
  }

  // ORCH-0843 — Look up the connected account id for this order's brand.
  // Chain: orders.event_id → events.brand_id → brands.stripe_connect_id
  // (the denormalised cache mirrored by the stripe_connect_accounts ->
  // brands sync trigger per migration 20260508000000). Service-role client
  // bypasses RLS for this read.
  // Backward compat note: historical orders created under the destination-
  // charge era (pre-ORCH-0843) have PI ids that live on the PLATFORM
  // account, not on the connected account. Calling refunds.create on those
  // with stripeAccount: <connected> would fail with a Stripe 404. SPEC
  // §3.2.3 accepts this as deliberate one-way cutover: at flip time 0 real
  // charges existed; any destination-charge order in flight at deploy is
  // test data only. Stripe's error surfaces through the existing catch
  // block below → 502 with detail; acceptable degrade.
  const { data: brandRow, error: brandErr } = await supabase
    .from("orders")
    .select("event_id, events(brand_id, brands(stripe_connect_id))")
    .eq("id", orderId)
    .maybeSingle();
  if (brandErr || !brandRow) {
    console.error("[refund-order] connected-account lookup failed", brandErr);
    return jsonResponse(
      {
        error: "missing_connected_account",
        detail: "could not resolve brand for this order",
      },
      422,
    );
  }
  // Supabase JS infers the joined shape as either an object (single-row
  // nested) or an array, depending on FK cardinality. Both `events` and
  // `brands` are single-row joins here; defensively normalise both shapes.
  type JoinedBrand = { stripe_connect_id?: string | null };
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
  if (!connectedAccountId) {
    console.error("[refund-order] brand has no stripe_connect_id", { orderId });
    return jsonResponse(
      {
        error: "missing_connected_account",
        detail:
          "brand has no Stripe connected account; cannot refund (ORCH-0843 direct-charge)",
      },
      422,
    );
  }

  // Step 2: call Stripe Refunds API against the connected account
  // (direct-charge refund per ORCH-0843).
  let stripeRefund: StripeRefundResult;
  try {
    const stripe = stripeTicketRefund();
    // @ts-ignore — Stripe SDK namespace is runtime-provided in Deno.
    const created = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: amountCents,
        reason: "requested_by_customer",
        // ORCH-0843 — reverse_transfer removed; it was destination-charge
        // syntax (instructed Stripe to claw the routed amount back from the
        // connected account). Under direct charges the funds already sit on
        // the connected account, so the refund debits the connected balance
        // directly. refund_application_fee:true still tells Stripe to also
        // refund the platform's application_fee_amount cut (Mingla's 1.5%)
        // when there was one.
        refund_application_fee: applicationFeeAmountCents > 0,
        metadata: {
          mingla_refund_id: refundId,
          mingla_order_id: orderId,
          mingla_idempotency_key: idempotencyKey,
        },
      },
      {
        idempotencyKey: `ticket_refund:${refundId}`,
        // ORCH-0843 — direct-charge refund: Stripe-Account header routes the
        // refund against the connected account that owns the PI.
        stripeAccount: connectedAccountId,
      },
    );
    stripeRefund = {
      id: String(created.id),
      status: created.status ?? null,
      amount: Number(created.amount ?? amountCents),
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[refund-order] stripe.refunds.create failed", detail);
    // Mark the pending refund as failed so the row reflects reality.
    await supabaseAsUser.rpc("biz_refund_order_commit", {
      p_refund_id: refundId,
      p_stripe_refund_id: null,
      p_application_fee_refunded_cents: 0,
      p_status: "failed",
    });
    return jsonResponse({ error: "stripe_declined", detail }, 502);
  }

  if (stripeRefund.status === "failed" || stripeRefund.status === "canceled") {
    await supabaseAsUser.rpc("biz_refund_order_commit", {
      p_refund_id: refundId,
      p_stripe_refund_id: stripeRefund.id,
      p_application_fee_refunded_cents: 0,
      p_status: "failed",
    });
    return jsonResponse(
      {
        error: "stripe_declined",
        detail: `stripe refund status=${stripeRefund.status}`,
      },
      502,
    );
  }

  const { data: orderTaxRow, error: orderTaxError } = await supabase
    .from("orders")
    .select("stripe_tax_transaction_id")
    .eq("id", orderId)
    .maybeSingle();
  if (orderTaxError) {
    console.error(
      "[refund-order] tax transaction lookup failed",
      orderTaxError.message,
    );
    return jsonResponse(
      {
        error: "stripe_tax_transaction_lookup_failed",
        detail: orderTaxError.message,
      },
      500,
    );
  }

  const originalTaxTransactionId =
    typeof orderTaxRow?.stripe_tax_transaction_id === "string" &&
      orderTaxRow.stripe_tax_transaction_id.length > 0
      ? orderTaxRow.stripe_tax_transaction_id
      : null;
  let reversalTaxTransactionId: string | null = null;
  if (originalTaxTransactionId !== null) {
    try {
      const stripeForTax = stripeTicketRefund();
      const isFullRefund = pending.is_full_refund === true;
      // @ts-ignore — Stripe SDK Tax namespace is runtime-provided in Deno.
      const reversal = await stripeForTax.tax.transactions.createReversal(
        {
          mode: isFullRefund ? "full" : "partial",
          original_transaction: originalTaxTransactionId,
          reference: `mingla_refund:${refundId}`,
          expand: ["line_items"],
          ...(isFullRefund ? {} : {
            line_items: lines.map((line) => ({
              amount: -line.amount_cents,
              reference: `line:${line.order_line_item_id}`,
            })),
          }),
        },
        {
          stripeAccount: connectedAccountId,
          idempotencyKey: `tax_reversal:${refundId}`,
        },
      );
      reversalTaxTransactionId = String(reversal.id);
    } catch (taxReversalErr) {
      const detail = taxReversalErr instanceof Error
        ? taxReversalErr.message
        : String(taxReversalErr);
      console.error(
        "[refund-order] tax.transactions.createReversal failed",
        detail,
      );
      await supabaseAsUser.rpc("biz_refund_order_commit", {
        p_refund_id: refundId,
        p_stripe_refund_id: stripeRefund.id,
        p_application_fee_refunded_cents: 0,
        p_status: "failed",
      });
      return jsonResponse(
        {
          error: "stripe_tax_reversal_failed",
          detail,
          refund_id: refundId,
          stripe_refund_id: stripeRefund.id,
        },
        502,
      );
    }
  }

  // Step 3: commit the refund — advance orders.payment_status, void tickets, update cache.
  // Application fee refunded amount: Stripe returns this on the Refund object via
  // `refund_application_fee: true`. For Mingla today app_fee=0 so this is always 0.
  const applicationFeeRefundedCents = 0; // ORCH-0787 carry-forward when app_fee>0 era starts.

  const { data: commitResult, error: commitError } = await supabaseAsUser.rpc(
    "biz_refund_order_commit",
    {
      p_refund_id: refundId,
      p_stripe_refund_id: stripeRefund.id,
      p_application_fee_refunded_cents: applicationFeeRefundedCents,
      p_status: "succeeded",
      p_stripe_tax_transaction_id: reversalTaxTransactionId,
    },
  );

  if (commitError || !commitResult) {
    // Critical: Stripe succeeded but our commit failed. Webhook reconciliation will catch this.
    // We surface the error but the refund IS recorded with stripe_refund_id pending.
    console.error(
      "[refund-order] commit RPC failed after Stripe success",
      commitError,
    );
    return jsonResponse(
      {
        error: "commit_failed_after_stripe_success",
        detail:
          "Stripe refund succeeded but local commit failed. Webhook reconciliation will finalise the state.",
        stripe_refund_id: stripeRefund.id,
        refund_id: refundId,
      },
      500,
    );
  }

  const commit = commitResult as Record<string, unknown>;

  // Step 4: enqueue buyer notification (ORCH-0788 dispatcher routes by template_key).
  // Look up event_id + buyer email for the notification recipient.
  const { data: orderDetail } = await supabase
    .from("orders")
    .select("event_id, buyer_email, currency")
    .eq("id", orderId)
    .maybeSingle();

  if (orderDetail?.buyer_email && orderDetail.buyer_email.length > 0) {
    const { error: notifError } = await supabase.from(
      "ticket_order_notifications",
    ).insert({
      order_id: orderId,
      event_id: orderDetail.event_id,
      channel: "email",
      recipient: orderDetail.buyer_email,
      status: "pending",
      idempotency_key: `refund:${orderId}:${stripeRefund.id}`,
      attempt_count: 0,
      payload: {
        template_key: "buyer_refund_issued",
        amount_cents: amountCents,
        currency: String(orderDetail.currency ?? currency),
        refund_lines: lines,
        reason: reason.trim(),
        is_full_refund: pending.is_full_refund === true,
        stripe_refund_id: stripeRefund.id,
      },
    });
    if (notifError) {
      console.error(
        "[refund-order] notification enqueue failed (non-fatal)",
        notifError.message,
      );
    }
    // ORCH-0788: inline-dispatch so the buyer email goes out immediately
    // after the refund commits. Failure is NON-FATAL — the
    // notification-retry-sweeper picks up failed_retryable rows on cron.
    // Mirrors the working stripeWebhookRouter checkout-finalize pattern.
    await dispatchTicketConfirmation(orderId);
  } else {
    console.warn(
      "[refund-order] no buyer_email; skipping notification enqueue",
      { orderId },
    );
  }
  // META-ORCH-1161 §7.x note: the NET-NEW buyer PUSH+in-app(+SMS) for a refund is
  // added in the SINGLE allowlisted chokepoint — the stripeWebhookRouter refund
  // path (handleRefundEvent) — which reconciles EVERY refund (in-app + dashboard)
  // exactly once, idempotent on refundId. We do NOT also dispatch here to avoid a
  // double push for the in-app refund path (which also produces a Stripe refund
  // event → the webhook).

  // Step 5: audit row.
  try {
    await writeAudit(supabase, {
      user_id: userId,
      brand_id: null,
      event_id: orderDetail?.event_id ?? null,
      action: "order_refund_issued",
      target_type: "refund",
      target_id: refundId,
      after: {
        order_id: orderId,
        amount_cents: amountCents,
        currency,
        stripe_refund_id: stripeRefund.id,
        new_payment_status: commit.new_payment_status,
      },
    });
  } catch (auditError) {
    console.error("[refund-order] audit write failed (non-fatal)", auditError);
  }

  return jsonResponse({
    refund_id: refundId,
    order_id: orderId,
    amount_cents: amountCents,
    currency,
    status: "succeeded",
    stripe_refund_id: stripeRefund.id,
    application_fee_refunded_cents: applicationFeeRefundedCents,
    new_payment_status: commit.new_payment_status,
    processed_at: new Date().toISOString(),
    idempotent_replay: false,
  });
});
