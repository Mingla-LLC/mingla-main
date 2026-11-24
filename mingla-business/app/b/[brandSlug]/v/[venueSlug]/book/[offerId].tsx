// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
/**
 * /b/{brandSlug}/v/{venueSlug}/book/{offerId} — #4490 P2 entry checkout,
 * (P3, `?k=group…`) the group package checkout, and (P4, `?k=hire…`) the
 * private hire request, and (P6, `?k=plan`) joining a monthly plan (the id is
 * the plan's).
 *
 * ANON ROUTE under the `/b/` public prefix: buying never needs an account and
 * this chain never calls useAuth. The address carries the day and the counts
 * only (`?date=YYYY-MM-DD&q=<optionId>:<n>,…`), never a token or anything
 * personal. The screen itself is `OfferCheckout`.
 */
import React from "react";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LazyVenueOfferBookRoute } from "../../../../../../src/components/venue/guest/LazyVenueGuestScreens";
import type { VenueOfferBookParams } from "../../../../../../src/components/venue/guest/VenueOfferBookRouteScreen";

export default function VenueOfferCheckoutRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<VenueOfferBookParams>();
  return <LazyVenueOfferBookRoute params={params} safeTop={insets.top} safeBottom={insets.bottom} />;
}
