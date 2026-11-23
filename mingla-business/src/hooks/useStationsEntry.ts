/**
 * #4490 spec 08 O3 — show the "Kitchen and bar" entry only to someone the
 * server will let in (no dead taps): released (VENUE_TILL), the venue's
 * Kitchen and bar screens feature on, and kitchen rights here.
 */
import { stationsEntryVisible } from "../components/venue/station/stationRoute";
import { useMyVenueAccess } from "./useMyVenueAccess";
import { useTillReleased } from "./useTillReleased";
import { useVenueFeatures } from "./useVenueFeatures";

export function useStationsEntry(brandId: string | null, venueId: string | null): boolean {
  const released = useTillReleased();
  const features = useVenueFeatures(brandId, venueId);
  const access = useMyVenueAccess(venueId);
  return stationsEntryVisible({
    released,
    kitchenScreensOn: features.data?.features.kitchen_screens.enabled === true,
    canKitchen: access.data?.canKitchen === true,
  });
}
