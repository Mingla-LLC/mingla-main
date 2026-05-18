/**
 * ORCH-0864 [Marketing Composer V2] Stage C — pure state-machine module
 * for InsertionBar. Lives separately from InsertionBar.tsx so jest can
 * test the state logic without loading react-native (which is ESM and
 * incompatible with the project's ts-jest node testEnvironment).
 */

import type { PersonalizationToken } from "../../../services/marketing/tenTapTokenBridge";

export type InsertionBarState =
  | "closed"
  | "events-open"
  | "personalize-open"
  | "overflow-open";

/**
 * Pure state-machine transition (SPEC §4.8). Only one panel open at a
 * time — tapping the same pill again closes the panel.
 */
export function computeNextInsertionBarState(
  current: InsertionBarState,
  toggled: Exclude<InsertionBarState, "closed">,
): InsertionBarState {
  return current === toggled ? "closed" : toggled;
}

// ─── Catalogues ────────────────────────────────────────────────────────────

export interface PersonalizationOption {
  token: PersonalizationToken;
  label: string;
  hint: string;
}

export const PERSONALIZATION_OPTIONS: readonly PersonalizationOption[] = [
  { token: "first_name", label: "first_name", hint: "Recipient's first name" },
  { token: "brand_name", label: "brand_name", hint: "Your brand name" },
  { token: "event_name", label: "event_name", hint: "Embedded event title" },
  { token: "event_date", label: "event_date", hint: "Embedded event date" },
  { token: "event_time", label: "event_time", hint: "Embedded event start time" },
  { token: "doors_open", label: "doors_open", hint: "Doors-open time" },
  { token: "event_url", label: "event_url", hint: "Link to the event page" },
  { token: "spots_left", label: "spots_left", hint: "Remaining ticket count" },
  { token: "previous_event_name", label: "previous_event_name", hint: "Last event name" },
  { token: "next_event_name", label: "next_event_name", hint: "Next event name" },
  { token: "event_id", label: "event_id", hint: "Event UUID (advanced)" },
] as const;

export const PERSONALIZATION_TOKEN_COUNT = PERSONALIZATION_OPTIONS.length;

export interface OverflowItem {
  id: "link" | "divider" | "image" | "template";
  label: string;
  hint: string;
}

export const OVERFLOW_ITEMS: readonly OverflowItem[] = [
  { id: "template", label: "From template…", hint: "Insert a saved template" },
  { id: "link", label: "Link", hint: "Insert a hyperlink" },
  { id: "image", label: "Image", hint: "Insert an image" },
  { id: "divider", label: "Divider", hint: "Insert a horizontal divider" },
] as const;

export const OVERFLOW_ITEM_IDS: ReadonlyArray<OverflowItem["id"]> =
  OVERFLOW_ITEMS.map((item) => item.id);
