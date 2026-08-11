import type { BrandStripeStatus } from "../store/currentBrandStore";
import { isPermissionDeniedError } from "./edgeFunctionErrors";

export const ACTIVE_STRIPE_BANNER_TITLE = "You're connected to Stripe";

/** The two ViewStates a failed `useBrandStripeStatus` may resolve to. */
export type BrandStripeStatusErrorViewState =
  | "permission-denied"
  | "failed-network";

/**
 * #1863 §4.6 — maps a status-query error to the onboarding ViewState.
 *
 * `BrandOnboardView` used to map ANY `statusQuery.isError` to `failed-network`
 * and tell the user "Check your connection and try again." Their connection was
 * fine; their ROLE was the problem, so they retried forever. Meanwhile the
 * `permission-denied` ViewState existed with a renderer and was DEAD CODE —
 * nothing anywhere set it.
 *
 * Lives here, as a pure exported function, so the classification is executable
 * in a plain node/ts-jest test without mounting anything: the regression suites
 * feed it the REAL error objects the REAL service functions produce, rather
 * than a hand-built fixture that could agree with a broken implementation.
 */
export function mapStripeStatusErrorToViewState(
  error: unknown,
): BrandStripeStatusErrorViewState {
  return isPermissionDeniedError(error) ? "permission-denied" : "failed-network";
}

export interface BrandProfileStripeBannerCopy {
  title: string;
  sub: string;
}

export interface StripeCountryPickerStateInput {
  stripeAccountId?: string | null;
  status?: BrandStripeStatus | null;
  detailsSubmitted?: boolean | null;
  chargesEnabled?: boolean | null;
  payoutsEnabled?: boolean | null;
}

export function isStripeCountryPickerLocked(
  input: StripeCountryPickerStateInput,
): boolean {
  if (!input.stripeAccountId) return false;
  if (input.status === "active") return true;
  if (input.detailsSubmitted === true) return true;
  if (input.chargesEnabled === true) return true;
  if (input.payoutsEnabled === true) return true;
  return false;
}

export function getStripeCountryLockedCopy(country: string | null): string {
  return `Stripe is connected for ${
    country ?? "this country"
  }. To use a different country or currency, create a new brand.`;
}

export function getStripeCountryReplaceableCopy(country: string): string {
  return `You can still change country because Stripe setup is not complete. We'll create a new Stripe setup for ${country}.`;
}

export function getBrandProfileStripeBannerCopy(
  status: BrandStripeStatus,
): BrandProfileStripeBannerCopy | null {
  switch (status) {
    case "not_connected":
      return {
        title: "Connect your bank to get paid",
        sub: "Get paid for what you sell. Setup takes 5 minutes.",
      };
    case "onboarding":
      return {
        title: "Onboarding submitted — verifying",
        sub: "We'll email you when Stripe finishes verifying your details.",
      };
    case "active":
      return null;
    case "restricted":
      return {
        title: "Action required",
        sub: "Stripe has limited your account. Tap to resolve.",
      };
  }
}

export function getBrandProfileStripeOperationsSub(
  status: BrandStripeStatus,
): string {
  switch (status) {
    case "not_connected":
      return "Not connected";
    case "onboarding":
      return "Onboarding…";
    case "active":
      return "Active";
    case "restricted":
      return "Action required";
  }
}
