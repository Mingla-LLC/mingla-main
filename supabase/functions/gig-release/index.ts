// @ts-ignore Deno runtime import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAuthorizedCronCaller } from "../_shared/cronCallerAuth.ts";
import {
  allocateAcrossSources,
  gigStripeRelease,
} from "../_shared/gigMoney.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!(await isAuthorizedCronCaller(req.headers.get("authorization")))) {
    return json({ error: "unauthorized" }, 401);
  }
  const body = await req.json().catch(() => null) as
    | { contract_id?: string }
    | null;
  const contractId = String(body?.contract_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(contractId)) {
    return json({ error: "invalid_contract" }, 400);
  }
  const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const { data: contract, error: contractError } = await db.from(
    "gig_contracts",
  )
    .select("id,state,current_terms_version,creator_account_id").eq(
      "id",
      contractId,
    ).single();
  if (contractError || !contract) {
    return json({ error: "release_not_ready" }, 409);
  }
  const { data: releaseDecision } = contract.state === "disputed"
    ? await db.from("gig_disputes").select("id").eq("contract_id", contractId)
      .eq("status", "decided").eq("decided_outcome", "release").maybeSingle()
    : { data: null };
  if (contract.state !== "posts_verified" && !releaseDecision) {
    return json({ error: "release_not_ready" }, 409);
  }
  const [{ data: hold }, { data: terms }, { data: payee }] = await Promise.all([
    db.from("gig_holds").select(
      "id,rail,status,provider_ref,amount_minor,refunded_minor",
    ).eq(
      "contract_id",
      contractId,
    ).eq("terms_version", contract.current_terms_version).single(),
    db.from("gig_terms_versions").select("fee_minor,currency").eq(
      "contract_id",
      contractId,
    ).eq("version", contract.current_terms_version).single(),
    db.from("payee_accounts").select(
      "stripe_account_id,stripe_status,paystack_recipient_code,paystack_status",
    ).eq("user_id", contract.creator_account_id).single(),
  ]);
  if (!hold || !terms || hold.status !== "captured") {
    return json({ error: "captured_hold_required" }, 409);
  }
  let releaseRef = `ledger:${contractId}`;
  if (hold.rail === "stripe") {
    if (
      !payee?.stripe_account_id || payee.stripe_status !== "active" ||
      !hold.provider_ref
    ) return json({ error: "stripe_payee_not_ready" }, 409);
    // A higher accepted counter-offer was paid as a separate top-up charge;
    // a transfer cannot exceed its source charge, so the fee is split.
    const { data: adjustments } = await db.from("gig_hold_adjustments")
      .select("id,kind,status,provider_ref,amount_minor,refunded_minor")
      .eq("contract_id", contractId)
      .in("status", ["captured", "refunded"]);
    const counterRefunded = (adjustments ?? [])
      .filter((a) => a.kind === "refund" && a.status === "refunded")
      .reduce((sum, a) => sum + Number(a.amount_minor), 0);
    const sources = [
      {
        id: "base",
        providerRef: String(hold.provider_ref),
        availableMinor: Number(hold.amount_minor) -
          Number(hold.refunded_minor ?? 0) - counterRefunded,
      },
      ...(adjustments ?? [])
        .filter((a) => a.kind === "topup" && a.status === "captured")
        .map((a) => ({
          id: String(a.id),
          providerRef: String(a.provider_ref),
          availableMinor: Number(a.amount_minor) - Number(a.refunded_minor),
        })),
    ];
    let parts;
    try {
      parts = allocateAcrossSources(Number(terms.fee_minor), sources);
    } catch {
      return json({ error: "captured_funds_insufficient" }, 409);
    }
    const stripe = stripeTicketCheckout();
    const transferIds: string[] = [];
    for (const part of parts) {
      const intent = await stripe.paymentIntents.retrieve(
        part.source.providerRef,
        { expand: ["latest_charge"] },
      );
      const latest = intent.latest_charge;
      const chargeId = typeof latest === "string" ? latest : latest?.id;
      if (!chargeId) return json({ error: "captured_charge_missing" }, 409);
      const transfer = await stripe.transfers.create(
        gigStripeRelease({
          contractId,
          feeMinor: part.amountMinor,
          destination: payee.stripe_account_id,
          sourceTransaction: chargeId,
        }),
        {
          idempotencyKey: part.source.id === "base"
            ? `gig_release:${contractId}`
            : `gig_release:${contractId}:${part.source.id}`,
        },
      );
      transferIds.push(transfer.id);
    }
    releaseRef = transferIds.join(",");
  } else if (
    !payee?.paystack_recipient_code || payee.paystack_status !== "verified"
  ) {
    return json({ error: "paystack_payee_not_ready" }, 409);
  }
  const { data, error } = await db.rpc("gig_release_record", {
    p_contract_id: contractId,
    p_provider_ref: releaseRef,
  });
  if (error) {
    return json({ error: "release_record_failed", detail: error.message }, 500);
  }
  return json({ ok: true, release_ref: releaseRef, ledger: data });
});
