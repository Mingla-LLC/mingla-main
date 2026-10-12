/**
 * #3645 — organiser-facing copy for a failed payout-country switch.
 *
 * Shared by the web bank-connect screen and the native onboarding screen so
 * both tell the organiser the same thing when the switch to (or away from)
 * the Nigerian payout rail fails. Deliberately provider-neutral: the service
 * error text carries internal function and provider names and is never shown.
 */

export const PAYOUT_COUNTRY_SWITCH_FAILED_COPY =
  "We couldn't update your payout country. Check your connection and try again.";

export const PAYOUT_COUNTRY_BANK_ALREADY_CONNECTED_COPY =
  "This brand already has a bank connected. Remove it in Payments before choosing a different country.";

/** Maps a select/clear payout-rail failure to copy the organiser can act on. */
export function payoutCountrySwitchErrorCopy(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (raw.includes("disconnect_first")) {
    return PAYOUT_COUNTRY_BANK_ALREADY_CONNECTED_COPY;
  }
  return PAYOUT_COUNTRY_SWITCH_FAILED_COPY;
}
