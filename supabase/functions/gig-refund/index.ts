// @ts-ignore Deno runtime import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createPaystackRefund } from "../_shared/paystackRefunds.ts";
import { isAuthorizedCronCaller } from "../_shared/cronCallerAuth.ts";
import type { RefundBranch } from "../_shared/gigMoney.ts";
import { stripeTicketRefund } from "../_shared/stripe.ts";
import { notifyGigRefundGaveUp } from "../_shared/gigPaymentCapture.ts";

/** #4402: a refund is retried with backoff this many times, then alerted. */
const GIG_REFUND_MAX_ATTEMPTS = 5;

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
// Branches a contract party may ask for (re-checked by gig_refund_authorize).
const userBranches = new Set<RefundBranch>([
  "host_before_accept",
  "host_after_accept_before_lock",
  "creator_after_accept",
  "creator_decline",
  "resolved_partial",
  "resolved_refund",
]);
// Timer-only branches.
const machineBranches = new Set<RefundBranch>([
  ...userBranches,
  "declined_or_expired",
  "upload_missed",
  "counter_lower",
  // #4402: a payment that landed after its offer was retired as unpaid is
  // refunded in full, by the webhook, gig-hire or reconcile only.
  "payment_late",
]);

type RefundSource = {
  kind: "base" | "topup";
  id: string;
  provider_ref: string;
  amount_minor: number;
};
type RefundQuote = {
  refund_minor: number;
  creator_fee_minor: number;
  currency: string;
  rail: "stripe" | "paystack";
  sources: RefundSource[];
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }
  // Only the contract and branch are read from the client. Amounts (and a
  // partial refund's percentage) always come from the server quote: the
  // previous refund_bps body field let a caller pick their own refund.
  const body = await req.json().catch(() => null) as {
    contract_id?: string;
    branch?: RefundBranch;
  } | null;
  const contractId = String(body?.contract_id ?? "");
  const branch = String(body?.branch ?? "") as RefundBranch;
  if (
    !/^[0-9a-f-]{36}$/i.test(contractId) || !machineBranches.has(branch)
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
      return json({ error: "refund_not_allowed" }, 403);
    }
  }
  const { data: quoteData, error: quoteError } = await serviceDb.rpc(
    "gig_refund_quote",
    { p_contract_id: contractId, p_branch: branch },
  );
  if (quoteError || !quoteData) {
    return json({ error: "refund_not_ready" }, 409);
  }
  const quote = quoteData as RefundQuote;
  // #4402 F3: one refund per hold (or counter difference), claimed in the
  // database BEFORE any provider call, so the webhook, the return page,
  // reconcile and the host's cancel can never start two refunds at once.
  const { data: claimData, error: claimError } = await serviceDb.rpc(
    "gig_refund_claim",
    { p_contract_id: contractId, p_branch: branch },
  );
  let claimId: string | null = null;
  if (claimError) {
    const missing = claimError.code === "PGRST202" ||
      claimError.code === "42883" ||
      /could not find the function|does not exist/i.test(
        String(claimError.message ?? ""),
      );
    if (!missing) {
      console.error("[gig-refund] claim failed", claimError);
      return json({ error: "refund_claim_failed" }, 500);
    }
    // [TRANSITIONAL] old SQL before the #4402 migration applies: no claim
    // table yet; provider idempotency keys still dedupe. Exit: migration applied.
    console.warn("[gig-refund] gig_refund_claim missing (migration pending)");
  } else {
    const claim = (claimData ?? {}) as {
      claimed?: boolean;
      claim_id?: string;
      reason?: string;
      provider_ref?: string | null;
    };
    if (claim.claimed !== true) {
      if (claim.reason === "completed") {
        return json({
          ok: true,
          replayed: true,
          provider_ref: claim.provider_ref ?? null,
        });
      }
      return json({ error: "refund_in_progress", reason: claim.reason ?? null }, 409);
    }
    claimId = claim.claim_id ?? null;
  }
  const finishClaim = async (
    ok: boolean,
    providerRef: string | null,
    errorText: string | null,
  ): Promise<{ status?: string; attempts?: number } | null> => {
    if (!claimId) return null;
    const { data, error } = await serviceDb.rpc("gig_refund_claim_finish", {
      p_claim_id: claimId,
      p_ok: ok,
      p_provider_ref: providerRef,
      p_error: errorText,
      p_max_attempts: GIG_REFUND_MAX_ATTEMPTS,
    });
    if (error) console.error("[gig-refund] claim finish failed", error);
    return (data ?? null) as { status?: string; attempts?: number } | null;
  };
  const providerRefs: string[] = [];
  let providerRef = "none";
  let data: unknown = null;
  try {
    for (const source of quote.sources ?? []) {
      const amount = Number(source.amount_minor);
      if (!Number.isSafeInteger(amount) || amount <= 0) continue;
      const idempotency =
        `gig_refund:${contractId}:${branch}:${source.kind}:${source.id}:${amount}`;
      if (quote.rail === "stripe") {
        const refund = await stripeTicketRefund().refunds.create({
          payment_intent: source.provider_ref,
          amount,
          metadata: {
            mingla_kind: "gig_refund",
            contract_id: contractId,
            branch,
            source: source.kind,
          },
        }, { idempotencyKey: idempotency });
        providerRefs.push(refund.id);
      } else {
        const refund = await createPaystackRefund({
          transaction: source.provider_ref,
          merchantNote: idempotency,
          amountSubunits: amount,
          currency: String(quote.currency),
        });
        providerRefs.push(refund.id);
      }
    }
    providerRef = providerRefs.length ? providerRefs.join(",") : "none";
    const recorded = await serviceDb.rpc("gig_refund_record", {
      p_contract_id: contractId,
      p_branch: branch,
      p_refund_minor: Number(quote.refund_minor),
      p_creator_fee_minor: Number(quote.creator_fee_minor),
      p_provider_ref: providerRef,
    });
    if (recorded.error) {
      throw new Error(`refund_record_failed:${recorded.error.message}`);
    }
    data = recorded.data;
  } catch (refundError) {
    const message = refundError instanceof Error
      ? refundError.message
      : String(refundError);
    console.error("[gig-refund] refund failed", message);
    // Backoff, then stop and alert after GIG_REFUND_MAX_ATTEMPTS (#4402 P3).
    const finished = await finishClaim(false, null, message);
    if (finished?.status === "gave_up") {
      await notifyGigRefundGaveUp({
        contractId,
        branch,
        attempts: Number(finished.attempts ?? GIG_REFUND_MAX_ATTEMPTS),
        error: message,
      });
    }
    return json({
      error: message.startsWith("refund_record_failed")
        ? "refund_record_failed"
        : "refund_provider_failed",
      retry: finished?.status === "failed",
    }, 502);
  }
  await finishClaim(true, providerRef, null);
  return json({
    ok: true,
    provider_ref: providerRef,
    amounts: {
      hostRefundMinor: Number(quote.refund_minor),
      creatorFeeMinor: Number(quote.creator_fee_minor),
    },
    ledger: data,
  });
});
