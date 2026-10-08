/**
 * #3682 — truthful "why you're getting this" line for marketing email footers.
 *
 * Reasons match how the person entered the brand book (Seth design / tutorial prep):
 * bought tickets, imported with permission, added by the host, or follows.
 */

export type MarketingReceiveReason =
  | "bought"
  | "imported"
  | "added"
  | "follows";

export function receiveReasonFooterSentence(
  reason: MarketingReceiveReason,
  brandName: string,
): string {
  switch (reason) {
    case "bought":
      return `You're receiving this because you bought tickets from ${brandName} on Mingla.`;
    case "imported":
      return `You're receiving this because ${brandName} imported your contact on Mingla with permission.`;
    case "added":
      return `You're receiving this because ${brandName} added you to their guest book on Mingla.`;
    case "follows":
      return `You're receiving this because you follow ${brandName} on Mingla.`;
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
    case "brand_circle_extended":
      return "follows";
    case "all_brand_people":
    case "manual_group":
    case "custom_segment":
    case "offering_send_group":
      return "added";
    default:
      return "bought";
  }
}
