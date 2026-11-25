/**
 * #4490 P5 — whether a venue's table settings change the guest's table flow. A
 * leaf split from tablePickModel.ts (which re-exports it): the public venue
 * page decides this on its first paint, before any guest tab loads.
 */
/** The guest party can't be capped at 12 any more (C §3.4): the venue's own limit. */
export const DEFAULT_PARTY_MAX = 12;

/**
 * True when the venue's tables block changes the table flow (a cap other than
 * 12, pick a table, seating areas, big-party requests, the guest waitlist).
 * Otherwise the page passes nothing new and renders exactly as before.
 */
export function tablesBlockChangesFlow(
  t: {
    partyMax: number | null;
    pickATable: boolean | null;
    largePartyRequest: boolean | null;
    guestWaitlist: boolean | null;
    notifyMe?: boolean | null;
    seatingAreas?: ReadonlyArray<unknown>;
  } | null | undefined,
): boolean {
  if (t == null) return false;
  return (
    (t.partyMax !== null && t.partyMax !== DEFAULT_PARTY_MAX) ||
    t.pickATable === true ||
    t.largePartyRequest === true ||
    t.guestWaitlist === true ||
    t.notifyMe === true ||
    (t.seatingAreas?.length ?? 0) > 1
  );
}
