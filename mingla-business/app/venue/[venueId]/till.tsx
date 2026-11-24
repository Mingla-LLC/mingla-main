// orch-strict-grep-allow safearea-on-fullscreen-routes — renders TillGate → TillScreen / WhoIsSelling, which pad their roots with useSafeAreaInsets (top and bottom)
/**
 * #4490 spec 08 O1 — the Till route (`/venue/[venueId]/till`). Full screen,
 * outside the venue rail. On web this route is its own chunk (expo-router
 * async routes), so the Till never ships in the eager bundle; every caller
 * only navigates here.
 *
 * Optional params (opaque ids only, never personal data): `tab=entry`,
 * `offer`, `option`, `count`, `entry` (a guest-list name sold at the reduced
 * price, spec 07 §11 B3); `checks=1` opens on Open checks (the Orders
 * screen's "Open checks", where tabs opened before the Till also appear).
 */

import React from "react";
import { useLocalSearchParams } from "expo-router";

import { LazyVenueTillRoute } from "../../../src/components/venue/host/LazyVenueHostRoutes";

export default function VenueTillRoute(): React.ReactElement {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  return <LazyVenueTillRoute params={params} />;
}
