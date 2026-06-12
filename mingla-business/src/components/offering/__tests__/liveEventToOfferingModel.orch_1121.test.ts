/**
 * ORCH-1121 [Business brand-profile redesign] — implementor happy-path test
 * for the new pure mapper `liveEventToOfferingModel`.
 *
 * T-10 (SPEC section 7): a LiveEvent + status 'past' maps to an
 * OfferingListCardModel with id, title, subline, cover fields, status 'past',
 * and metric/capacity/revenue all null (the brand-profile glance surface
 * mounts NO per-row orders hook).
 *
 * This is a REAL behavioral test (not a source assertion): the mapper imports
 * only pure utils + erased import-type-only references, so it runs in the
 * node/ts-jest harness. LiveEvent is supplied as a minimal structural object
 * (the store itself pulls AsyncStorage, so the runtime store is not imported).
 */

import { describe, expect, test } from "@jest/globals";

import { liveEventToOfferingModel } from "../offeringCardModels";
import type { OfferingCardStatus } from "../offeringListCardModel";
import type { LiveEvent } from "../../../store/liveEventStore";

// Minimal LiveEvent fixture — only the fields the mapper + formatDraftDateLine
// read. `whenMode: "single"` + a concrete `date` produce a deterministic
// date line; the rest are filled to satisfy the EventDateLike shape.
function makeLiveEvent(overrides: Partial<LiveEvent> = {}): LiveEvent {
  return {
    id: "le_evt1",
    name: "Rooftop Social",
    status: "ended",
    event_type: "event",
    whenMode: "single",
    date: "2026-05-01",
    doorsOpen: null,
    endsAt: null,
    timezone: "America/New_York",
    recurrenceRule: null,
    multiDates: null,
    venueName: "The Atrium",
    coverMediaUrl: "https://cdn.example/cover.jpg",
    coverMediaType: "image",
    coverHue: 210,
    ...overrides,
  } as unknown as LiveEvent;
}

describe("ORCH-1121 — liveEventToOfferingModel (T-10)", () => {
  test("maps id/title/status + null metric/capacity/revenue", () => {
    const model = liveEventToOfferingModel(makeLiveEvent(), "past");
    expect(model.id).toBe("le_evt1");
    expect(model.title).toBe("Rooftop Social");
    const expectedStatus: OfferingCardStatus = "past";
    expect(model.status).toBe(expectedStatus);
    // The glance surface mounts NO orders hook → these are always null.
    expect(model.metricLabel).toBeNull();
    expect(model.capacityPct).toBeNull();
    expect(model.revenueLabel).toBeNull();
  });

  test("carries cover media url/type/hue through unchanged", () => {
    const model = liveEventToOfferingModel(makeLiveEvent(), "past");
    expect(model.coverMediaUrl).toBe("https://cdn.example/cover.jpg");
    expect(model.coverMediaType).toBe("image");
    expect(model.coverHue).toBe(210);
  });

  test("subline is date · venue when a venue name is present", () => {
    const model = liveEventToOfferingModel(makeLiveEvent(), "past");
    // formatDraftDateLine produces the date portion; the mapper appends venue.
    expect(model.subline).toContain(" · The Atrium");
    expect(model.subline.startsWith(" · ")).toBe(false);
  });

  test("subline is the date line only when venue is null/empty", () => {
    const noVenue = liveEventToOfferingModel(
      makeLiveEvent({ venueName: null }),
      "upcoming",
    );
    expect(noVenue.subline).not.toContain(" · ");
    const emptyVenue = liveEventToOfferingModel(
      makeLiveEvent({ venueName: "" }),
      "upcoming",
    );
    expect(emptyVenue.subline).not.toContain(" · ");
  });

  test("normalizes an unknown cover media type to null (no fabrication)", () => {
    const model = liveEventToOfferingModel(
      makeLiveEvent({
        coverMediaType: "weird" as unknown as LiveEvent["coverMediaType"],
      }),
      "live",
    );
    expect(model.coverMediaType).toBeNull();
  });
});
