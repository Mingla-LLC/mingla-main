// orch-strict-grep-allow safearea-on-fullscreen-routes — renders DayCloseGate → DayCloseScreen / WhoIsSelling, which pad their roots with useSafeAreaInsets (top and bottom)
/**
 * #4490 spec 08 O5 part B — Close the day (`/venue/[venueId]/close`). Full
 * screen, outside the venue rail. On web this route is its own chunk
 * (expo-router async routes), so the close never ships in the eager bundle;
 * every caller only navigates here. Opaque ids only in the address.
 */

import React from "react";
import { useLocalSearchParams } from "expo-router";

import { DayCloseGate } from "../../../src/components/venue/close/DayCloseGate";
import { tillUuid } from "../../../src/components/venue/till/tillModel";

export default function VenueDayCloseRoute(): React.ReactElement | null {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const venueId = tillUuid(params.venueId);
  if (venueId === null) return null;
  // #4490 O5: a Till device login switches someone in first (DayCloseGate).
  return <DayCloseGate venueId={venueId} />;
}
