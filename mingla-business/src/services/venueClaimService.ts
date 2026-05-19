/**
 * Ve3 — fetch venue claim status for mingla-business operators.
 */

import { supabase } from "./supabase";
import type { VenueClaimStatusRow } from "./venueClaimBannerLogic";

export type {
  VenueClaimBannerVariant,
  VenueClaimStatusRow,
} from "./venueClaimBannerLogic";
export {
  venueClaimBannerCopy,
  venueClaimBannerVariant,
} from "./venueClaimBannerLogic";

export async function fetchVenueClaimStatus(
  brandId: string,
): Promise<VenueClaimStatusRow | null> {
  const { data, error } = await supabase
    .from("brands")
    .select("kind, claim_status, rejection_reason, claim_follow_up_at")
    .eq("id", brandId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error !== null) throw error;
  if (data === null) return null;
  return data as VenueClaimStatusRow;
}
