/**
 * #3387 — one platform-free owner for actionable guest reservation refusals.
 * Unmapped errors retain each caller's existing fallback and payment behavior.
 */
export const DEPOSIT_UNCONFIGURED_COPY =
  "This venue asks for a deposit for a party this size but hasn't finished setting it up. Choose a smaller party or contact the venue.";

/**
 * #3645 — the deposit (after any discount) is above zero but below the
 * smallest card payment the provider takes, so it can't be paid online.
 * The guest can't change the amount here, so the copy points to the venue.
 */
export const BELOW_PROVIDER_MINIMUM_COPY =
  "This deposit is too small to pay by card. Contact the venue to reserve. Nothing has been charged.";

export function guestReservationFailureCopy(errorCode: string): string | null {
  if (errorCode === "deposit_amount_unconfigured") {
    return DEPOSIT_UNCONFIGURED_COPY;
  }
  if (errorCode === "amount_too_large") {
    return "This table's deposit is above what one payment can take. Ask the venue.";
  }
  if (errorCode === "reservation_below_provider_minimum") {
    return BELOW_PROVIDER_MINIMUM_COPY;
  }
  return null;
}
