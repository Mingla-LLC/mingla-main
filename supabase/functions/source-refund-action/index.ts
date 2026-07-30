import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  jsonResponse,
  userClient,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  if (!await userIdFromAuthHeader(req)) {
    return jsonResponse({ error: "not_authenticated" }, 401);
  }
  const body = await req.json().catch(() => ({}));
  const refundId = typeof body.refundId === "string" ? body.refundId : "";
  const action = typeof body.action === "string" ? body.action : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!UUID_RE.test(refundId)) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  if (
    !["retry", "escalate"].includes(action) || reason.length < 3 ||
    reason.length > 500
  ) {
    return jsonResponse({ error: "invalid_action" }, 422);
  }
  const { data, error } = await userClient(req).rpc(
    "biz_request_source_refund_action",
    {
      p_refund_id: refundId,
      p_action: action,
      p_reason: reason,
    },
  );
  if (error) return jsonResponse({ error: "not_authorized" }, 403);
  return jsonResponse({ refund: data }, 202);
});
