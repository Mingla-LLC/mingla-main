/**
 * #4490 — host copy for venue features, spaces and hours (plain words, verbs
 * plus objects, "Features" never "modules"). Server codes are mapped here so a
 * raw code never reaches a screen.
 */

import {
  VENUE_FEATURE_KEYS,
  joinFeatureLabels,
  type VenueFeatureKey,
} from "../../../types/venueFeatures";

export type VenueWriteContext = "feature" | "space" | "combination" | "hours" | "special_day" | "event_venue";

function keysFrom(detail: string | null): VenueFeatureKey[] {
  if (detail === null) return [];
  return detail
    .split(",")
    .map((k) => k.trim())
    .filter((k): k is VenueFeatureKey => (VENUE_FEATURE_KEYS as readonly string[]).includes(k));
}

/** Plain copy for a server refusal. `code`/`detail` come from VenueFeatureError. */
export function venueWriteErrorCopy(
  context: VenueWriteContext,
  code: string,
  detail: string | null = null,
): string {
  switch (code) {
    case "not_authorized":
    case "forbidden":
      if (context === "feature") return "Only brand owners and admins can switch features.";
      if (context === "hours") return "Only brand owners and admins can change opening hours.";
      if (context === "event_venue") return "You can't link this to a venue. Ask a brand owner or admin.";
      return "You don't have permission to change this venue. Ask a brand owner or admin.";
    case "feature_requires":
      if (detail === "space") return "Add a space first. This feature needs at least one space.";
      return `Turn on ${joinFeatureLabels(keysFrom(detail))} first.`;
    case "feature_has_dependents":
      return `Turn off ${joinFeatureLabels(keysFrom(detail))} first.`;
    case "table_deposit_uses_min_spend": {
      const count = Math.max(1, Number(detail) || 1);
      return `${count} ${count === 1 ? "table takes" : "tables take"} a share of the minimum spend as a deposit. Change ${count === 1 ? "its" : "their"} deposit first.`;
    }
    case "feature_not_available":
      return "This feature isn't available yet.";
    case "feature_managed":
      return "Stays are managed in your Stay workspace.";
    case "venue_not_orderable":
      return "Table ordering can be switched on once Mingla has approved this venue.";
    case "stale_write":
      return "Someone else changed this a moment ago. We've loaded the latest, so try again.";
    case "space_name_taken":
      return "You already have a space with that name. Pick another name.";
    case "space_invalid":
    case "space_payload_invalid":
      return "Check the space: it needs a name and at least one capacity from 1 to 100,000.";
    case "space_setting_invalid":
      return "Pick indoor, covered or outdoor.";
    case "space_in_use":
      return "This is your last space and a feature needs one. Switch that feature off first.";
    case "space_not_found":
      return "That space was removed. We've loaded the latest list.";
    case "combination_exists":
      return "Those spaces are already combined.";
    case "combination_parts_invalid":
    case "combination_payload_invalid":
      return "Pick at least two spaces to combine, and give the combination a name.";
    case "combination_not_found":
      return "That combination was removed. We've loaded the latest list.";
    case "special_day_invalid":
      return "Pick a date for the special day.";
    case "special_day_windows_invalid":
    case "hours_windows_invalid":
    case "hours_windows_overlap":
      return "Each window needs an open and a close time, and windows can't overlap.";
    case "hours_closed_day_has_windows":
      return "A closed day can't have opening times.";
    case "special_day_label_invalid":
      return "Keep the name to 60 characters.";
    case "event_space_not_in_venue":
      return "That space isn't part of this venue any more. Pick another space.";
    case "event_venue_brand_mismatch":
      return "Pick one of this brand's venues.";
    case "event_not_found":
      return "Save the event first, then pick where it happens.";
    case "venue_not_found":
      return "This venue was removed.";
    case "invalid_venue_category":
      return "Pick one of the venue types.";
    default:
      return "Couldn't save. Your changes are still here, so try again.";
  }
}

export const VENUE_FEATURES_COPY = {
  spacesTitle: "Spaces",
  spacesEmptyTitle: "Add your first space",
  spacesEmptyBody: "Start with the area guests walk into. Add the rest when you need them.",
  spacesStarters: ["Main floor", "Outdoor area", "Bar", "Private room", "Rooftop"] as const,
  addSpace: "Add a space",
  combineSpaces: "Combine spaces",
  combinedRow: "Combined · hiring it blocks both",
  loadSpacesError: "Couldn't load your spaces",
  loadError: "Check your connection and try again.",
  tryAgain: "Try again",
  saved: "Saved",
  arrangeTitle: "Arrange your spaces",
  arrangeBody: "Draw where each space sits, so staff and guests see the layout.",
  arrangeOnComputer: "Arrange your spaces on a wider screen, like a computer. Your list of spaces works the same here.",
} as const;

/**
 * #4490 N18/N57: the empty Spaces chips and the "What's here" placeholder
 * follow the venue's type, so a restaurant is not offered pool tables and a
 * coworking space is not offered a rooftop bar.
 */
const SPACE_STARTERS_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  restaurant: ["Main dining room", "Terrace", "Bar", "Private room"],
  bar_lounge: ["Main floor", "Bar", "VIP section", "Terrace"],
  club: ["Dance floor", "VIP section", "Bar", "Terrace"],
  play: ["Main floor", "Party room", "Outdoor area"],
  cafe: ["Main floor", "Meeting room", "Terrace"],
  coworking: ["Open desks", "Meeting room", "Boardroom", "Phone booth"],
  event_space: ["Main hall", "Garden", "Breakout room"],
  creative_and_arts: ["Studio", "Gallery", "Rehearsal room"],
};

const AMENITY_EXAMPLES_BY_TYPE: Readonly<Record<string, string>> = {
  restaurant: "Window seats, high chairs…",
  bar_lounge: "Sound system, booths…",
  club: "DJ booth, sound system…",
  play: "Pool tables, karaoke…",
  cafe: "Plugs, Wi-Fi…",
  coworking: "Screen, whiteboard, Wi-Fi…",
  event_space: "Stage, PA system, parking…",
  creative_and_arts: "Easels, lighting rig…",
};

export function spaceStartersFor(category: string | null | undefined): readonly string[] {
  return (category != null ? SPACE_STARTERS_BY_TYPE[category] : undefined) ?? VENUE_FEATURES_COPY.spacesStarters;
}

export function amenityExamplesFor(category: string | null | undefined): string {
  return (category != null ? AMENITY_EXAMPLES_BY_TYPE[category] : undefined) ?? "What guests will find here…";
}
