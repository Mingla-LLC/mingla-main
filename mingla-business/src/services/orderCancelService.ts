/**
 * orderCancelService — ORCH-0787 client-side wrapper for the cancel-order edge function.
 *
 * Q-1 (operator-locked): paid orders cannot be cancelled — they must be refunded.
 * This service is for free orders only. Calling it on a paid order returns
 * `paid_orders_must_be_refunded_not_cancelled` from the RPC.
 */

import { supabase } from "./supabase";

export interface CancelOrderInput {
  orderId: string;
  reason: string;
  idempotencyKey: string;
}

export interface CancelOrderResult {
  orderId: string;
  status: "cancelled";
  cancelledAt: string;
  idempotentReplay: boolean;
}

export interface CancelOrderError extends Error {
  code:
    | "permission_denied"
    | "order_not_found"
    | "paid_orders_must_be_refunded_not_cancelled"
    | "order_not_cancellable"
    | "reason_invalid_length"
    | "idempotency_key_required"
    | "unauthenticated"
    | "internal_error"
    | "network_error";
  detail?: string;
  httpStatus?: number;
}

const cancelOrderError = (
  code: CancelOrderError["code"],
  message: string,
  detail?: string,
  httpStatus?: number,
): CancelOrderError => {
  const err = new Error(message) as CancelOrderError;
  err.code = code;
  if (detail !== undefined) err.detail = detail;
  if (httpStatus !== undefined) err.httpStatus = httpStatus;
  return err;
};

const userMessageFor = (code: string): string => {
  switch (code) {
    case "permission_denied":
      return "You don't have permission to cancel this order.";
    case "order_not_found":
      return "Order not found.";
    case "paid_orders_must_be_refunded_not_cancelled":
      return "Paid orders are cancelled by issuing a refund. Use the Refund button instead.";
    case "order_not_cancellable":
      return "This order can't be cancelled in its current state.";
    case "reason_invalid_length":
      return "Cancellation reason must be 10–200 characters.";
    case "unauthenticated":
      return "You're signed out. Please sign in and try again.";
    case "idempotency_key_required":
      return "Couldn't process the cancellation. Tap to try again.";
    case "network_error":
      return "Couldn't reach the cancel service. Check your connection.";
    default:
      return "Couldn't cancel the order. Tap to try again.";
  }
};

export const cancelFreeOrder = async (
  input: CancelOrderInput,
): Promise<CancelOrderResult> => {
  let response: { data: unknown; error: unknown };
  try {
    response = await supabase.functions.invoke("cancel-order", {
      body: {
        order_id: input.orderId,
        reason: input.reason,
      },
      headers: {
        "Idempotency-Key": input.idempotencyKey,
      },
    });
  } catch (err) {
    throw cancelOrderError(
      "network_error",
      "Couldn't reach the cancel service. Check your connection.",
      err instanceof Error ? err.message : String(err),
    );
  }

  if (response.error) {
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
    const detail = payload?.detail ?? (response.error as Error).message ?? "Cancel failed";
    throw cancelOrderError(code as CancelOrderError["code"], userMessageFor(code), detail);
  }

  const data = response.data as Record<string, unknown>;
  return {
    orderId: String(data.order_id ?? input.orderId),
    status: "cancelled",
    cancelledAt: String(data.cancelled_at ?? new Date().toISOString()),
    idempotentReplay: data.idempotent_replay === true,
  };
};
