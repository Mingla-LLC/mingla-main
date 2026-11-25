/**
 * #4490 fix 2 (N84) — which "Where" choice an event or experience opens on
 * (pure; pinned by test).
 */
import type { EventSpaceUse } from "../../../services/venueFeaturesService";
import { venueWriteErrorCopy } from "./venueFeaturesCopy";

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

/** #4490 fix 3 — a new pick takes its place unless the host says otherwise. */
export const DEFAULT_EVENT_SPACE_USE: EventSpaceUse = "exclusive";

/** The two choices' words, for the place picked ("The Lounge Side", a combination, or the whole venue). */
export function spaceUseChoices(
  noun: "event" | "experience",
  placeName: string | null,
): Array<{ value: EventSpaceUse; label: string; helper: string }> {
  const whole = placeName === null;
  const place = placeName ?? "any space here";
  return [
    {
      value: "exclusive",
      label: whole ? `This ${noun} takes the whole venue` : `This ${noun} takes the space`,
      helper: `No private hire, by-the-hour booking or block can use ${place} while it runs.`,
    },
    {
      value: "shared",
      label: whole ? "The venue stays open to others" : "The space stays open to others",
      helper: `Hires and bookings can still use ${whole ? "its spaces" : placeName} at the same time.`,
    },
  ];
}

/** #4490 fix 3 — the event-place refusals in plain words (the space is taken, one place only). */
export function eventVenueErrorCopy(
  code: string,
  detail: string | null,
  placeName: string | null,
  noun: "event" | "experience" = "event",
): string {
  if (code === "event_space_taken") {
    return `${placeName ?? "A space here"} is already hired or blocked while this ${noun} runs. Pick another space or time, or let it stay open to others.`;
  }
  if (code === "event_one_place") return "Pick one space or one combination, not both.";
  return venueWriteErrorCopy("event_venue", code, detail);
}
