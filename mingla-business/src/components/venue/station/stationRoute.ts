/**
 * #4490 spec 08 O3 — where the kitchen and bar screen lives. Entry points (the
 * Orders queue, the Till) only navigate here; the screen is its own route chunk.
 */
import type { StationChoice } from "./stationModel";

export function stationHref(venueId: string, station: StationChoice = "kitchen"): string {
  return `/venue/${venueId}/station/${station}`;
}

/**
 * Who sees the "Kitchen and bar" entry, by the server's rule
 * (issue_4490_stations_enabled + issue_4490_can_kitchen): the release switch
 * is on, the venue's Kitchen and bar screens feature is on, and the person may
 * work the kitchen here. The server checks all three again.
 */
export function stationsEntryVisible(input: {
  released: boolean;
  kitchenScreensOn: boolean;
  canKitchen: boolean;
}): boolean {
  return input.released && input.kitchenScreensOn && input.canKitchen;
}

/** The launcher a kitchen-only login lands on inside the workspace. */
export const STATIONS_LAUNCHER_COPY = {
  title: "Kitchen and bar",
  body: "Open this venue's kitchen or bar screen. New orders ring and flash there.",
  open: "Open the kitchen screen",
} as const;
