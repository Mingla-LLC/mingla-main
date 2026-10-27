import { supabase } from "./supabase";
import {
  mapPromotionOverview,
  promotionOverviewError,
  type PromotionListingKind,
  type PromotionOverview,
} from "./promotionOverview";

/**
 * #3872 round 2 — Blast › Overview for the whole brand (no listing) or one
 * listing. Brand members only; a permission failure raises.
 */
export async function fetchPromotionOverview(
  brandId: string,
  listing?: { kind: PromotionListingKind; id: string } | null,
): Promise<PromotionOverview> {
  const { data, error } = await supabase.rpc("brand_promotion_overview", {
    p_brand_id: brandId,
    p_listing_kind: listing ? listing.kind : null,
    p_listing_id: listing ? listing.id : null,
  });
  if (error) throw error;
  const failure = promotionOverviewError(data);
  if (failure) throw new PromotionOverviewError(failure);
  return mapPromotionOverview(data);
}

/** A `{ok:false}` overview answer (listing_required, listing_not_found). */
export class PromotionOverviewError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "PromotionOverviewError";
    this.code = code;
  }
}
