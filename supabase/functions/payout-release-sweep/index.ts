import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { paystackVerifyTransaction } from "../_shared/paystack.ts";
import { stripeWebhook } from "../_shared/stripe.ts";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

type SweepDeps = {
  env: (key: string) => string | undefined;
  createAdmin: typeof createClient;
  resolveProviderFee: (candidate: FeeCandidate) => Promise<FeeSnapshot>;
};

type FeeCandidate = {
  source_type: "order" | "rsvp_contribution" | "venue_reservation";
  source_id: string;
  provider: "stripe" | "paystack";
  provider_reference: string;
  stripe_account_id: string | null;
};

type FeeSnapshot = {
  provider_fee_cents: number;
  provider_balance_transaction_id: string | null;
};

export function providerReferenceRoute(
  provider: FeeCandidate["provider"],
  reference: string,
): "paystack_reference" | "stripe_charge" | "stripe_payment_intent" {
  if (provider === "paystack") return "paystack_reference";
  if (reference.startsWith("ch_")) return "stripe_charge";
  if (reference.startsWith("pi_")) return "stripe_payment_intent";
  throw new Error("unsupported_stripe_provider_reference");
}

function stripeFeeSnapshot(
  balanceTransaction:
    | {
      id: string;
      fee: number;
    }
    | string
    | null,
): FeeSnapshot {
  if (!balanceTransaction || typeof balanceTransaction === "string") {
    throw new Error("stripe_balance_transaction_not_expanded");
  }
  if (
    !Number.isInteger(balanceTransaction.fee) ||
    balanceTransaction.fee < 0
  ) {
    throw new Error("invalid_stripe_provider_fee");
  }
  return {
    provider_fee_cents: balanceTransaction.fee,
    provider_balance_transaction_id: balanceTransaction.id,
  };
}

async function resolveProviderFee(
  candidate: FeeCandidate,
): Promise<FeeSnapshot> {
  const route = providerReferenceRoute(
    candidate.provider,
    candidate.provider_reference,
  );
  if (route === "paystack_reference") {
    const transaction = await paystackVerifyTransaction(
      candidate.provider_reference,
    );
    const fee = Number(transaction.fees ?? 0);
    if (!Number.isInteger(fee) || fee < 0) {
      throw new Error("invalid_paystack_fee");
    }
    return {
      provider_fee_cents: fee,
      provider_balance_transaction_id: String(
        transaction.id ?? candidate.provider_reference,
      ),
    };
  }
  if (!candidate.stripe_account_id) throw new Error("stripe_account_required");
  // WEBHOOK is the existing least-privilege read role with Charges +
  // Balance-transactions read. BALANCES lacks Charges read.
  const stripe = stripeWebhook();
  if (route === "stripe_charge") {
    // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (GET; no mutation to dedupe)
    const charge = await stripe.charges.retrieve(
      candidate.provider_reference,
      { expand: ["balance_transaction"] },
      { stripeAccount: candidate.stripe_account_id },
    );
    return stripeFeeSnapshot(charge.balance_transaction);
  }
  // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (GET; no mutation to dedupe)
  const paymentIntent = await stripe.paymentIntents.retrieve(
    candidate.provider_reference,
    { expand: ["latest_charge.balance_transaction"] },
    { stripeAccount: candidate.stripe_account_id },
  );
  const latestCharge = paymentIntent.latest_charge;
  if (!latestCharge) throw new Error("stripe_payment_intent_has_no_charge");
  if (typeof latestCharge !== "string") {
    return stripeFeeSnapshot(latestCharge.balance_transaction);
  }
  // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (GET; no mutation to dedupe)
  const charge = await stripe.charges.retrieve(
    latestCharge,
    { expand: ["balance_transaction"] },
    { stripeAccount: candidate.stripe_account_id },
  );
  return stripeFeeSnapshot(charge.balance_transaction);
}

const defaultDeps: SweepDeps = {
  env: (key) => Deno.env.get(key),
  createAdmin: createClient,
  resolveProviderFee,
};

export async function handlePayoutReleaseSweep(
  req: Request,
  deps: SweepDeps = defaultDeps,
): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = deps.env("SUPABASE_URL");
  const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "server_misconfigured" }, 500);
  }

  // Exact comparison is mandatory. No prefix/suffix/substring or user-JWT path.
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${serviceKey}`) {
    return json({ error: "unauthorized" }, 401);
  }

  const admin = deps.createAdmin(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  // Per-charge provider fees are immutable ledger inputs. Missing fee truth
  // blocks attachment; it never silently becomes zero and never comes from an
  // aggregate provider balance.
  const { data: candidates, error: candidatesError } = await admin.rpc(
    "list_missing_payout_source_fees",
    { p_limit: 100 },
  );
  if (candidatesError) {
    console.error("[payout-release-sweep] fee candidate read failed", {
      code: candidatesError.code,
      message: candidatesError.message,
    });
    return json({ error: "fee_candidate_read_failed" }, 500);
  }
  let capturedFees = 0;
  for (const candidate of (candidates ?? []) as FeeCandidate[]) {
    try {
      const fee = await deps.resolveProviderFee(candidate);
      const { error: feeError } = await admin.from(
        "payout_source_fee_snapshots",
      )
        .upsert({
          source_type: candidate.source_type,
          source_id: candidate.source_id,
          ...fee,
        }, { onConflict: "source_type,source_id", ignoreDuplicates: true });
      if (feeError) throw feeError;
      capturedFees++;
    } catch (error) {
      console.error("[payout-release-sweep] provider fee capture deferred", {
        sourceType: candidate.source_type,
        sourceId: candidate.source_id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const { data, error } = await admin.rpc("run_payout_release_dark_sweep", {
    p_now: new Date().toISOString(),
  });
  if (error) {
    console.error("[payout-release-sweep] dark ledger RPC failed", {
      code: error.code,
      message: error.message,
    });
    return json({ error: "ledger_sweep_failed" }, 500);
  }
  // B is structurally dark: provider access above is read-only fee truth;
  // there is no payout/transfer/schedule mutation path.
  return json({ ok: true, dark: true, capturedFees, result: data ?? {} });
}

if (import.meta.main) serve((req) => handlePayoutReleaseSweep(req));
