/**
 * orderRefundService — ORCH-0787 client-side wrapper for the refund-order edge function.
 *
 * Each call:
 *   - Generates a fresh idempotency key per user gesture (NOT per retry).
 *   - Invokes the edge function via supabase.functions.invoke with the Idempotency-Key header.
 *   - Throws a typed error on failure for the React Query mutation to surface.
 *
 * Caller (RefundSheet) keeps the idempotency key stable across retries within the same
 * sheet-open via a useRef; regenerates on each visible flip.
 */

import { supabase } from "./supabase";

export interface RefundOrderInput {
  orderId: string;
  lines: Array<{
    orderLineItemId: string;
    quantity: number;
    amountCents: number;
  }>;
  reason: string;
  idempotencyKey: string;
}

export interface RefundOrderResult {
  refundId: string;
  orderId: string;
  amountCents: number;
  currency: string;
  status: "succeeded";
  stripeRefundId: string;
  applicationFeeRefundedCents: number;
  newPaymentStatus: "partial_refund" | "refunded";
  processedAt: string;
  idempotentReplay: boolean;
}

export interface RefundOrderError extends Error {
  code:
    | "permission_denied"
    | "order_not_found"
    | "order_not_refundable"
    | "line_overrefund"
    | "line_item_not_found"
    | "reason_invalid_length"
    | "refund_amount_zero"
    | "missing_payment_intent"
    | "stripe_declined"
    | "commit_failed_after_stripe_success"
    | "idempotency_key_required"
    | "unauthenticated"
    | "internal_error"
    | "network_error";
  detail?: string;
  httpStatus?: number;
}

const refundOrderError = (
  code: RefundOrderError["code"],
  message: string,
  detail?: string,
  httpStatus?: number,
): RefundOrderError => {
  const err = new Error(message) as RefundOrderError;
  err.code = code;
  if (detail !== undefined) err.detail = detail;
  if (httpStatus !== undefined) err.httpStatus = httpStatus;
  return err;
};

export const issueOrderRefund = async (
  input: RefundOrderInput,
): Promise<RefundOrderResult> => {
  const body = {
    order_id: input.orderId,
    lines: input.lines.map((line) => ({
      order_line_item_id: line.orderLineItemId,
      quantity: line.quantity,
      amount_cents: line.amountCents,
    })),
    reason: input.reason,
  };

  let response: { data: unknown; error: unknown };
  try {
    response = await supabase.functions.invoke("refund-order", {
      body,
      headers: {
        "Idempotency-Key": input.idempotencyKey,
      },
    });
  } catch (err) {
    throw refundOrderError(
      "network_error",
      "Couldn't reach the refund service. Tap to try again.",
      err instanceof Error ? err.message : String(err),
    );
  }

  if (response.error) {
    // supabase-js wraps non-2xx as FunctionsHttpError with the response body accessible
    // via .context. Use duck-typing for RN polyfill safety.
    const ctx = (response.error as { context?: Response }).context;
    let payload: { error?: string; detail?: string } | null = null;
    if (ctx && typeof ctx.text === "function") {
      try {
        const text = await ctx.text();
        payload = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }
    }
    const code = payload?.error ?? "internal_error";
    const detail = payload?.detail ?? (response.error as Error).message ?? "Refund failed";
    throw refundOrderError(code as RefundOrderError["code"], userMessageFor(code), detail);
  }

  const data = response.data as Record<string, unknown>;
  return {
    refundId: String(data.refund_id ?? ""),
    orderId: String(data.order_id ?? input.orderId),
    amountCents: Number(data.amount_cents ?? 0),
    currency: String(data.currency ?? "GBP"),
    status: "succeeded",
    stripeRefundId: String(data.stripe_refund_id ?? ""),
    applicationFeeRefundedCents: Number(data.application_fee_refunded_cents ?? 0),
    newPaymentStatus: data.new_payment_status as RefundOrderResult["newPaymentStatus"],
    processedAt: String(data.processed_at ?? new Date().toISOString()),
    idempotentReplay: data.idempotent_replay === true,
  };
};

const userMessageFor = (code: string): string => {
  switch (code) {
    case "permission_denied":
      return "You don't have permission to refund this order.";
    case "order_not_found":
      return "Order not found.";
    case "order_not_refundable":
      return "This order can't be refunded in its current state.";
    case "line_overrefund":
      return "You can't refund more tickets than were purchased.";
    case "line_item_not_found":
      return "One of the ticket lines is missing. Refresh and try again.";
    case "reason_invalid_length":
      return "Refund reason must be 10–200 characters.";
    case "refund_amount_zero":
      return "Refund amount must be greater than zero.";
    case "missing_payment_intent":
      return "This order has no payment record. It may be a free order.";
    case "stripe_declined":
      return "Stripe declined the refund. Try again in a moment.";
    case "commit_failed_after_stripe_success":
      return "Refund was issued by Stripe but we couldn't update the app. Refresh to confirm.";
    case "unauthenticated":
      return "You're signed out. Please sign in and try again.";
    case "idempotency_key_required":
      return "Couldn't process the refund. Tap to try again.";
    case "network_error":
      return "Couldn't reach the refund service. Check your connection.";
    default:
      return "Couldn't issue the refund. Tap to try again.";
  }
};
