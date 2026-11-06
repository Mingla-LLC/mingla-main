/**
 * issue #3281 — the edit screen's ticket sheet knows the event's pricing mode,
 * so its capacity and price hints show there too; not knowing it hides them.
 */
import { expect, test } from "@jest/globals";

import type { LiveEvent } from "../../store/liveEventStore";
import { liveEventToEditableDraft, withLivePricingMode } from "../liveEventAdapter";
import { capacityHelper } from "../ticketDayScopeCopy";

const live = (mode: LiveEvent["multiDatePricingMode"]): LiveEvent =>
  ({
    id: "event-1",
    brandId: "brand-1",
    eventSlug: "event-1",
    name: "Weekend",
    tickets: [],
    multiDates: [],
    ...(mode !== undefined ? { multiDatePricingMode: mode } : {}),
  }) as unknown as LiveEvent;

test("#3281 the edit draft carries the live event's pricing mode", () => {
  expect(liveEventToEditableDraft(live("all_days")).multiDatePricingMode).toBe("all_days");
  expect(liveEventToEditableDraft(live("per_day")).multiDatePricingMode).toBe("per_day");
  expect(liveEventToEditableDraft(live(undefined)).multiDatePricingMode).toBeUndefined();
});

test("#3281 with the mode known, an All dates ticket's capacity hint shows", () => {
  const mode = liveEventToEditableDraft(live("all_days")).multiDatePricingMode;
  expect(capacityHelper(null, [], 100, mode)).toBe(
    "Shared across all dates. Each guest uses 1, however many days they pick.",
  );
  expect(capacityHelper(null, [], 100, undefined)).toBeNull();
});

test("#3281 an editor opened from the publish cache takes the mode when the fresh read lands, keeping its edits", () => {
  // Opened from the publish cache: no mode yet, and the host has typed a name.
  const opened = { ...liveEventToEditableDraft(live(undefined)), name: "Edited name" };
  expect(opened.multiDatePricingMode).toBeUndefined();
  // The by-id read lands with the same updatedAt, carrying the mode.
  const hydrated = withLivePricingMode(opened, "per_day");
  expect(hydrated.multiDatePricingMode).toBe("per_day");
  expect(hydrated.name).toBe("Edited name");
  // Nothing to fill in leaves the draft as it was.
  expect(withLivePricingMode(hydrated, "per_day")).toBe(hydrated);
  expect(withLivePricingMode(hydrated, undefined)).toBe(hydrated);
});
