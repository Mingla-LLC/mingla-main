/**
 * gig-refund — refunds a creator-hire payment (#3872), single-flight (#4402).
 *
 * Order: authorize (user callers) → claim the hold in the database → quote →
 * provider refund → ledger record → finish the claim. The claim comes before
 * the quote, so any failure after it (a refused quote, a provider error, a
 * ledger error) gets the same backoff, give-up and alert (#4402 N2), and two
 * callers can never both reach the provider (#4402 F3).
 *
 * Clients and provider calls are injected so the Deno suite can race two
 * callers against one fake store (index.ts wires the real ones).
 */
// @ts-ignore — Deno ESM import; types resolved at runtime
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { RefundBranch } from "../_shared/gigMoney.ts";

/** #4402: a refund is retried with backoff this many times, then alerted. */
export const GIG_REFUND_MAX_ATTEMPTS = 5;

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

export interface GigRefundDeps {
  serviceClient(): SupabaseClient;
  userClient(authorization: string): SupabaseClient;
  isCronCaller(authorization: string): Promise<boolean>;
  stripeRefund(
    params: {
      payment_intent: string;
      amount: number;
      metadata: Record<string, string>;
    },
    idempotencyKey: string,
  ): Promise<{ id: string }>;
  paystackRefund(input: {
    transaction: string;
    merchantNote: string;
    amountSubunits: number;
    currency: string;
  }): Promise<{ id: string }>;
  notifyGaveUp(input: {
    contractId: string;
    branch: string;
    attempts: number;
    error: string;
  }): Promise<number>;
}

function isMissingFunction(
  error: { code?: string; message?: string },
): boolean {
  return error.code === "PGRST202" || error.code === "42883" ||
    /could not find the function|does not exist/i.test(
      String(error.message ?? ""),
    );
}

export function createGigRefundHandler(
  deps: GigRefundDeps,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }
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
    const serviceDb = deps.serviceClient();
    const isMachine = await deps.isCronCaller(authorization);
    if (!isMachine) {
      if (!userBranches.has(branch)) {
        return json({ error: "branch_requires_service" }, 403);
      }
      const userDb = deps.userClient(authorization);
      const { error } = await userDb.rpc("gig_refund_authorize", {
        p_contract_id: contractId,
        p_branch: branch,
      });
      if (error) {
        return json({ error: "refund_not_allowed" }, 403);
      }
    }

    // #4402 F3: one refund per hold (or counter difference), claimed in the
    // database BEFORE any provider call, so the webhook, the return page,
    // reconcile and the host's cancel can never start two refunds at once.
    const { data: claimData, error: claimError } = await serviceDb.rpc(
      "gig_refund_claim",
      { p_contract_id: contractId, p_branch: branch },
    );
    let claimId: string | null = null;
    if (claimError) {
      if (!isMissingFunction(claimError)) {
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
        branch?: string;
        provider_ref?: string | null;
      };
      if (claim.claimed !== true) {
        if (claim.reason === "completed") {
          // #4402 N3: a replay only for the branch that was refunded.
          if (claim.branch && claim.branch !== branch) {
            return json({
              error: "refund_already_recorded",
              branch: claim.branch,
            }, 409);
          }
          return json({
            ok: true,
            replayed: true,
            provider_ref: claim.provider_ref ?? null,
          });
        }
        if (claim.reason === "nothing_due") {
          return json({ error: "refund_not_ready" }, 409);
        }
        return json(
          { error: "refund_in_progress", reason: claim.reason ?? null },
          409,
        );
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
    // Every failure after the claim: backoff, then stop and alert after
    // GIG_REFUND_MAX_ATTEMPTS (#4402 P3 / N2).
    const fail = async (code: string, message: string, status: number) => {
      console.error("[gig-refund] refund failed", code, message);
      const finished = await finishClaim(false, null, `${code}:${message}`);
      if (finished?.status === "gave_up") {
        await deps.notifyGaveUp({
          contractId,
          branch,
          attempts: Number(finished.attempts ?? GIG_REFUND_MAX_ATTEMPTS),
          error: `${code}:${message}`,
        });
      }
      return json(
        { error: code, retry: finished?.status === "failed" },
        status,
      );
    };

    const { data: quoteData, error: quoteError } = await serviceDb.rpc(
      "gig_refund_quote",
      { p_contract_id: contractId, p_branch: branch },
    );
    if (quoteError || !quoteData) {
      return await fail(
        "refund_not_ready",
        String(quoteError?.message ?? "no quote"),
        409,
      );
    }
    const quote = quoteData as RefundQuote;
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
          const refund = await deps.stripeRefund({
            payment_intent: source.provider_ref,
            amount,
            metadata: {
              mingla_kind: "gig_refund",
              contract_id: contractId,
              branch,
              source: source.kind,
            },
          }, idempotency);
          providerRefs.push(refund.id);
        } else {
          const refund = await deps.paystackRefund({
            transaction: source.provider_ref,
            merchantNote: idempotency,
            amountSubunits: amount,
            currency: String(quote.currency),
          });
          providerRefs.push(refund.id);
        }
      }
    } catch (providerError) {
      return await fail(
        "refund_provider_failed",
        providerError instanceof Error
          ? providerError.message
          : String(providerError),
        502,
      );
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
      return await fail(
        "refund_record_failed",
        String(recorded.error.message ?? "record failed"),
        500,
      );
    }
    data = recorded.data;
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
  };
}
