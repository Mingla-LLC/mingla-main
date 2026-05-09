export type StripeCountryReplacementLockReason =
  | "details_submitted"
  | "charges_enabled"
  | "payouts_enabled"
  | "local_money_movement"
  | "stripe_delete_rejected"
  | "stripe_state_unknown";

export interface StripeCountryReplacementState {
  details_submitted?: boolean | null;
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  hasLocalMoneyMovement?: boolean;
  stripeStateKnown?: boolean;
}

export interface StripeCountryReplacementDecision {
  replaceable: boolean;
  reason: StripeCountryReplacementLockReason | null;
}

export function decideStripeCountryReplacement(
  state: StripeCountryReplacementState,
): StripeCountryReplacementDecision {
  if (state.stripeStateKnown === false) {
    return { replaceable: false, reason: "stripe_state_unknown" };
  }
  if (state.details_submitted === true) {
    return { replaceable: false, reason: "details_submitted" };
  }
  if (state.charges_enabled === true) {
    return { replaceable: false, reason: "charges_enabled" };
  }
  if (state.payouts_enabled === true) {
    return { replaceable: false, reason: "payouts_enabled" };
  }
  if (state.hasLocalMoneyMovement === true) {
    return { replaceable: false, reason: "local_money_movement" };
  }
  return { replaceable: true, reason: null };
}

export function buildStripeOnboardCreateOperation(
  requestedCountry: string,
  oldStripeAccountId: string | null,
): string {
  const country = requestedCountry.trim().toUpperCase();
  const oldAccount = oldStripeAccountId?.trim() || "none";
  return `onboard_create:${country}:${oldAccount}`;
}

export function buildStripeOnboardLinkOperation(
  requestedCountry: string,
  stripeAccountId: string,
): string {
  const country = requestedCountry.trim().toUpperCase();
  return `onboard_account_link:${country}:${stripeAccountId}`;
}
