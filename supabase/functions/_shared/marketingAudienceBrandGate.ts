/**
 * #3682 — Fail closed when a campaign targets an audience owned by another brand
 * or whose query_definition resolves recipients for another brand.
 *
 * A multi-brand host used to open "Harmattan Club — All buyers" from Lantern
 * Room's People → Groups and attach that audience_id to a Lantern Room draft.
 * marketing-send never checked audience.brand_id === campaign.brand_id, so a
 * send would blast another brand's buyers under this brand's From header.
 *
 * Owner-column matching alone is not enough: resolveAudience uses
 * query_definition.brand_id (brand_buyers / followers / …) and
 * query_definition.event_id → events.brand_id (event_buyers). A forged or
 * legacy row with brand_id = A but a B target must also fail closed.
 */

export const AUDIENCE_BRAND_MISMATCH = "audience_brand_mismatch";

export type AudienceQueryBrandTarget = {
  kind?: string;
  brand_id?: string;
  event_id?: string;
};

/** Owner column only — sync, used by unit tests and as the first send check. */
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

/**
 * Effective recipient target must belong to the campaign brand.
 * Call after the audience row is loaded (brand_id + query_definition).
 */
export async function assertAudienceQueryMatchesCampaignBrand(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  queryDefinition: AudienceQueryBrandTarget | null | undefined,
  campaignBrandId: string,
): Promise<void> {
  if (queryDefinition === null || typeof queryDefinition !== "object") {
    throw new Error(AUDIENCE_BRAND_MISMATCH);
  }

  const kind = typeof queryDefinition.kind === "string"
    ? queryDefinition.kind
    : "";
  const queryBrandId = typeof queryDefinition.brand_id === "string"
    ? queryDefinition.brand_id
    : null;
  const eventId = typeof queryDefinition.event_id === "string"
    ? queryDefinition.event_id
    : null;

  // Any explicit brand_id in the query must match the campaign brand.
  if (queryBrandId !== null && queryBrandId !== campaignBrandId) {
    throw new Error(AUDIENCE_BRAND_MISMATCH);
  }

  // Kinds whose resolver keys off query.brand_id require a matching brand_id.
  if (
    kind === "brand_buyers" ||
    kind === "brand_followers" ||
    kind === "brand_circle_extended" ||
    kind === "all_brand_people"
  ) {
    if (queryBrandId === null || queryBrandId !== campaignBrandId) {
      throw new Error(AUDIENCE_BRAND_MISMATCH);
    }
    return;
  }

  // event_buyers: live events.brand_id must match (not a stale owner column).
  if (kind === "event_buyers" || eventId !== null) {
    if (eventId === null || eventId.length === 0) {
      throw new Error(AUDIENCE_BRAND_MISMATCH);
    }
    const { data, error } = await supabase
      .from("events")
      .select("id, brand_id")
      .eq("id", eventId)
      .maybeSingle();
    if (error) throw new Error(`event_brand_load:${error.message}`);
    const eventBrandId =
      data !== null && typeof (data as { brand_id?: unknown }).brand_id === "string"
        ? (data as { brand_id: string }).brand_id
        : null;
    if (eventBrandId === null || eventBrandId !== campaignBrandId) {
      throw new Error(AUDIENCE_BRAND_MISMATCH);
    }
  }
}
