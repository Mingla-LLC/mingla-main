// Issue #1174 — partner release adapter.
// Organiser release truth is checked atomically by the database RPC before a
// held split can become pending. Stripe then moves platform-balance funds with
// no source_transaction (#1029); Paystack pending rows remain owned by the
// existing reconcile-first partner retry sweep.

// @ts-ignore — Deno ESM
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPartnerStripeAccount } from "../_shared/partnerSplits.ts";
import type { StripeClient } from "../_shared/stripe.ts";

type ReleasablePartnerSplit = {
  id: string;
  provider: "stripe" | "paystack";
  stripe_application_fee_id: string;
  order_id: string;
  brand_id: string;
  partner_account_id: string;
  partner_share_cents: number;
  transfer_currency: string;
};

export type PartnerReleaseResult = {
  releasedStripe: number;
  pendingPaystack: number;
  retryableStripe: number;
  blockedStripe: number;
};

async function markPartnerBlocked(
  admin: SupabaseClient,
  split: ReleasablePartnerSplit,
  reason: "blocked_no_stripe" | "blocked_currency_mismatch" | "failed",
  message: string,
): Promise<void> {
  const { error } = await admin.rpc("mark_partner_split_failed", {
    p_application_fee_id: split.stripe_application_fee_id,
    p_reason: reason,
    p_error_message: message.slice(0, 1000),
  });
  if (error) {
    throw new Error(`partner split block write failed: ${error.message}`);
  }
}

async function markStripeLegSucceeded(
  admin: SupabaseClient,
  splitId: string,
  transferId: string,
): Promise<void> {
  const { error } = await admin
    .from("payout_transfer_legs")
    .update({
      status: "succeeded",
      provider_transfer_code: transferId,
      reconciled_at: new Date().toISOString(),
    })
    .eq("partner_split_id", splitId)
    .eq("kind", "partner");
  if (error) {
    throw new Error(`partner transfer leg update failed: ${error.message}`);
  }
}

export async function releasePartnerSplitsForOrganiserRelease(
  admin: SupabaseClient,
  stripe: StripeClient,
  releaseId: string,
): Promise<PartnerReleaseResult> {
  const { data, error } = await admin.rpc(
    "release_partner_splits_for_organiser_release",
    { p_release_id: releaseId },
  );
  if (error) {
    throw new Error(`partner release claim failed: ${error.message}`);
  }

  const result: PartnerReleaseResult = {
    releasedStripe: 0,
    pendingPaystack: 0,
    retryableStripe: 0,
    blockedStripe: 0,
  };
  for (const split of (data ?? []) as ReleasablePartnerSplit[]) {
    if (split.provider === "paystack") {
      result.pendingPaystack++;
      continue;
    }

    const account = await getPartnerStripeAccount(
      admin,
      split.partner_account_id,
    );
    if (
      !account || !account.stripe_account_id ||
      account.detached_at !== null ||
      !account.charges_enabled || !account.payouts_enabled
    ) {
      await markPartnerBlocked(
        admin,
        split,
        "blocked_no_stripe",
        "Partner has no active Stripe Connect account at release time.",
      );
      result.blockedStripe++;
      continue;
    }
    const currency = split.transfer_currency.toLowerCase();
    if (!account.external_account_currencies.includes(currency)) {
      await markPartnerBlocked(
        admin,
        split,
        "blocked_currency_mismatch",
        `Partner cannot settle in ${currency}. Available: ${
          account.external_account_currencies.join(",") || "none"
        }`,
      );
      result.blockedStripe++;
      continue;
    }

    try {
      // Plain platform-balance Transfer. A connected-account direct charge
      // cannot be used as source_transaction from the platform (#1029).
      // @ts-ignore — Stripe SDK Transfers namespace is runtime-provided.
      const transfer = await stripe.transfers.create(
        {
          amount: split.partner_share_cents,
          currency,
          destination: account.stripe_account_id,
          description: `Mingla partner share for order ${split.order_id}`,
          metadata: {
            mingla_application_fee_id: split.stripe_application_fee_id,
            mingla_order_id: split.order_id,
            mingla_brand_id: split.brand_id,
            mingla_partner_account_id: split.partner_account_id,
            mingla_release_id: releaseId,
            mingla_issue: "1174",
          },
        },
        {
          idempotencyKey: `partner_split_${split.stripe_application_fee_id}`,
        },
      );
      const transferId = String((transfer as { id: string }).id);
      const { error: markError } = await admin.rpc(
        "mark_partner_split_transferred",
        {
          p_application_fee_id: split.stripe_application_fee_id,
          p_transfer_id: transferId,
        },
      );
      if (markError) {
        throw new Error(
          `partner transfer ledger update failed: ${markError.message}`,
        );
      }
      await markStripeLegSucceeded(admin, split.id, transferId);
      result.releasedStripe++;
    } catch (caught) {
      const stripeError = caught as {
        type?: string;
        code?: string;
        message?: string;
      };
      if (stripeError.code === "balance_insufficient") {
        // Retryable: keep the same pending row and idempotency key.
        result.retryableStripe++;
        continue;
      }
      const isPermanent = stripeError.type === "StripeInvalidRequestError" ||
        stripeError.type === "StripePermissionError";
      if (isPermanent) {
        await markPartnerBlocked(
          admin,
          split,
          "failed",
          stripeError.message ?? "Stripe partner transfer rejected.",
        );
        result.blockedStripe++;
        continue;
      }
      // Ambiguous network/5xx outcome: preserve pending + same idempotency key.
      result.retryableStripe++;
    }
  }
  return result;
}
