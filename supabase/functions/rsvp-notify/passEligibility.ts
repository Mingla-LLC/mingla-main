/** Unlisted RSVP invite link — may an approved guest's RSVP pass still be sent?
 *
 * Pure, so the rule is testable without a database. The worker re-reads the
 * RSVP and its event just before sending and asks this.
 *
 * Public AND unlisted ("hidden") RSVPs qualify: an unlisted RSVP is open to
 * anyone holding its link, so an approved guest gets the same pass as on a
 * public RSVP. It used to require public, so every approved guest of an unlisted
 * RSVP had the pass parked as `rsvp_not_eligible`. Private stays excluded, as on
 * every public RSVP reader. Everything else is unchanged.
 */
export interface PassEventFacts {
  status?: string | null;
  visibility?: string | null;
  deleted_at?: string | null;
  event_type?: string | null;
}

export const RSVP_PASS_VISIBILITIES: readonly string[] = ["public", "hidden"];

export function rsvpPassEventEligible(
  event: PassEventFacts | null | undefined,
  brandDeletedAt: string | null | undefined,
): boolean {
  return !!event &&
    event.deleted_at === null &&
    brandDeletedAt === null &&
    RSVP_PASS_VISIBILITIES.includes(String(event.visibility)) &&
    event.event_type === "rsvp" &&
    ["scheduled", "live"].includes(String(event.status));
}
