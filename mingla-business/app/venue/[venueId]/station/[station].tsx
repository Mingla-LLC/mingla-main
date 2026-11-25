// orch-strict-grep-allow safearea-on-fullscreen-routes — renders StationScreen, which pads its root with useSafeAreaInsets (top and bottom)
/**
 * #4490 spec 08 O3 — a kitchen or bar screen (`/venue/[venueId]/station/[station]`,
 * station = kitchen | bar | all). Full screen, outside the venue rail. On web
 * this route is its own chunk (expo-router async routes), so the station code
 * and its chime never ship in the eager bundle; callers only navigate here.
 *
 * `started=1` (set by Start service) keeps the board after a reload; the
 * browser then needs a tap for sound (spec 08 §11 T17). Opaque ids only.
 */
import React from "react";
import { useLocalSearchParams } from "expo-router";

import { LazyVenueStationRoute } from "../../../../src/components/venue/host/LazyVenueHostRoutes";

export default function VenueStationRoute(): React.ReactElement {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  return <LazyVenueStationRoute params={params} />;
}
