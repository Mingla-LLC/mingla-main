/**
 * #3387 — specific guest copy for reservation refusals that are not the
 * guest's fault. Everything unmapped keeps the existing generic sentence
 * (see #2289 for the wider "one message for every failure" problem).
 *
 * `deposit_amount_unconfigured`: the venue asks large parties for a deposit
 * but never set an amount. The host panel no longer lets that be saved, and
 * warns about rules saved before; this is the guest's side of any that remain.
 */

export const DEPOSIT_UNCONFIGURED_COPY =
  "This venue asks for a deposit for a party this size but hasn't finished setting it up. Choose a smaller party or contact the venue.";

export function guestReservationFailureCopy(errorCode: string): string | null {
  if (errorCode === "deposit_amount_unconfigured") {
    return DEPOSIT_UNCONFIGURED_COPY;
  }
  return null;
}
