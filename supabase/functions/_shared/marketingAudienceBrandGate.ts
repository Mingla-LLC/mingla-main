/**
 * #3682 — Fail closed when a campaign targets an audience owned by another brand.
 *
 * A multi-brand host used to open "Harmattan Club — All buyers" from Lantern
 * Room's People → Groups and attach that audience_id to a Lantern Room draft.
 * marketing-send never checked audience.brand_id === campaign.brand_id, so a
 * send would blast another brand's buyers under this brand's From header.
 */

export const AUDIENCE_BRAND_MISMATCH = "audience_brand_mismatch";

export function assertAudienceMatchesCampaignBrand(
  audienceBrandId: string | null | undefined,
  campaignBrandId: string,
): void {
  if (
    typeof audienceBrandId !== "string" ||
    audienceBrandId.length === 0 ||
    audienceBrandId !== campaignBrandId
  ) {
    throw new Error(AUDIENCE_BRAND_MISMATCH);
  }
}
