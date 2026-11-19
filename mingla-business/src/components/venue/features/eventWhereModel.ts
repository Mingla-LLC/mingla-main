/**
 * #4490 fix 2 (N84) — which "Where" choice an event or experience opens on
 * (pure; pinned by test).
 */
export type EventWhereMode = "venue" | "other";

/** Which choice opens first (pure; pinned by test). */
export function initialWhereMode(input: {
  hasVenues: boolean;
  linkedVenueId: string | null;
  intentVenueId: string | null;
  hasOtherAddress: boolean;
}): EventWhereMode {
  if (!input.hasVenues) return "other";
  if (input.linkedVenueId !== null || input.intentVenueId !== null) return "venue";
  return input.hasOtherAddress ? "other" : "venue";
}
