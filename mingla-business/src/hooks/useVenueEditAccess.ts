/**
 * #4490 — who may change what at a venue (mirrors the server rules so the UI
 * never offers an action that will be refused):
 *  - spaces, special days, offers: brand rank >= event_manager, or scoped staff
 *    holding venue.manage_offers (issue_4490_can_manage_venue);
 *  - feature switches and the venue type preset: brand rank >= brand_admin
 *    (reconciliation conflict 7);
 *  - weekly opening hours: brand rank >= brand_admin (biz_upsert_brand_hours).
 */
import { useCurrentBrandRole } from "./useCurrentBrandRole";
import { useMyVenueAccess } from "./useMyVenueAccess";
import { BRAND_ROLE_RANK } from "../utils/brandRole";

export interface VenueEditAccess {
  resolved: boolean;
  canEditSpaces: boolean;
  canSwitchFeatures: boolean;
  canEditWeeklyHours: boolean;
}

export function useVenueEditAccess(brandId: string | null, venueId: string | null): VenueEditAccess {
  const { rank } = useCurrentBrandRole(brandId);
  const access = useMyVenueAccess(venueId);
  const scopedOffers =
    access.data?.scoped === true && access.data.capabilities.includes("venue.manage_offers");
  return {
    resolved: access.isFetched,
    canEditSpaces: rank >= BRAND_ROLE_RANK.event_manager || scopedOffers,
    canSwitchFeatures: rank >= BRAND_ROLE_RANK.brand_admin,
    canEditWeeklyHours: rank >= BRAND_ROLE_RANK.brand_admin,
  };
}
