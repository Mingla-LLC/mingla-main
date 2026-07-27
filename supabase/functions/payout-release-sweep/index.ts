import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { paystackVerifyTransaction } from "../_shared/paystack.ts";
// Issue #1177 — the organiser Paystack transfer client lives in _shared so the
// raw provider call never appears in the sweep source (DARK-sweep source guard).
import {
  defaultPaystackReleaseClient,
  type PaystackReleaseClient,
} from "../_shared/paystackOrganiserRelease.ts";
import {
  createStripeReleasePayout,
  stripePayoutRelease,
  stripeWebhook,
} from "../_shared/stripe.ts";
import {
  dispatchNotification,
  getBrandPaymentManagerUserIds,
  NotificationDispatchError,
} from "../_shared/stripeEdgeAuth.ts";
import {
  classifyStripePayoutCreateError,
  executeStripeRelease,
  executePaystackRelease,
  planOrganiserTransferChunks,
  type PaystackOrganiserLeg,
  type PaystackReleaseCandidate,
  type StripeBalance,
  type StripePayout,
  type StripeReleaseCandidate,
  type StripeReleaseResult,
} from "./engine.ts";
import { releasePartnerSplitsForOrganiserRelease } from "./partnerRelease.ts";

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
    alertKind?: string,
  ) => Promise<"provider_accepted" | void>;
  // Issue #1177 — injectable Paystack transfer client (mirror of
  // createStripeReleaseClient) so the organiser rail is unit-testable.
  createPaystackReleaseClient?: () => PaystackReleaseClient;
};

type PaystackClaimRow = {
  release_id: string;
  brand_id: string;
  recipient_code: string;
  currency: string;
  net_release_cents: number;
  maturity_recredit_cents: number;
  attempt_count: number;
  claim_id: string;
};

export type PaystackSweepCounts = {
  claimed: number;
  deferredSubFloor: number;
  reconciled: number;
  initiated: number;
  succeededLegs: number;
  inFlight: number;
  blockedBalance: number;
  blockedOtp: number;
  feeUnreconciled: number;
  retryable: number;
  definitive: number;
  reversed: number;
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
  // Issue #1217 — the drain now returns alert_kind so the worker can emit
  // rail-aware copy (Stripe vs Paystack) rather than Stripe-only wording.
  alert_kind: string;
  error_message: string;
  idempotency_key: string;
  claim_id: string;
};

// Issue #1217 — rail-aware ops alert copy keyed on the outbox alert_kind. Each
// kind maps to a distinct notification type + idempotency key so a Paystack
// payout-release alert never reads as a Stripe one. The default keeps the
// original Stripe attempt-cap wording for the legacy stripe_attempt_cap kind.
function payoutReleaseAlertCopy(alertKind: string): {
  type: string;
  title: string;
  bodyLead: string;
} {
  switch (alertKind) {
    case "paystack_otp_blocked":
      return {
        type: "ops.paystack_payout_release_otp_blocked",
        title: "Paystack organiser payout is blocked on transfer OTP",
        bodyLead: "is blocked because Paystack transfer OTP is still enabled",
      };
    case "paystack_attempt_cap":
      return {
        type: "ops.paystack_payout_release_attempt_cap",
        title: "Paystack organiser payout needs manual review",
        bodyLead: "exhausted its Paystack transfer attempts",
      };
    case "paystack_fee_unreconciled":
      return {
        type: "ops.paystack_payout_release_fee_unreconciled",
        title: "Paystack organiser payout fee needs reconciliation",
        bodyLead: "has an unreconciled Paystack transfer fee",
      };
    case "paystack_reversal_unreconciled":
      return {
        type: "ops.paystack_payout_release_reversal_unreconciled",
        title: "Paystack organiser payout reversal needs manual review",
        bodyLead:
          "was reversed by Paystack with no resolvable returned amount and credited nothing",
      };
    case "paystack_over_cap":
      return {
        type: "ops.paystack_payout_release_over_cap",
        title: "Paystack organiser payout exceeds the transfer cap",
        bodyLead: "exceeds the Paystack transfer cap",
      };
    case "stripe_attempt_cap":
    default:
      return {
        type: "ops.stripe_payout_release_attempt_cap",
        title: "Stripe organiser payout needs manual review",
        bodyLead: "exhausted 10 definitive payout attempts",
      };
  }
}

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
  alertKind = "stripe_attempt_cap",
): Promise<"provider_accepted"> {
  // Issue #1217 — pick rail-aware copy + a kind-specific idempotency key so a
  // Paystack payout-release alert reads correctly instead of as a Stripe one.
  const copy = payoutReleaseAlertCopy(alertKind);
  const result = await dispatchNotification({
    emailTo: "ops@mingla.app",
    emailVariant: "generic_notification",
    type: copy.type,
    title: copy.title,
    body: `Release ${release.release_id} ${copy.bodyLead}. Last error: ${
      message.slice(0, 500)
    }`,
    data: {
      releaseId: release.release_id,
      brandId: release.brand_id,
      alertKind,
    },
    relatedId: release.release_id,
    relatedType: "payout_release",
    idempotencyKey: `${copy.type}:${release.release_id}`,
    skipPush: true,
  });
  if (!result.providerAccepted) {
    throw new Error("attempt_cap_provider_acceptance_missing");
  }
  return "provider_accepted";
}

