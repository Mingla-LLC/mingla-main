// orch-strict-grep-allow safearea-on-fullscreen-routes — renders TillSettingsScreen, which pads its root with useSafeAreaInsets (top and bottom)
/**
 * #4490 spec 08 O5 part B — Settings › Selling in person
 * (`/venue/[venueId]/till-settings`). Full screen; its own route chunk on web,
 * so the screen never ships in the eager bundle. Opaque ids only.
 */

import React from "react";
import { useLocalSearchParams } from "expo-router";

import { LazyVenueTillSettingsRoute } from "../../../src/components/venue/host/LazyVenueHostRoutes";

export default function VenueTillSettingsRoute(): React.ReactElement {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  return <LazyVenueTillSettingsRoute params={params} />;
}
