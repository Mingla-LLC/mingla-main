// orch-strict-grep-allow safearea-on-fullscreen-routes — renders DayCloseGate → DayCloseScreen / WhoIsSelling, which pad their roots with useSafeAreaInsets (top and bottom)
/**
 * #4490 spec 08 O5 part B — Close the day (`/venue/[venueId]/close`). Full
 * screen, outside the venue rail. On web this route is its own chunk
 * (expo-router async routes), so the close never ships in the eager bundle;
 * every caller only navigates here. Opaque ids only in the address.
 */

import React from "react";
import { useLocalSearchParams } from "expo-router";

import { LazyVenueDayCloseRoute } from "../../../src/components/venue/host/LazyVenueHostRoutes";

export default function VenueDayCloseRoute(): React.ReactElement {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  return <LazyVenueDayCloseRoute params={params} />;
}
