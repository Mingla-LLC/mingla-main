import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { paystackVerifyTransaction } from "../_shared/paystack.ts";
import {
  createStripeReleasePayout,
  stripePayoutRelease,
  stripeWebhook,
} from "../_shared/stripe.ts";
import {
  dispatchNotification,
  getBrandPaymentManagerUserIds,
} from "../_shared/stripeEdgeAuth.ts";
import {
  classifyStripePayoutCreateError,
  executeStripeRelease,
  type StripeBalance,
  type StripePayout,
  type StripeReleaseCandidate,
  type StripeReleaseResult,
} from "./engine.ts";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

type SweepDeps = {
  env: (key: string) => string | undefined;
  createAdmin: typeof createClient;
  resolveProviderFee: (candidate: FeeCandidate) => Promise<FeeSnapshot>;
  createStripeReleaseClient?: () => StripeReleaseClient;
  notifyKycBlocked?: (
    admin: AdminClient,
    release: StripeReleaseCandidate,
  ) => Promise<void>;
  notifyAttemptCap?: (
    release: Pick<StripeReleaseCandidate, "release_id" | "brand_id">,
    message: string,
  ) => Promise<void>;
};

type AdminClient = ReturnType<typeof createClient>;

type StripeReleaseClient = {
  balance: {
    retrieve: (
      params: Record<string, never>,
      options: {
        stripeAccount: string;
        idempotencyKey: string;
      },
    ) => Promise<StripeBalance>;
  };
  payouts: {
    create: (
      params: {
        amount: number;
        currency: string;
        metadata: { mingla_release_id: string };
      },
      options: {
        stripeAccount: string;
        idempotencyKey: string;
      },
    ) => Promise<StripePayout>;
  };
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

type PayoutReleaseAlert = {
  alert_id: string;
  release_id: string;
  brand_id: string;
  error_message: string;
  idempotency_key: string;
  claim_id: string;
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
  createStripeReleaseClient: () => stripePayoutRelease(),
};

async function notifyKycBlocked(
  admin: AdminClient,
  release: StripeReleaseCandidate,
): Promise<void> {
  const userIds = await getBrandPaymentManagerUserIds(
    admin as never,
    release.brand_id,
  );
  for (const userId of userIds) {
    await dispatchNotification({
      userId,
      brandId: release.brand_id,
      type: "stripe.payout_release_blocked_kyc",
      title: "Finish Stripe verification",
      body:
        "Stripe needs updated account or bank details before this event payout can be released.",
      data: { releaseId: release.release_id },
      relatedId: release.release_id,
      relatedType: "payout_release",
      idempotencyKey:
        `stripe.payout_release_blocked_kyc:${release.release_id}:${userId}`,
      deepLink: `mingla-business://brand/${release.brand_id}/payments/onboard`,
    });
  }
}

async function notifyAttemptCap(
  release: Pick<StripeReleaseCandidate, "release_id" | "brand_id">,
  message: string,
): Promise<void> {
  await dispatchNotification({
    emailTo: "ops@mingla.app",
    emailVariant: "generic_notification",
    type: "ops.stripe_payout_release_attempt_cap",
    title: "Stripe organiser payout needs manual review",
    body:
      `Release ${release.release_id} exhausted 10 definitive payout attempts. Last error: ${
        message.slice(0, 500)
      }`,
    data: {
      releaseId: release.release_id,
      brandId: release.brand_id,
      attemptCap: 10,
    },
    relatedId: release.release_id,
    relatedType: "payout_release",
    idempotencyKey:
      `ops.stripe_payout_release_attempt_cap:${release.release_id}`,
    skipPush: true,
  });
}

async function deliverPendingAttemptCapAlerts(
  admin: AdminClient,
  deps: SweepDeps,
): Promise<{ claimed: number; delivered: number; retryPending: number }> {
  const { data, error } = await admin.rpc(
    "claim_payout_release_alerts" as never,
    {
      p_limit: 20,
      p_now: new Date().toISOString(),
    } as never,
  );
  if (error) {
    throw new Error(`payout_release_alert_claim_failed:${error.message}`);
  }

  const alerts = (data ?? []) as PayoutReleaseAlert[];
  const counts = { claimed: alerts.length, delivered: 0, retryPending: 0 };
  for (const alert of alerts) {
    let delivered = false;
    let deliveryError: string | null = null;
    try {
      await (deps.notifyAttemptCap ?? notifyAttemptCap)(
        {
          release_id: alert.release_id,
          brand_id: alert.brand_id,
        },
        alert.error_message,
      );
      delivered = true;
    } catch (error) {
      deliveryError = error instanceof Error ? error.message : String(error);
    }

    const { data: recordedStatus, error: recordError } = await admin.rpc(
      "record_payout_release_alert_delivery" as never,
      {
        p_alert_id: alert.alert_id,
        p_claim_id: alert.claim_id,
        p_delivered: delivered,
        p_error_message: deliveryError,
        p_now: new Date().toISOString(),
      } as never,
    );
    if (recordError) {
      throw new Error(
        `payout_release_alert_record_failed:${recordError.message}`,
      );
    }
    if (recordedStatus === "delivered") {
      counts.delivered++;
    } else {
      counts.retryPending++;
      console.error("[payout-release-sweep] attempt-cap alert retained", {
        alertId: alert.alert_id,
        releaseId: alert.release_id,
        message: deliveryError ?? "alert_delivery_not_confirmed",
      });
    }
  }
  return counts;
}

async function recordStripeExecution(
  admin: AdminClient,
  release: StripeReleaseCandidate,
  result: StripeReleaseResult,
): Promise<string> {
  const { data, error } = await admin.rpc(
    "record_stripe_payout_execution" as never,
    {
      p_release_id: release.release_id,
      p_claim_id: release.claim_id,
      p_outcome: result.outcome,
      p_payout_id: result.outcome === "accepted" ? result.payoutId : null,
      p_amount_cents: result.amountCents,
      p_error_message: result.outcome === "accepted" ? null : result.message,
      p_now: new Date().toISOString(),
    } as never,
  );
  if (error) {
    throw new Error(`stripe_execution_record_failed:${error.message}`);
  }
  return String(data);
}

async function executeClaimedStripeReleases(
  admin: AdminClient,
  deps: SweepDeps,
): Promise<{
  claimed: number;
  accepted: number;
  blockedBalance: number;
  blockedKyc: number;
  retryableErrors: number;
  definitiveErrors: number;
  notAuthorized: number;
}> {
  const { data, error } = await admin.rpc(
    "claim_stripe_payout_releases" as never,
    {
      p_limit: 20,
      p_now: new Date().toISOString(),
    } as never,
  );
  if (error) throw new Error(`stripe_release_claim_failed:${error.message}`);

  const releases = (data ?? []) as StripeReleaseCandidate[];
  if (releases.length === 0) {
    return {
      claimed: 0,
      accepted: 0,
      blockedBalance: 0,
      blockedKyc: 0,
      retryableErrors: 0,
      definitiveErrors: 0,
      notAuthorized: 0,
    };
  }
  const stripe = deps.createStripeReleaseClient?.() ??
    stripePayoutRelease();
  const counts = {
    claimed: releases.length,
    accepted: 0,
    blockedBalance: 0,
    blockedKyc: 0,
    retryableErrors: 0,
    definitiveErrors: 0,
    notAuthorized: 0,
  };
  for (const release of releases) {
    let result: StripeReleaseResult;
    try {
      result = await executeStripeRelease(release, {
        retrieveBalance: async (stripeAccountId) => {
          // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve; deterministic key is supplied for request tracing
          return await stripe.balance.retrieve({}, {
            stripeAccount: stripeAccountId,
            idempotencyKey: `brand_payout_balance_${release.release_id}`,
          });
        },
        revalidateReleaseImmediatelyBeforePayout: async (
          claimedRelease,
          amountCents,
        ) => {
          const { data: authorized, error: authorizationError } = await admin
            .rpc(
              "authorize_stripe_payout_execution" as never,
              {
                p_release_id: claimedRelease.release_id,
                p_claim_id: claimedRelease.claim_id,
                p_amount_cents: amountCents,
                p_now: new Date().toISOString(),
              } as never,
            );
          if (authorizationError) {
            throw new Error(
              `stripe_execution_authorization_failed:${authorizationError.message}`,
            );
          }
          return authorized === true;
        },
        createPayout: async (input) => {
          return await createStripeReleasePayout(stripe as never, input);
        },
      });
    } catch (error) {
      const classified = classifyStripePayoutCreateError(error);
      result = {
        ...classified,
        amountCents: release.net_release_cents +
          release.maturity_recredit_cents,
      };
    }
    if (result.outcome === "not_authorized") {
      counts.notAuthorized++;
      continue;
    }
    await recordStripeExecution(admin, release, result);
    if (result.outcome === "accepted") counts.accepted++;
    if (result.outcome === "blocked_balance") counts.blockedBalance++;
    if (result.outcome === "blocked_kyc") {
      counts.blockedKyc++;
      try {
        await (deps.notifyKycBlocked ?? notifyKycBlocked)(admin, release);
      } catch (notifyError) {
        console.error("[payout-release-sweep] KYC remediation alert failed", {
          releaseId: release.release_id,
          message: notifyError instanceof Error
            ? notifyError.message
            : String(notifyError),
        });
      }
    }
    if (result.outcome === "retryable_error") counts.retryableErrors++;
    if (result.outcome === "definitive_error") {
      counts.definitiveErrors++;
    }
  }
  return counts;
}

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
  let alertDelivery;
  try {
    alertDelivery = await deliverPendingAttemptCapAlerts(admin as never, deps);
  } catch (alertError) {
    console.error("[payout-release-sweep] durable alert drain failed", {
      message: alertError instanceof Error
        ? alertError.message
        : String(alertError),
    });
    return json({ error: "alert_delivery_failed" }, 500);
  }
  // #1172 ships DARK. The code path exists for test/R2 verification, but
  // production execution remains off until the orchestrator explicitly sets
  // PAYOUT_RELEASE_EXECUTE=true after the required soak gate.
  if (deps.env("PAYOUT_RELEASE_EXECUTE") !== "true") {
    return json({
      ok: true,
      dark: true,
      capturedFees,
      alertDelivery,
      result: data ?? {},
    });
  }
  try {
    const stripeExecution = await executeClaimedStripeReleases(
      admin as never,
      deps,
    );
    const newAlertDelivery = await deliverPendingAttemptCapAlerts(
      admin as never,
      deps,
    );
    return json({
      ok: true,
      dark: false,
      capturedFees,
      alertDelivery: {
        claimed: alertDelivery.claimed + newAlertDelivery.claimed,
        delivered: alertDelivery.delivered + newAlertDelivery.delivered,
        retryPending: alertDelivery.retryPending +
          newAlertDelivery.retryPending,
      },
      result: data ?? {},
      stripeExecution,
    });
  } catch (executionError) {
    console.error("[payout-release-sweep] Stripe execution phase failed", {
      message: executionError instanceof Error
        ? executionError.message
        : String(executionError),
    });
    return json({ error: "stripe_execution_failed" }, 500);
  }
}

if (import.meta.main) serve((req) => handlePayoutReleaseSweep(req));
