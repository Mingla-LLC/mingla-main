import type { BrandStripeStatus } from "../store/currentBrandStore";

export const ACTIVE_STRIPE_BANNER_TITLE = "You're connected to Stripe";

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
        title: "Connect bank to sell tickets",
        sub: "Get paid for your events. Setup takes 5 minutes.",
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
