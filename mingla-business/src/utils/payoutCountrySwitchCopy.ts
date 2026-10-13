/**
 * #3645 — organiser-facing copy for a failed payout-country switch.
 *
 * Shared by the web bank-connect screen and the native onboarding screen so
 * both tell the organiser the same thing when the switch to (or away from)
 * the Nigerian payout rail fails. Deliberately provider-neutral: the service
 * error text carries internal function and provider names and is never shown.
 */

import { BRAND_PAYMENTS_DENIED_BODY } from "./brandPaymentsPermission";

export const PAYOUT_COUNTRY_SWITCH_FAILED_COPY =
  "We couldn't update your payout country. Check your connection and try again.";

export const PAYOUT_COUNTRY_BANK_ALREADY_CONNECTED_COPY =
  "This brand already has a bank connected. Remove it in Payments before choosing a different country.";

/**
 * Shown under the country row when the brand already has a card payment
 * account, so its payout country cannot be changed from the app. One sentence,
 * shared by the web bank screen and the brand-creation / inline country field.
 */
export const PAYOUT_COUNTRY_PAYMENT_ACCOUNT_LOCKED_COPY =
  "This brand already has a payment account. Contact support to change country.";

export interface PayoutCountrySwitchFailure {
  /** What the organiser reads. */
  message: string;
  /**
   * False when trying again cannot help: the organiser may not change payouts
   * for this brand, or the brand already has a bank connected. Those get plain
   * copy and no "Try again" control.
   */
  retryable: boolean;
}

const failureText = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";

/**
 * Maps a select/clear payout-rail failure to one of the two switch sentences.
 * Kept as a closed two-string set; the permission refusal is added by
 * `describePayoutCountrySwitchFailure`, which is what the screens render.
 */
export function payoutCountrySwitchErrorCopy(error: unknown): string {
  return failureText(error).includes("disconnect_first")
    ? PAYOUT_COUNTRY_BANK_ALREADY_CONNECTED_COPY
    : PAYOUT_COUNTRY_SWITCH_FAILED_COPY;
}

/** Classifies a select/clear payout-rail failure for display. */
export function describePayoutCountrySwitchFailure(
  error: unknown,
): PayoutCountrySwitchFailure {
  if (/\bforbidden\b|permission_denied/.test(failureText(error))) {
    return { message: BRAND_PAYMENTS_DENIED_BODY, retryable: false };
  }
  const message = payoutCountrySwitchErrorCopy(error);
  return {
    message,
    retryable: message !== PAYOUT_COUNTRY_BANK_ALREADY_CONNECTED_COPY,
  };
}
