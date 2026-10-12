/**
 * issue #3237 — when a trip or experience may offer its public links.
 *
 * Share, "Public page" and "View public page" all open the buyer's page. The
 * public reads leave drafts out, so on a draft every one of those opened
 * "not found". A draft has nothing to open yet; neither does an item whose
 * brand has no public address.
 *
 * One owner for the rule, shared by the trip manage screen, the experience
 * manage screen and the Hub experiences menu. Published items are unaffected.
 */

export interface OfferingPublicLinkInput {
  status: string | null | undefined;
  brandSlug: string | null | undefined;
}

export const canOfferPublicLinks = ({
  status,
  brandSlug,
}: OfferingPublicLinkInput): boolean =>
  status !== "draft" &&
  typeof status === "string" &&
  typeof brandSlug === "string" &&
  brandSlug.length > 0;
