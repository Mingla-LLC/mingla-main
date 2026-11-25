// orch-strict-grep-allow safearea-on-fullscreen-routes — renders VenueOfferEditorRouteScreen (Host venue owner), which pads its root with useSafeAreaInsets (top)
/**
 * /venue/[venueId]/offer/[offerId] (#4490 P2-4) — the offer editor as a
 * pushed screen on the native apps (`new` = a new Entry offer). On web the
 * Offers module opens the same editor in place, so this route is the phone
 * app's path and a deep link. Leaving with unsaved changes asks first.
 */
import React from "react";
import { useLocalSearchParams } from "expo-router";

import { LazyVenueOfferEditorRoute } from "../../../../src/components/venue/host/LazyVenueHostRoutes";

export default function VenueOfferEditorRoute(): React.ReactElement {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  return <LazyVenueOfferEditorRoute params={params} />;
}
