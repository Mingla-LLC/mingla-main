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

import { StationScreen } from "../../../../src/components/venue/station/StationScreen";
import { parseStationChoice } from "../../../../src/components/venue/station/stationModel";
import { tillUuid } from "../../../../src/components/venue/till/tillModel";

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default function VenueStationRoute(): React.ReactElement | null {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const venueId = tillUuid(params.venueId);
  if (venueId === null) return null;
  const station = parseStationChoice(first(params.station)) ?? "kitchen";
  return <StationScreen venueId={venueId} initialStation={station} startedOnLoad={first(params.started) === "1"} />;
}
