/**
 * Stripe Connect → Mingla DB/UI projection helpers (Cycle B2).
 *
 * Keep logic aligned with `mingla-business/src/utils/stripeConnectStatus.ts`.
 */

export type BrandStripeStatus =
  | "not_connected"
  | "onboarding"
  | "active"
  | "restricted";

export interface StripeRequirementsLike {
  currently_due?: unknown;
  past_due?: unknown;
  disabled_reason?: unknown;
}

export interface StripeAccountLike {
  id: string;
  object?: string;
  type?: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  requirements?: StripeRequirementsLike | null;
  metadata?: Record<string, string> | null;
}

function reqArray(req: StripeRequirementsLike | null | undefined, key: string): unknown[] {
  if (req === null || req === undefined) return [];
  const v = (req as Record<string, unknown>)[key];
  return Array.isArray(v) ? v : [];
}

/**
 * Derive UI Connect state from mirrored `brands` + optional `requirements` snapshot.
 *
 * @param stripeConnectId — `brands.stripe_connect_id` (acct_…)
 */
export function deriveBrandStripeStatus(
  stripeConnectId: string | null | undefined,
  chargesEnabled: boolean,
  _payoutsEnabled: boolean,
  requirements: StripeRequirementsLike | Record<string, unknown> | null | undefined,
): BrandStripeStatus {
  if (stripeConnectId === null || stripeConnectId === undefined || stripeConnectId.trim() === "") {
    return "not_connected";
  }

  const req = requirements as StripeRequirementsLike | null | undefined;
  const disabledReason =
    req !== null &&
    req !== undefined &&
    typeof (req as StripeRequirementsLike).disabled_reason === "string" &&
    ((req as StripeRequirementsLike).disabled_reason as string).length > 0
      ? ((req as StripeRequirementsLike).disabled_reason as string)
      : null;

  if (disabledReason !== null) {
    return "restricted";
  }

  if (chargesEnabled) {
    return "active";
  }

  const due =
    reqArray(req ?? null, "currently_due").length > 0 ||
    reqArray(req ?? null, "past_due").length > 0;
  if (due) {
    return "onboarding";
  }

  return "onboarding";
}

export interface ConnectAccountRowProjection {
  stripe_account_id: string;
  account_type: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  requirements: Record<string, unknown>;
}

export function projectStripeAccountToConnectRow(account: StripeAccountLike): ConnectAccountRowProjection {
  return {
    stripe_account_id: account.id,
    account_type: account.type ?? "express",
    charges_enabled: account.charges_enabled ?? false,
    payouts_enabled: account.payouts_enabled ?? false,
    requirements: (account.requirements ?? {}) as Record<string, unknown>,
  };
}

export type DbPayoutStatus = "pending" | "paid" | "failed";

/** Map Stripe Payout.status to `public.payouts.status` CHECK constraint. */
export function mapStripePayoutStatus(stripeStatus: string | undefined): DbPayoutStatus {
  switch (stripeStatus) {
    case "paid":
      return "paid";
    case "failed":
    case "canceled":
      return "failed";
    case "pending":
    case "in_transit":
    default:
      return "pending";
  }
}
