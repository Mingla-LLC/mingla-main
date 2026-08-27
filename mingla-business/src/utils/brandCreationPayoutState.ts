import type { BrandStripeStatus } from "../types/brand";

export type BrandCreationPayoutState =
  | "loading"
  | "ready"
  | "not-connected"
  | "pending"
  | "restricted"
  | "unknown-error"
  | "offline"
  | "permission-denied";

export interface DeriveBrandCreationPayoutStateInput {
  permission: "loading" | "allowed" | "denied" | "error";
  online: boolean;
  statusResolved: boolean;
  statusError: boolean;
  stripeStatus?: BrandStripeStatus | null;
  paystackSubaccountCode?: string | null;
}

/**
 * Canonical payout-state projection for brand creation.
 *
 * Currency selects pricing context; it never proves a bank can collect.
 * Free creators stay open in every payout state.
 */
export function deriveBrandCreationPayoutState(
  input: DeriveBrandCreationPayoutStateInput,
): BrandCreationPayoutState {
  if (input.permission === "denied") return "permission-denied";
  if (input.permission === "error") return "unknown-error";
  if (!input.online) return "offline";
  if (input.permission === "loading" || !input.statusResolved) return "loading";
  if (
    input.paystackSubaccountCode != null ||
    input.stripeStatus === "active"
  ) {
    return "ready";
  }
  if (input.stripeStatus === "onboarding") return "pending";
  if (input.stripeStatus === "restricted") return "restricted";
  if (input.statusError) return "unknown-error";
  return "not-connected";
}

export function shouldResumeBrandCreationAtCreate(
  state: BrandCreationPayoutState,
): boolean {
  return state === "ready" || state === "pending" || state === "restricted";
}
