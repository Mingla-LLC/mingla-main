// Issue #2097 — explicit Admin recovery for a stuck ticket refund.
// Accepts only refundId; every provider identity is loaded from service-owned rows.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { stripeTicketRefund } from "../_shared/stripe.ts";
import { executeTicketRefundWithFeeTruth } from "../_shared/issue2097TicketRefundTruth.ts";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Content-Type": "application/json" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  const auth = req.headers.get("authorization");
  if (!auth) return reply({ error: "unauthorized" }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user } } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
  if (!user) return reply({ error: "unauthorized" }, 401);
  const { data: admin } = await supabase.from("admin_users").select("id").eq("email", user.email).eq("status", "active").maybeSingle();
  if (!admin) return reply({ error: "forbidden" }, 403);
  let body: { refundId?: unknown };
  try { body = await req.json(); } catch { return reply({ error: "invalid_json" }, 400); }
  if (typeof body.refundId !== "string") return reply({ error: "refund_id_required" }, 400);
  const { data: attempts, error } = await supabase.from("ticket_refund_attempts")
    .select("refund_id,order_id,request_fingerprint,connected_account_id,currency,charge_id,payment_intent_id,application_fee_amount_text,requested_refund_amount_text,expected_attempt_count")
    .eq("refund_id", body.refundId).order("created_at", { ascending: true });
  if (error || !attempts?.length) return reply({ error: "attempt_not_found" }, 404);
  try {
    let status = 200;
    const results = [];
    for (const attempt of attempts) {
      const result = await executeTicketRefundWithFeeTruth({
        supabase,
        stripe: stripeTicketRefund(),
        refundId: attempt.refund_id,
        orderId: attempt.order_id,
        paymentIntentId: attempt.payment_intent_id,
        knownChargeId: attempt.charge_id,
        connectedAccountId: attempt.connected_account_id,
        expectedCurrency: attempt.currency,
        expectedApplicationFeeAmount: attempt.application_fee_amount_text,
        requestedRefundAmount: attempt.requested_refund_amount_text,
        requestFingerprint: attempt.request_fingerprint,
        expectedAttemptCount: attempt.expected_attempt_count,
        allowProviderMutation: false,
      });
      status = Math.max(status, result.httpStatus);
      results.push({ attempt_id: result.attemptId, application_fee_refund_status: result.status });
    }
    return reply({ refund_id: body.refundId, attempts: results }, status);
  } catch (cause) {
    console.error("[admin-reconcile-ticket-refund] recovery failed");
    return reply({ error: "reconciliation_failed", detail: cause instanceof Error ? cause.message : "unknown" }, 409);
  }
});
