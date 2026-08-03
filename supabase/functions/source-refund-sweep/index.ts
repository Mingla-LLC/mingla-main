import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { serviceClient } from "../_shared/ticketCheckout.ts";
import {
  runSourceRefundOperation,
  safeSourceRefundSummary,
  type SourceRefundOperation,
  sourceRefundPostsEnabled,
} from "../_shared/sourceRefundControlPlane.ts";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method_not_allowed", { status: 405 });
  }
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!expected || req.headers.get("authorization") !== `Bearer ${expected}`) {
    return Response.json({ error: "not_authorized" }, { status: 401 });
  }
  if (!sourceRefundPostsEnabled()) {
    return Response.json({ disabled: true, claimed: 0, results: [] }, {
      status: 200,
    });
  }
  const client = serviceClient();
  const workerId = `source-refund-sweep:${crypto.randomUUID()}`;
  const { data, error } = await client.rpc("claim_source_refund_operations", {
    p_worker_id: workerId,
    p_limit: 25,
    p_now: new Date().toISOString(),
  });
  if (error) return Response.json({ error: "claim_failed" }, { status: 500 });
  const results = [];
  for (const operation of (data ?? []) as SourceRefundOperation[]) {
    try {
      await runSourceRefundOperation(client, operation);
      results.push({
        ...safeSourceRefundSummary(operation),
        runner: "accepted",
      });
    } catch (caught) {
      const code = caught instanceof Error
        ? caught.message.split(":")[0]
        : "runner_failed";
      console.error("source_refund_runner_failed", {
        refund_id: operation.id,
        source_type: operation.source_type,
        provider: operation.provider,
        buyer_state: operation.buyer_state,
        fee_state: operation.fee_state,
        error_code: code,
      });
      await client.rpc("schedule_source_refund_retry", {
        p_refund_id: operation.id,
        p_safe_reason_code: /^[a-z0-9_]{3,80}$/.test(code)
          ? code
          : "runner_failed",
        p_now: new Date().toISOString(),
      });
      results.push({ refundId: operation.id, runner: "retry_scheduled" });
    }
  }
  return Response.json({ claimed: results.length, results }, { status: 200 });
});
