// orch-strict-grep-allow safearea-on-fullscreen-routes — renders TillSettingsScreen, which pads its root with useSafeAreaInsets (top and bottom)
/**
 * #4490 spec 08 O5 part B — Settings › Selling in person
 * (`/venue/[venueId]/till-settings`). Full screen; its own route chunk on web,
 * so the screen never ships in the eager bundle. Opaque ids only.
 */

import React from "react";
import { useLocalSearchParams } from "expo-router";

import { TillSettingsScreen } from "../../../src/components/venue/till/TillSettingsScreen";
import { tillUuid } from "../../../src/components/venue/till/tillModel";

export default function VenueTillSettingsRoute(): React.ReactElement | null {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const venueId = tillUuid(params.venueId);
  if (venueId === null) return null;
  return <TillSettingsScreen venueId={venueId} />;
}