async function deliverPendingAttemptCapAlerts(
  admin: AdminClient,
  deps: SweepDeps,
): Promise<{
  claimed: number;
  providerAccepted: number;
  retryPending: number;
  manualReview: number;
}> {
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
  const counts = {
    claimed: alerts.length,
    providerAccepted: 0,
    retryPending: 0,
    manualReview: 0,
  };
  for (const alert of alerts) {
    let outcome: "provider_accepted" | "retryable" | "manual_review" =
      "retryable";
    let deliveryError: string | null = null;
    try {
      await (deps.notifyAttemptCap ?? notifyAttemptCap)(
        {
          release_id: alert.release_id,
          brand_id: alert.brand_id,
        },
        alert.error_message,
        alert.alert_kind,
      );
      outcome = "provider_accepted";
    } catch (error) {
      deliveryError = error instanceof Error ? error.message : String(error);
      if (
        error instanceof NotificationDispatchError &&
        error.manualReview
      ) {
        outcome = "manual_review";
      }
    }

    const { data: recordedStatus, error: recordError } = await admin.rpc(
      "record_payout_release_alert_delivery" as never,
      {
        p_alert_id: alert.alert_id,
        p_claim_id: alert.claim_id,
        p_outcome: outcome,
        p_error_message: deliveryError,
        p_now: new Date().toISOString(),
      } as never,
    );
    if (recordError) {
      throw new Error(
        `payout_release_alert_record_failed:${recordError.message}`,
      );
    }
    if (recordedStatus === "provider_accepted") {
      counts.providerAccepted++;
    } else if (recordedStatus === "manual_review") {
      counts.manualReview++;
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

async function readOrganiserLegs(
  admin: AdminClient,
  releaseId: string,
): Promise<PaystackOrganiserLeg[]> {
  const { data, error } = await admin
    .from("payout_transfer_legs")
    .select(
      "id, chunk_index, principal_cents, estimated_fee_cents, stamp_duty_cents, status, provider_reference, provider_transfer_code, attempt_count",
    )
    .eq("release_id", releaseId)
    .eq("kind", "organiser")
    .order("chunk_index", { ascending: true });
  if (error) throw new Error(`organiser_leg_read_failed:${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    legId: String(row.id),
    chunkIndex: Number(row.chunk_index),
    principalCents: Number(row.principal_cents),
    estimatedFeeCents: Number(row.estimated_fee_cents),
    stampDutyCents: Number(row.stamp_duty_cents),
    status: String(row.status),
    providerReference: row.provider_reference == null
      ? null
      : String(row.provider_reference),
    providerTransferCode: row.provider_transfer_code == null
      ? null
      : String(row.provider_transfer_code),
    attemptCount: Number(row.attempt_count),
  }));
}

async function readPartnerCeilingKobo(
  admin: AdminClient,
  releaseId: string,
): Promise<number> {
  const { data, error } = await admin
    .from("payout_transfer_legs")
    .select("principal_cents, estimated_fee_cents, stamp_duty_cents")
    .eq("release_id", releaseId)
    .eq("kind", "partner");
  if (error) throw new Error(`partner_leg_read_failed:${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).reduce(
    (total, row) =>
      total + Number(row.principal_cents) + Number(row.estimated_fee_cents) +
      Number(row.stamp_duty_cents),
    0,
  );
}

// Issue #1177 — organiser Paystack Transfer execution. Inserted between the
// partner-leg plan/Stripe execution and the partner release loop so partner
// rows still flip after their organiser release succeeds. Balance is CEILING-
// ONLY; verify-by-code-then-reference precedes every initiate (#1030); ships
// DARK behind PAYOUT_RELEASE_EXECUTE (this function is only reached in the
// enabled path). One release's failure never stops the sweep.
async function executeClaimedPaystackReleases(
  admin: AdminClient,
  deps: SweepDeps,
): Promise<PaystackSweepCounts> {
  const totals: PaystackSweepCounts = {
    claimed: 0,
    deferredSubFloor: 0,
    reconciled: 0,
    initiated: 0,
    succeededLegs: 0,
    inFlight: 0,
    blockedBalance: 0,
    blockedOtp: 0,
    feeUnreconciled: 0,
    retryable: 0,
    definitive: 0,
    reversed: 0,
  };
  const { data, error } = await admin.rpc(
    "claim_paystack_payout_releases" as never,
    { p_limit: 20, p_now: new Date().toISOString() } as never,
  );
  if (error) throw new Error(`paystack_release_claim_failed:${error.message}`);
  const releases = (data ?? []) as PaystackClaimRow[];
  totals.claimed = releases.length;
  if (releases.length === 0) return totals;

  const client = deps.createPaystackReleaseClient?.() ??
    defaultPaystackReleaseClient();

  for (const release of releases) {
    try {
      let legs = await readOrganiserLegs(admin, release.release_id);

      // Plan (and PERSIST) the chunk plan BEFORE any initiate if not already
      // planned. Re-claim of an in-flight release reuses the existing plan.
      if (legs.length === 0) {
        const pool = release.net_release_cents +
          release.maturity_recredit_cents;
        const plan = planOrganiserTransferChunks(pool);
        if ("deferred" in plan) {
          // Sub-floor: no leg, no transfer, no fee — roll forward (SC-3). Return
          // the release to pending under the claim guard (RPC-mediated).
          totals.deferredSubFloor += 1;
          const { error: deferErr } = await admin.rpc(
            "defer_paystack_payout_release" as never,
            {
              p_release_id: release.release_id,
              p_claim_id: release.claim_id,
              p_reason: "paystack_pool_below_transfer_floor",
              p_now: new Date().toISOString(),
            } as never,
          );
          if (deferErr) {
            throw new Error(`paystack_subfloor_defer_failed:${deferErr.message}`);
          }
          continue;
        }
        const legPlan = plan.chunks.map((chunk) => ({
          chunk_index: chunk.chunkIndex,
          principal_cents: chunk.principalCents,
          estimated_fee_cents: chunk.estimatedFeeCents,
          stamp_duty_cents: chunk.stampDutyCents,
          fee_schedule_version: chunk.scheduleVersion,
        }));
        const { error: planErr } = await admin.rpc(
          "record_paystack_leg_plan" as never,
          {
            p_release_id: release.release_id,
            p_claim_id: release.claim_id,
            p_legs: legPlan,
            p_now: new Date().toISOString(),
          } as never,
        );
        if (planErr) throw new Error(`paystack_leg_plan_failed:${planErr.message}`);
        legs = await readOrganiserLegs(admin, release.release_id);
      }

      const partnerCeilingKobo = await readPartnerCeilingKobo(
        admin,
        release.release_id,
      );

      const candidate: PaystackReleaseCandidate = {
        release_id: release.release_id,
        brand_id: release.brand_id,
        recipient_code: release.recipient_code,
        currency: release.currency,
        organiser_legs: legs,
        partner_ceiling_kobo: partnerCeilingKobo,
      };

      const counts = await executePaystackRelease(candidate, {
        getBalanceNgnKobo: async () => {
          const rows = await client.getBalance();
          const ngn = rows.find((row) => row.currency === "NGN");
          return ngn ? ngn.balance : 0;
        },
        fetchTransfer: (code) => client.fetchTransfer(code),
        verifyTransferByReference: (ref) => client.verifyTransferByReference(ref),
        authorize: async () => {
          const { data: ok, error: authErr } = await admin.rpc(
            "authorize_paystack_payout_execution" as never,
            {
              p_release_id: release.release_id,
              p_claim_id: release.claim_id,
              p_now: new Date().toISOString(),
            } as never,
          );
          if (authErr) {
            throw new Error(`paystack_authorize_failed:${authErr.message}`);
          }
          return ok === true;
        },
        initiateTransfer: (input) => client.initiateTransfer(input),
        recordLegOutcome: async (input) => {
          const { error: recErr } = await admin.rpc(
            "record_paystack_transfer_leg_outcome" as never,
            {
              p_leg_id: input.legId,
              p_release_id: release.release_id,
              p_outcome: input.outcome,
              p_transfer_code: input.transferCode,
              p_reference: input.reference,
              p_error: input.error,
              p_now: new Date().toISOString(),
            } as never,
          );
          if (recErr) {
            throw new Error(`paystack_leg_record_failed:${recErr.message}`);
          }
        },
        reconcileLegFee: async (input) => {
          const { error: feeErr } = await admin.rpc(
            "reconcile_paystack_transfer_leg_fee" as never,
            {
              p_leg_id: input.legId,
              p_actual_fee_cents: input.actualFeeCents,
              p_actual_stamp_cents: input.actualStampCents,
              p_now: new Date().toISOString(),
            } as never,
          );
          if (feeErr) {
            throw new Error(`paystack_fee_reconcile_failed:${feeErr.message}`);
          }
        },
        reverseLeg: async (input) => {
          const { error: revErr } = await admin.rpc(
            "reverse_paystack_transfer_leg" as never,
            {
              p_leg_id: input.legId,
              p_returned_principal_cents: input.returnedPrincipalCents,
              p_now: new Date().toISOString(),
            } as never,
          );
          if (revErr) {
            throw new Error(`paystack_reverse_failed:${revErr.message}`);
          }
        },
      });

      totals.reconciled += counts.reconciled;
      totals.initiated += counts.initiated;
      totals.succeededLegs += counts.succeeded;
      totals.inFlight += counts.inFlight;
      totals.blockedBalance += counts.blockedBalance;
      totals.blockedOtp += counts.blockedOtp;
      totals.feeUnreconciled += counts.feeUnreconciled;
      totals.retryable += counts.retryable;
      totals.definitive += counts.definitive;
      totals.reversed += counts.reversed;
    } catch (releaseError) {
      // Per-release isolation — one release's failure never stops the sweep.
      console.error("[payout-release-sweep] Paystack release failed", {
        releaseId: release.release_id,
        message: releaseError instanceof Error
          ? releaseError.message
          : String(releaseError),
      });
    }
  }
  return totals;
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

  // Plan partner legs before C's organiser claim/authorization/execution.
  // Paystack
  // movement costs are itemized and deducted from organiser cash without
  // touching partner principal.
  const { data: partnerPlan, error: partnerPlanError } = await admin.rpc(
    "plan_pending_payout_partner_legs",
    { p_limit: 100 },
  );
  if (partnerPlanError) {
    console.error("[payout-release-sweep] partner leg planning failed", {
      code: partnerPlanError.code,
      message: partnerPlanError.message,
    });
    return json({ error: "partner_leg_planning_failed" }, 500);
  }
  const blockedPartnerAttributions = typeof partnerPlan === "object" &&
      partnerPlan !== null &&
      typeof (partnerPlan as Record<string, unknown>)
          .blocked_partner_attributions === "number"
    ? Number(
      (partnerPlan as Record<string, unknown>)
        .blocked_partner_attributions,
    )
    : 0;
  if (blockedPartnerAttributions > 0) {
    console.error(
      "[payout-release-sweep] organiser execution blocked by missing provider-sale attribution",
      { blockedPartnerAttributions },
    );
    return json({
      error: "partner_attribution_pending",
      blockedPartnerAttributions,
    }, 409);
  }

  let stripeExecution;
  let newAlertDelivery;
  try {
    stripeExecution = await executeClaimedStripeReleases(
      admin as never,
      deps,
    );
    newAlertDelivery = await deliverPendingAttemptCapAlerts(
      admin as never,
      deps,
    );
  } catch (executionError) {
    console.error("[payout-release-sweep] Stripe execution phase failed", {
      message: executionError instanceof Error
        ? executionError.message
        : String(executionError),
    });
    return json({ error: "stripe_execution_failed" }, 500);
  }

  // Issue #1177 — Paystack organiser Transfer execution (Nigerian rail), between
  // the Stripe execution and the partner release loop. Per-release isolation is
  // inside executeClaimedPaystackReleases; a whole-phase failure never aborts
  // the sweep (mirror the partner sweep) — log and continue to partner release.
  let paystackExecution: PaystackSweepCounts | null = null;
  try {
    paystackExecution = await executeClaimedPaystackReleases(admin as never, deps);
  } catch (paystackError) {
    console.error("[payout-release-sweep] Paystack execution phase failed", {
      message: paystackError instanceof Error
        ? paystackError.message
        : String(paystackError),
    });
  }

  // Only organiser releases already accepted by their provider can unlock
  // partner rows. The claim RPC repeats that check under database truth.
  const { data: releasedRows, error: releasedError } = await admin
    .from("brand_payout_releases")
    .select("id")
    .eq("status", "released")
    .order("released_at", { ascending: true })
    .limit(100);
  if (releasedError) {
    console.error("[payout-release-sweep] released-row read failed", {
      code: releasedError.code,
      message: releasedError.message,
    });
    return json({ error: "released_row_read_failed" }, 500);
  }

  const totals = {
    releasedStripe: 0,
    pendingPaystack: 0,
    retryableStripe: 0,
    blockedStripe: 0,
  };
  const releasableRows = (releasedRows ?? []) as Array<{ id: string }>;
  if (releasableRows.length > 0) {
    const stripe = stripeWebhook();
    for (const row of releasableRows) {
      const released = await releasePartnerSplitsForOrganiserRelease(
        admin,
        stripe,
        row.id,
      );
      totals.releasedStripe += released.releasedStripe;
      totals.pendingPaystack += released.pendingPaystack;
      totals.retryableStripe += released.retryableStripe;
      totals.blockedStripe += released.blockedStripe;
    }
  }

  return json({
    ok: true,
    dark: false,
    capturedFees,
    alertDelivery: {
      claimed: alertDelivery.claimed + newAlertDelivery.claimed,
      providerAccepted: alertDelivery.providerAccepted +
        newAlertDelivery.providerAccepted,
      retryPending: alertDelivery.retryPending +
        newAlertDelivery.retryPending,
      manualReview: alertDelivery.manualReview +
        newAlertDelivery.manualReview,
    },
    result: data ?? {},
    stripeExecution,
    paystackExecution: paystackExecution ?? {},
    partnerPlan: partnerPlan ?? {},
    partnerRelease: totals,
  });
}

if (import.meta.main) serve((req) => handlePayoutReleaseSweep(req));
