/**
 * ORCH-1150 — pure Hub RSVP metric formatting (no RN import).
 *
 * The Hub event list-card + manage-sheet render "N going" for an RSVP event
 * instead of revenue/tickets-sold (Step 11). Extracted so the label + count
 * math are unit-testable without the react-native render chain. See SPEC §8 step 11.
 */

/**
 * ORCH-1150 Step 12 — the RSVP edit-published "they'll be notified" notice copy.
 * Pure so it's testable without the RN render. SPEC §12.
 */
export const rsvpEditNoticeCopy = (goingCount: number): string =>
  goingCount > 0
    ? `${goingCount} ${goingCount === 1 ? "guest is" : "guests are"} going — they'll be notified if you change the date, time, or place.`
    : "Guests who RSVP will be notified if you change the date, time, or place.";

/** Sum each going+approved guest plus their plus_count (the §4.1c cap formula). */
export const sumRsvpGoingCount = (
  rows: ReadonlyArray<{ plus_count: number | null }>,
): number => rows.reduce((acc, r) => acc + 1 + (r.plus_count ?? 0), 0);

/**
 * The Hub "N going" subtext. Draft → "Not published" (nobody can RSVP yet).
 * A finite capacity shows "N / cap going"; unlimited shows "N going".
 */
export const formatRsvpGoingLabel = (input: {
  kind: "draft" | "live" | "past";
  goingCount: number;
  capacity: number | null;
}): string => {
  if (input.kind === "draft") return "Not published";
  if (input.capacity !== null) {
    return `${input.goingCount} / ${input.capacity} going`;
  }
  return `${input.goingCount} going`;
};
