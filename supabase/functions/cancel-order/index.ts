/**
 * cancel-order — ORCH-0787 organiser-initiated cancellation for FREE online orders.
 *
 * Q-1 (operator-locked): paid orders cannot be cancelled — they must be refunded.
 *   The biz_cancel_order RPC enforces this with the paid_orders_must_be_refunded_not_cancelled
 *   error. Q-9 (operator-locked): free and paid share the same edge function shape, but the
 *   free path never calls Stripe (zero charge, nothing to reverse).
 *
 * Flow:
 *   1. Validate request shape + JWT.
 *   2. Call biz_cancel_order RPC (sets payment_status='cancelled', voids tickets, writes
 *      cancellation_reason).
 *   3. Enqueue ticket_order_notifications row with template_key='buyer_order_cancelled'.
 *   4. Write audit row + return success.
 */

// @ts-ignore — Deno ESM import.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { writeAudit } from "../_shared/audit.ts";
import {
  dispatchTicketConfirmation,
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
  userClient,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
// META-ORCH-1161 §7.x — buyer order-cancelled PUSH+in-app(+SMS) via notify-dispatch
// v2. Email stays owned by dispatchTicketConfirmation (no double-email). cancel-order
// is the SOLE chokepoint for free-order cancellation (no Stripe webhook path).
import { fireBuyerOrderNotify } from "../_shared/businessNotifyTriggers.ts";

function mapRpcErrorToHttp(errorMessage: string): {
  code: string;
  status: number;
  detail: string;
} {
  const msg = errorMessage.toLowerCase();
  if (msg.includes("permission_denied")) {
    return { code: "permission_denied", status: 403, detail: errorMessage };
  }
  if (msg.includes("order_not_found")) {
    return { code: "order_not_found", status: 404, detail: errorMessage };
  }
  if (msg.includes("paid_orders_must_be_refunded_not_cancelled")) {
    return {
      code: "paid_orders_must_be_refunded_not_cancelled",
      status: 422,
      detail: errorMessage,
    };
  }
  if (msg.includes("order_not_cancellable")) {
    return { code: "order_not_cancellable", status: 422, detail: errorMessage };
  }
  if (msg.includes("reason_invalid_length")) {
    return { code: "reason_invalid_length", status: 422, detail: errorMessage };
  }
  return { code: "internal_error", status: 500, detail: errorMessage };
}

serve(async (req: Request): Promise<Response> => {
  // @ts-ignore — ticketCorsHeaders typed as readonly record at runtime.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const idempotencyKey = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key");
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
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

  if (!orderId) return jsonResponse({ error: "order_id_required" }, 400);
  if (reason.trim().length < 10 || reason.trim().length > 200) {
    return jsonResponse({ error: "reason_invalid_length" }, 400);
  }

  const userId = await userIdFromAuthHeader(req);
  if (!userId) return jsonResponse({ error: "unauthenticated" }, 401);

  // Auth-context RPC: biz_cancel_order reads auth.uid() to gate by brand role.
  // MUST use a JWT-bearing client (not service-role) so PostgREST surfaces the
  // caller's sub claim and the SECURITY DEFINER permission check resolves.
  const supabase = serviceClient();
  const supabaseAsUser = userClient(req);

  const { data: result, error: rpcError } = await supabaseAsUser.rpc("biz_cancel_order", {
    p_order_id: orderId,
    p_reason: reason,
  });

  if (rpcError || !result) {
    const mapped = mapRpcErrorToHttp(rpcError?.message ?? "rpc_failed");
    console.error("[cancel-order] biz_cancel_order failed", mapped);
    return jsonResponse({ error: mapped.code, detail: mapped.detail }, mapped.status);
  }

  const cancelResult = result as Record<string, unknown>;

  // Enqueue buyer notification (ORCH-0788 dispatcher routes by template_key).
  const { data: orderDetail } = await supabase
    .from("orders")
    .select("event_id, buyer_email")
    .eq("id", orderId)
    .maybeSingle();

  if (orderDetail?.buyer_email && orderDetail.buyer_email.length > 0) {
    const { error: notifError } = await supabase.from("ticket_order_notifications").insert({
      order_id: orderId,
      event_id: orderDetail.event_id,
      channel: "email",
      recipient: orderDetail.buyer_email,
      status: "pending",
      idempotency_key: `cancel:${orderId}:${idempotencyKey}`,
      attempt_count: 0,
      payload: {
        template_key: "buyer_order_cancelled",
        reason: reason.trim(),
      },
    });
    if (notifError) {
      console.error("[cancel-order] notification enqueue failed (non-fatal)", notifError.message);
    }
    // ORCH-0788: inline-dispatch so the buyer cancel email goes out
    // immediately. Failure is NON-FATAL — sweeper picks up retryable rows.
    await dispatchTicketConfirmation(orderId);
  } else {
    console.warn("[cancel-order] no buyer_email; skipping notification enqueue", { orderId });
  }

  // META-ORCH-1161 §7.x — NET-NEW buyer order-cancelled PUSH + in-app (+ SMS per
  // the buyer_order_cancelled seed). Idempotent per (order, idempotencyKey). Email
  // stays owned by dispatchTicketConfirmation above (helper passes contact=phone →
  // v2 email channel skips, no double-email). Best-effort; never blocks the response.
  await fireBuyerOrderNotify(supabase as never, {
    categoryKey: "buyer_order_cancelled",
    orderId,
    idempotencyKey: `buyer_order_cancelled:${orderId}:${idempotencyKey}`,
  });

  try {
    await writeAudit(supabase, {
      user_id: userId,
      brand_id: null,
      event_id: orderDetail?.event_id ?? null,
      action: "order_cancelled",
      target_type: "order",
      target_id: orderId,
      after: {
        cancelled_at: cancelResult.cancelled_at,
        reason: reason.trim(),
      },
    });
  } catch (auditError) {
    console.error("[cancel-order] audit write failed (non-fatal)", auditError);
  }

  return jsonResponse({
    order_id: orderId,
    status: "cancelled",
    cancelled_at: cancelResult.cancelled_at,
    idempotent_replay: cancelResult.idempotent_replay === true,
  });
});
