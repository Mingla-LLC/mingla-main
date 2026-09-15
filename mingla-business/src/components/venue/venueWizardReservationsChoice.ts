/**
 * #3383 — carry the Add a venue "Take reservations on Mingla" switch into the
 * venue's reservation settings once the venue row exists.
 *
 * The switch lived only in the draft: the Review step said "Reservations on",
 * the create path never read it, and the claim path parked it as a provenance
 * note nothing reads. Every venue therefore arrived with reservations OFF.
 *
 * Pure orchestration with the writer injected, so the contract is testable
 * without a network:
 *   - switch OFF → no write (the table default is already off, and an explicit
 *     `false` would clobber nothing useful).
 *   - switch ON  → exactly one `enabled = true` write for THIS venue.
 *   - a failed write never throws: the venue is already submitted, so the
 *     host must still land on it; the venue page then truthfully offers
 *     "Turn on Reservations".
 */

export type SaveReservationsEnabled = (
  brandId: string | null,
  venueId: string | null,
  enabled: boolean,
) => Promise<void>;

export type WizardReservationsChoiceOutcome =
  | "not_requested"
  | "saved"
  | "save_failed";

export async function saveWizardReservationsChoice(
  input: { brandId: string; venueId: string; wantsReservations: boolean },
  save: SaveReservationsEnabled,
): Promise<WizardReservationsChoiceOutcome> {
  if (!input.wantsReservations) return "not_requested";
  try {
    await save(input.brandId, input.venueId, true);
    return "saved";
  } catch {
    return "save_failed";
  }
}
