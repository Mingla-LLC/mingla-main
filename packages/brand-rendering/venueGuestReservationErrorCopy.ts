/**
 * #3387 — one platform-free owner for actionable guest reservation refusals.
 * Unmapped errors retain each caller's existing fallback and payment behavior.
 */
export const DEPOSIT_UNCONFIGURED_COPY =
  "This venue asks for a deposit for a party this size but hasn't finished setting it up. Choose a smaller party or contact the venue.";

export function guestReservationFailureCopy(errorCode: string): string | null {
  if (errorCode === "deposit_amount_unconfigured") {
    return DEPOSIT_UNCONFIGURED_COPY;
  }
  return null;
}
