// @ts-ignore Deno runtime import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

async function settle(
  url: string,
  serviceKey: string,
  contractId: string,
  outcome: string,
  refundBps?: number,
) {
  const target = outcome === "release" ? "gig-release" : "gig-refund";
  const body = outcome === "release" ? { contract_id: contractId } : {
    contract_id: contractId,
    branch: outcome === "full_refund" ? "resolved_refund" : "resolved_partial",
    refund_bps: refundBps,
  };
  const response = await fetch(`${url}/functions/v1/${target}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${target}:${result?.error ?? response.status}`);
  }
  return result;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }
  const body = await req.json().catch(() => null) as {
    dispute_id?: string;
    outcome?: "release" | "partial_refund" | "full_refund";
    refund_bps?: number | null;
    note?: string | null;
    offer_id?: string;
    accept?: boolean;
  } | null;
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const userDb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  let decision: Record<string, unknown> | null = null;
  if (body?.offer_id && typeof body.accept === "boolean") {
    const { data, error } = await userDb.rpc("gig_dispute_offer_respond", {
      p_offer_id: body.offer_id,
      p_accept: body.accept,
    });
    if (error) {
      return json(
        { error: "offer_response_failed", detail: error.message },
        403,
      );
    }
    decision = data;
    if (!body.accept) return json({ ok: true, decision });
  } else if (body?.dispute_id && body.outcome) {
    const { data, error } = await userDb.rpc("gig_dispute_admin_decide", {
      p_dispute_id: body.dispute_id,
      p_outcome: body.outcome,
      p_refund_bps: body.outcome === "partial_refund" ? body.refund_bps : null,
      p_note: body.note ?? null,
    });
    if (error) {
      return json({ error: "decision_failed", detail: error.message }, 403);
    }
    decision = data;
  } else {
    return json({ error: "validation_error" }, 400);
  }
  const contractId = String(decision?.contract_id ?? "");
  const outcome = String(decision?.outcome ?? "");
  const refundBps = Number(decision?.refund_bps ?? 0);
  if (
    !/^[0-9a-f-]{36}$/i.test(contractId) ||
    !["release", "partial_refund", "full_refund"].includes(outcome)
  ) {
    return json({ error: "decision_invalid" }, 500);
  }
  try {
    const settlement = await settle(
      url,
      serviceKey,
      contractId,
      outcome,
      refundBps,
    );
    return json({ ok: true, decision, settlement });
  } catch (error) {
    return json({ error: "settlement_failed", detail: String(error) }, 502);
  }
});
