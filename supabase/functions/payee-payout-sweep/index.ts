/**
 * #3872 R2 B3 — 30-minute referral-payee payout sweep.
 *
 * Database RPCs own promotion, grouping, floors, debt netting and immutable
 * allocations. This worker performs only provider I/O against already-claimed
 * rows. A failed payout never re-prices or regroups its shares.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore Deno ESM
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type StripeClient, stripeWebhook } from "../_shared/stripe.ts";
import {
  PaystackApiError,
  paystackInitiateTransfer,
  paystackVerifyTransferByReference,
} from "../_shared/paystack.ts";
import { dispatchNotification } from "../_shared/stripeEdgeAuth.ts";
import {
  isDefinitiveProviderFailure,
  payeePayoutIdempotencyKey,
  type PayeePayoutWork,
  paystackPayeeReference,
  paystackReferenceMatchesWork,
  paystackTransferState,
  providerFailureCode,
  stripeTransferPayload,
} from "./engine.ts";

// The generated database types do not include this same-migration RPC surface
// until post-merge codegen. Keep the worker structurally loose at this boundary;
// every returned value is validated before provider I/O.
// deno-lint-ignore no-explicit-any
type AdminClient = any;

interface SweepDeps {
  supabaseUrl: () => string | undefined;
  serviceRoleKey: () => string | undefined;
  createAdmin: typeof createClient;
  createStripe: () => StripeClient;
  initiatePaystack: typeof paystackInitiateTransfer;
  verifyPaystack: typeof paystackVerifyTransferByReference;
  notify: typeof dispatchNotification;
}

const defaultDeps: SweepDeps = {
  supabaseUrl: () => Deno.env.get("SUPABASE_URL"),
  serviceRoleKey: () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  createAdmin: createClient,
  createStripe: stripeWebhook,
  initiatePaystack: paystackInitiateTransfer,
  verifyPaystack: paystackVerifyTransferByReference,
  notify: dispatchNotification,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function recordOutcome(
  admin: AdminClient,
  work: PayeePayoutWork,
  input: {
    status: "paid" | "in_transit" | "failed";
    providerRef?: string | null;
    failureCode?: string | null;
    definitive?: boolean;
  },
): Promise<Record<string, unknown>> {
  const { data, error } = await admin.rpc("payee_record_payout_outcome", {
    p_payout_id: work.payout_id,
    p_status: input.status,
    p_provider_ref: input.providerRef ?? null,
    p_failure_code: input.failureCode ?? null,
    p_definitive: input.definitive ?? false,
  });
  if (error) throw new Error(`payee_payout_outcome_failed:${error.message}`);
  return (data ?? {}) as Record<string, unknown>;
}

async function notifyNeedsFix(
  work: PayeePayoutWork,
  deps: SweepDeps,
): Promise<void> {
  await deps.notify({
    userId: work.payee_user_id,
    brandId: null,
    type: "payee.payout_account_needs_attention",
    title: "Fix your payout account",
    body:
      "We couldn't send your referral payout after three tries. Your money is still recorded—update your payout account to try again.",
    data: { payoutId: work.payout_id, rail: work.rail },
    relatedId: work.payout_id,
    relatedType: "payee_payout",
    idempotencyKey: `payee-payout-failed:${work.payout_id}`,
    deepLink: "mingla://payout-account",
  });
}

async function executeStripe(
  admin: AdminClient,
  stripe: StripeClient,
  work: PayeePayoutWork,
  deps: SweepDeps,
): Promise<"paid" | "retry" | "exhausted"> {
  const { error: markError } = await admin.rpc("payee_mark_payout_attempt", {
    p_payout_id: work.payout_id,
    p_provider_ref: null,
  });
  if (markError) {
    throw new Error(`payee_payout_attempt_failed:${markError.message}`);
  }
  try {
    // @ts-ignore Stripe runtime namespace.
    const transfer = await stripe.transfers.create(
      stripeTransferPayload(work),
      {
        idempotencyKey: payeePayoutIdempotencyKey(
          work.payout_id,
          work.attempt,
        ),
      },
    ) as { id: string };
    await recordOutcome(admin, work, {
      status: "paid",
      providerRef: transfer.id,
    });
    return "paid";
  } catch (error) {
    const outcome = await recordOutcome(admin, work, {
      status: "failed",
      failureCode: providerFailureCode(error),
      definitive: isDefinitiveProviderFailure(error),
    });
    if (outcome.outcome === "exhausted") {
      try {
        await notifyNeedsFix(work, deps);
      } catch (notifyError) {
        console.error(
          "[payee-payout-sweep] exhausted Stripe notification failed",
          notifyError,
        );
      }
      return "exhausted";
    }
    return "retry";
  }
}

async function applyVerifiedPaystack(
  admin: AdminClient,
  work: PayeePayoutWork,
  reference: string,
  transfer: Record<string, unknown>,
  deps: SweepDeps,
): Promise<"paid" | "in_transit" | "retry" | "exhausted"> {
  const state = paystackTransferState(transfer);
  const transferCode = typeof transfer.transfer_code === "string"
    ? transfer.transfer_code
    : reference;
  if (state !== "failed") {
    await recordOutcome(admin, work, {
      status: state,
      providerRef: transferCode,
    });
    return state;
  }
  const outcome = await recordOutcome(admin, work, {
    status: "failed",
    providerRef: reference,
    failureCode: String(transfer.failure_code ?? transfer.status ?? "failed"),
    definitive: true,
  });
  if (outcome.outcome === "exhausted") {
    try {
      await notifyNeedsFix(work, deps);
    } catch (notifyError) {
      console.error(
        "[payee-payout-sweep] exhausted Paystack notification failed",
        notifyError,
      );
    }
    return "exhausted";
  }
  return "retry";
}

async function executePaystack(
  admin: AdminClient,
  work: PayeePayoutWork,
  deps: SweepDeps,
): Promise<"paid" | "in_transit" | "retry" | "exhausted"> {
  const reference = paystackPayeeReference(work.payout_id, work.attempt);
  if (
    work.provider_ref && !paystackReferenceMatchesWork(work, work.provider_ref)
  ) {
    throw new Error("payee_paystack_provider_ref_conflict");
  }
  const { error: markError } = await admin.rpc("payee_mark_payout_attempt", {
    p_payout_id: work.payout_id,
    p_provider_ref: reference,
  });
  if (markError) {
    throw new Error(`payee_payout_attempt_failed:${markError.message}`);
  }

  // Reconcile the deterministic reference before any initiate. A lost response
  // can never mint a second transfer.
  try {
    const verified = await deps.verifyPaystack(reference);
    return await applyVerifiedPaystack(admin, work, reference, verified, deps);
  } catch (error) {
    const status = error instanceof PaystackApiError ? error.status : undefined;
    if (status !== 404) {
      const outcome = await recordOutcome(admin, work, {
        status: "failed",
        providerRef: reference,
        failureCode: providerFailureCode(error),
        definitive: false,
      });
      return outcome.outcome === "exhausted" ? "exhausted" : "retry";
    }
  }

  try {
    const transfer = await deps.initiatePaystack({
      amountSubunits: work.amount_minor,
      recipientCode: work.account_ref,
      reference,
      reason: `Mingla referral payout ${work.payout_id}`,
    });
    return await applyVerifiedPaystack(
      admin,
      work,
      reference,
      transfer as unknown as Record<string, unknown>,
      deps,
    );
  } catch (error) {
    const outcome = await recordOutcome(admin, work, {
      status: "failed",
      providerRef: reference,
      failureCode: providerFailureCode(error),
      definitive: isDefinitiveProviderFailure(error),
    });
    if (outcome.outcome === "exhausted") {
      try {
        await notifyNeedsFix(work, deps);
      } catch (notifyError) {
        console.error(
          "[payee-payout-sweep] exhausted Paystack notification failed",
          notifyError,
        );
      }
      return "exhausted";
    }
    return "retry";
  }
}

async function sendAccountNudges(
  admin: AdminClient,
  deps: SweepDeps,
): Promise<number> {
  const { data, error } = await admin.rpc("payee_claim_account_nudges", {
    p_limit: 50,
  });
  if (error) throw new Error(`payee_nudge_claim_failed:${error.message}`);
  let sent = 0;
  for (
    const row of (data ?? []) as Array<{
      payee_user_id: string;
      rail: string;
      currency: string;
      sent_count: number;
    }>
  ) {
    try {
      await deps.notify({
        userId: row.payee_user_id,
        brandId: null,
        type: "payee.payout_account_needed",
        title: "Connect your payout account",
        body:
          `You have a ${row.currency} referral reward waiting. Connect your ${
            row.rail === "stripe" ? "bank payout" : "Nigerian bank"
          } account to receive it.`,
        data: { rail: row.rail, currency: row.currency },
        relatedId: row.payee_user_id,
        relatedType: "payee_account",
        idempotencyKey:
          `payee-account-nudge:${row.payee_user_id}:${row.rail}:${row.currency}:${row.sent_count}`,
        deepLink: "mingla://payout-account",
      });
      sent++;
    } catch (notifyError) {
      console.error("[payee-payout-sweep] account nudge failed", notifyError);
    }
  }
  return sent;
}

export async function handlePayeePayoutSweep(
  req: Request,
  deps: SweepDeps = defaultDeps,
): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const url = deps.supabaseUrl() ?? "";
  const serviceKey = deps.serviceRoleKey() ?? "";
  if (!url || !serviceKey) return json({ error: "server_misconfigured" }, 500);
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${serviceKey}`) {
    return json({ error: "unauthorized" }, 401);
  }
  const admin = deps.createAdmin(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("payee_prepare_payout_sweep", {
    p_limit: 50,
  });
  if (error) return json({ error: "claim_failed", detail: error.message }, 500);
  const work = (data ?? []) as PayeePayoutWork[];
  const stripe = work.some((row) => row.rail === "stripe")
    ? deps.createStripe()
    : null;
  const counts = {
    claimed: work.length,
    paid: 0,
    inTransit: 0,
    retry: 0,
    exhausted: 0,
  };
  for (const row of work) {
    try {
      const outcome = row.rail === "stripe"
        ? await executeStripe(admin, stripe!, row, deps)
        : await executePaystack(admin, row, deps);
      if (outcome === "paid") counts.paid++;
      else if (outcome === "in_transit") counts.inTransit++;
      else if (outcome === "exhausted") counts.exhausted++;
      else counts.retry++;
    } catch (workError) {
      console.error("[payee-payout-sweep] payout row failed", {
        payoutId: row.payout_id,
        error: workError instanceof Error
          ? workError.message
          : String(workError),
      });
      counts.retry++;
    }
  }
  let nudges = 0;
  try {
    nudges = await sendAccountNudges(admin, deps);
  } catch (nudgeError) {
    console.error("[payee-payout-sweep] nudge phase failed", nudgeError);
  }
  return json({ ok: true, ...counts, nudges });
}

if (import.meta.main) serve((req) => handlePayeePayoutSweep(req));
