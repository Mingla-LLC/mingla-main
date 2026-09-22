import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  jsonResponse,
  ticketCorsHeaders,
  userClient,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ISSUE-3510 — exported so a test can drive the REAL handler. A test that mocks
// `supabase.functions.invoke` structurally cannot see a method check, which is
// how the identical defect in the admin pair reached production (#3504).
export function createSourceRefundActionHandler(): (
  req: Request,
) => Promise<Response> {
  return async (req) => {
    // ISSUE-3510 — the browser sends a CORS preflight before the real POST,
    // because `supabase.functions.invoke` sets authorization, apikey,
    // x-client-info and content-type. The preflight is an OPTIONS, so it MUST
    // be answered BEFORE the method check: answering 405 means the browser
    // never sends the POST at all, and the page fails with a blank error that
    // reads like a permissions problem. This is what took the Admin Refund
    // operations page offline in production (#3504, PR #3506); here it was
    // still latent because no built surface calls this function yet.
    //
    // `ticketCorsHeaders` and not `_shared/cors.ts`: `jsonResponse` already
    // spreads ticketCorsHeaders on every response in this family, and a
    // preflight that advertises a different header set from the one the real
    // response carries is its own bug.
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
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
  };
}

if (import.meta.main) {
  serve(createSourceRefundActionHandler());
}
