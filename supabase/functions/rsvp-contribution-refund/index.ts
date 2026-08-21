/**
 * rsvp-contribution-refund — ORCH-1291 [rsvp-chip-in].
 *
 * Organiser/admin refund of a paid voluntary RSVP contribution, on both rails.
 * A contribution has NO order → refund-order cannot handle it (investigation
 * F-7); this is the sibling refund path (refund-order stays byte-unchanged).
 *
 * Amended §4.4 policy (Seth-locked Q-C):
 *   • DISCRETIONARY (guest changed their mind / organiser goodwill) — Mingla
 *     KEEPS its cut: Stripe refund_application_fee=FALSE, refund amount =
 *     amount_cents − application_fee_amount_cents; Paystack refund amount =
 *     buyer_total − application_fee (the transaction_charge already routed to
 *     Mingla's main account is retained). The guest is NOT made whole.
 *   • EVENT-CANCELLATION (batch, cancelAll) — make the guest WHOLE: Stripe
 *     refund_application_fee=TRUE, refund the FULL buyer_total; Paystack refund
 *     the full buyer_total. Chargeback/goodwill protection since a cancelled
 *     event returns nothing to the guest.
 *   The guest's FREE RSVP is untouched either way (only the gift is returned).
 *
 * Permission: verify_jwt=true (a valid organiser JWT is required by the gateway).
 * The row is fetched with the JWT-BOUND client so the event_rsvp_contributions
 * host-read RLS policy (event_manager rank) is the permission gate — a non-owner
 * simply gets zero rows and can refund nothing (no leak).
 *
 * External-API docs (COMMS-0003):
 *   • Stripe refunds + refund_application_fee: https://docs.stripe.com/connect/direct-charges#issue-refunds
 *   • Paystack refund: https://paystack.com/docs/api/refund/#create
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  serviceClient,
  userClient,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
import {
  runSourceRefundOperation,
  type SourceRefundOperation,
} from "../_shared/sourceRefundControlPlane.ts";

type RefundMode = "discretionary" | "cancellation";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const userId = await userIdFromAuthHeader(req);
  if (!userId) return jsonResponse({ error: "unauthenticated" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const cancelAll = body.cancelAll === true;
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const contributionId = typeof body.contributionId === "string"
    ? body.contributionId
    : "";
  const operationId = typeof body.operationId === "string"
    ? body.operationId
    : null;
  const operationArgs = body.operationArgs !== null &&
      typeof body.operationArgs === "object" &&
      !Array.isArray(body.operationArgs)
    ? body.operationArgs as Record<string, unknown>
    : null;

  const supabase = serviceClient();
  const asUser = userClient(req); // JWT-bound → host-read RLS is the permission gate.

  // #1221 typed path. Preparation owns the exact cents and authorization; the
  // provider runner is best-effort and the durable nonterminal state is returned.
  const prepareOne = async (
    boundEventId: string,
    id: string,
    mode: RefundMode,
  ) => {
    const idempotency = req.headers.get("idempotency-key") ??
      `${id}:${mode}`;
    const prepared = operationId && operationArgs
      ? await asUser.rpc("ari_execute_rsvp_operation", {
        p_operation_id: operationId,
        p_tool_name: "refund_rsvp_contribution",
        p_args: operationArgs,
      })
      : await asUser.rpc("biz_prepare_rsvp_contribution_refund", {
        p_event_id: boundEventId,
        p_contribution_id: id,
        p_mode: mode,
        p_reason: reason,
        p_client_idempotency_key: idempotency,
      });
    if (prepared.error) throw new Error(prepared.error.message);
    const refundId = prepared.data?.refund_id;
    if (typeof refundId === "string") {
      const { data: operation } = await supabase.from("source_refunds")
        .select("*").eq("id", refundId).maybeSingle();
      if (operation) {
        try {
          await runSourceRefundOperation(
            supabase,
            operation as SourceRefundOperation,
          );
        } catch (caught) {
          console.warn("rsvp_refund_runner_deferred", {
            refund_id: refundId,
            error_code: caught instanceof Error
              ? caught.message.split(":")[0]
              : "runner_failed",
          });
        }
      }
    }
    return prepared.data;
  };
  if (!eventId) return jsonResponse({ error: "event_id_required" }, 400);
  if ((operationId === null) !== (operationArgs === null)) {
    return jsonResponse({ error: "operation_binding_invalid" }, 400);
  }
  if (reason.length < 3 || reason.length > 500) {
    return jsonResponse({ error: "refund_reason_invalid" }, 400);
  }
  if (cancelAll) {
    const { data: contributions, error } = await asUser
      .from("event_rsvp_contributions").select("id")
      .eq("event_id", eventId).in("status", ["paid", "partially_refunded"]);
    if (error) return jsonResponse({ error: "not_found_or_forbidden" }, 404);
    const operations = [];
    for (const contribution of contributions ?? []) {
      operations.push(
        await prepareOne(eventId, String(contribution.id), "cancellation"),
      );
    }
    return jsonResponse({ operations }, 202);
  }
  if (!contributionId) {
    return jsonResponse({ error: "contribution_id_required" }, 400);
  }
  if (body.mode !== "cancellation" && body.mode !== "discretionary") {
    return jsonResponse({ error: "refund_mode_invalid" }, 400);
  }
  const typedMode: RefundMode = body.mode;
  try {
    return jsonResponse({
      refund: await prepareOne(eventId, contributionId, typedMode),
    }, 202);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    return jsonResponse({
      error: message.includes("not_authorized")
        ? "not_found_or_forbidden"
        : "refund_prepare_failed",
    }, message.includes("not_authorized") ? 404 : 422);
  }
});
