/**
 * #3682 — truthful "why you're getting this" line for marketing email footers.
 *
 * Reasons match how the person entered the brand book (Seth design / tutorial prep):
 * bought tickets, RSVP'd, reserved, imported with permission, added by the host,
 * follows, or is a friend of a follower.
 */

export type MarketingReceiveReason =
  | "bought"
  | "rsvp"
  | "booking"
  | "imported"
  | "added"
  | "follows"
  | "friend_of_follower"
  | "guest_book";

export function receiveReasonFooterSentence(
  reason: MarketingReceiveReason,
  brandName: string,
): string {
  switch (reason) {
    case "bought":
      return `You're receiving this because you bought tickets from ${brandName} on Mingla.`;
    case "rsvp":
      return `You're receiving this because you RSVP'd to an event from ${brandName} on Mingla.`;
    case "booking":
      return `You're receiving this because you made a reservation with ${brandName} on Mingla.`;
    case "imported":
      return `You're receiving this because ${brandName} imported your contact on Mingla with permission.`;
    case "added":
      return `You're receiving this because ${brandName} added you to their guest book on Mingla.`;
    case "follows":
      return `You're receiving this because you follow ${brandName} on Mingla.`;
    case "friend_of_follower":
      return `You're receiving this because a friend follows ${brandName} on Mingla.`;
    case "guest_book":
      return `You're receiving this because you're on ${brandName}'s guest list on Mingla.`;
  }
}

/** Map audience query kind to a default reason when per-contact provenance is absent. */
export function receiveReasonFromAudienceKind(
  kind: string | undefined,
): MarketingReceiveReason {
  switch (kind) {
    case "brand_buyers":
    case "event_buyers":
      return "bought";
    case "brand_followers":
      return "follows";
    case "brand_circle_extended":
      return "friend_of_follower";
    case "all_brand_people":
    case "manual_group":
    case "custom_segment":
    case "offering_send_group":
      // Mixed book audiences: never claim every recipient bought or follows.
      return "guest_book";
    default:
      return "bought";
  }
}
