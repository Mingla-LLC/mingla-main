// @ts-ignore Deno runtime import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createPaystackRefund } from "../_shared/paystackRefunds.ts";
import { isAuthorizedCronCaller } from "../_shared/cronCallerAuth.ts";
import { gigRefund, type RefundBranch } from "../_shared/gigMoney.ts";
import { stripeTicketRefund } from "../_shared/stripe.ts";

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
const userBranches = new Set<RefundBranch>([
  "host_before_accept",
  "host_after_accept_before_lock",
  "creator_after_accept",
  "creator_decline",
  "declined_or_expired",
  "resolved_partial",
  "resolved_refund",
]);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }
  const body = await req.json().catch(() => null) as {
    contract_id?: string;
    branch?: RefundBranch;
    refund_bps?: number;
  } | null;
  const contractId = String(body?.contract_id ?? "");
  const branch = String(body?.branch ?? "") as RefundBranch;
  if (
    !/^[0-9a-f-]{36}$/i.test(contractId) ||
    ![...userBranches, "declined_or_expired"].includes(branch)
  ) return json({ error: "validation_error" }, 400);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceDb = createClient(
    url,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const isMachine = await isAuthorizedCronCaller(authorization);
  if (!isMachine) {
    if (!userBranches.has(branch)) {
      return json({ error: "branch_requires_service" }, 403);
    }
    const userDb = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { error } = await userDb.rpc("gig_refund_authorize", {
      p_contract_id: contractId,
      p_branch: branch,
    });
    if (error) {
      return json({ error: "refund_not_allowed", detail: error.message }, 403);
    }
  }
  const { data: contract } = await serviceDb.from("gig_contracts").select(
    "current_terms_version",
  ).eq("id", contractId).single();
  if (!contract) return json({ error: "contract_not_found" }, 404);
  const [{ data: hold }, { data: terms }, { data: dispute }] = await Promise
    .all([
      serviceDb.from("gig_holds").select(
        "rail,status,provider_ref,amount_minor,currency,refunded_minor",
      ).eq("contract_id", contractId).eq(
        "terms_version",
        contract.current_terms_version,
      ).single(),
      serviceDb.from("gig_terms_versions").select(
        "fee_minor,booking_fee_minor,currency",
      ).eq("contract_id", contractId).eq(
        "version",
        contract.current_terms_version,
      ).single(),
      serviceDb.from("gig_disputes").select("decided_refund_bps").eq(
        "contract_id",
        contractId,
      ).eq("status", "decided").maybeSingle(),
    ]);
  if (!hold || !terms || hold.status !== "captured" || !hold.provider_ref) {
    return json({ error: "captured_hold_required" }, 409);
  }
  const amounts = gigRefund({
    branch,
    feeMinor: Number(terms.fee_minor),
    bookingFeeMinor: Number(terms.booking_fee_minor),
    refundBps: body?.refund_bps ?? dispute?.decided_refund_bps ?? undefined,
  });
  let providerRef = "none";
  if (amounts.hostRefundMinor > 0 && hold.rail === "stripe") {
    const refund = await stripeTicketRefund().refunds.create({
      payment_intent: hold.provider_ref,
      amount: amounts.hostRefundMinor,
      metadata: { mingla_kind: "gig_refund", contract_id: contractId, branch },
    }, {
      idempotencyKey:
        `gig_refund:${contractId}:${branch}:${amounts.hostRefundMinor}`,
    });
    providerRef = refund.id;
  } else if (amounts.hostRefundMinor > 0) {
    const refund = await createPaystackRefund({
      transaction: hold.provider_ref,
      merchantNote:
        `gig_refund:${contractId}:${branch}:${amounts.hostRefundMinor}`,
      amountSubunits: amounts.hostRefundMinor,
      currency: String(terms.currency),
    });
    providerRef = refund.id;
  }
  const { data, error } = await serviceDb.rpc("gig_refund_record", {
    p_contract_id: contractId,
    p_branch: branch,
    p_refund_minor: amounts.hostRefundMinor,
    p_creator_fee_minor: amounts.creatorFeeMinor,
    p_provider_ref: providerRef,
  });
  if (error) {
    return json({ error: "refund_record_failed", detail: error.message }, 500);
  }
  return json({ ok: true, provider_ref: providerRef, amounts, ledger: data });
});
