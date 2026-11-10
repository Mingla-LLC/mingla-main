/**
 * #4334 — re-picking an address whose text equals the saved one still saves.
 *
 * Seth corrected live event pins with the Google picker: picking the
 * suggestion whose address text matched the saved address saved nothing. The
 * diffs compared the pin by its coordinates alone (and the brand diff never
 * compared the place id at all), so a re-pick that landed on the same
 * coordinates with a new Google place id or a new precision read as "no
 * change": Save stayed disabled (events) or silently no-oped (brands).
 *
 *   EV-*    published event: editableDraftToPatch + computeRichFieldDiffs
 *   RSVP-*  published RSVP: buildRsvpUpdatePayloadDiff sends the pin
 *   BR-*    brand edit: computeDirtyFieldsPatch carries the place id
 *
 * Fails-on-revert: restore the coordinate-only compare in liveEventAdapter.ts
 * (editableDraftToPatch / computeRichFieldDiffs) or serverDraftEventMapper.ts
 * (buildRsvpUpdatePayloadDiff), or drop the locationProviderPlaceId compare
 * from brandPatch.ts → red.
 */
import { describe, expect, test } from "@jest/globals";

import {
  computeRichFieldDiffs,
  editableDraftToPatch,
  liveEventToEditableDraft,
} from "../liveEventAdapter";
import { buildRsvpUpdatePayloadDiff } from "../serverDraftEventMapper";
import { computeDirtyFieldsPatch } from "../brandPatch";
import type { DraftEvent } from "../../store/draftEventStore";
import type { LiveEvent } from "../../store/liveEventStore";
import type { Brand } from "../../store/currentBrandStore";

const ADDRESS = "61 Wythe Avenue, Brooklyn, NY 11249, USA";
const PIN = { lat: 40.7222, lng: -73.9578 };
const GOOGLE_ID = "ChIJxQ9M1UpZwokRpOCXqDaFP2c";

const liveEvent = (patch: Partial<LiveEvent> = {}): LiveEvent =>
  ({
    id: "event-4334",
    serverEventId: "server-event-4334",
    brandId: "brand-1",
    brandSlug: "brand",
    eventSlug: "issue-4334-night",
    status: "scheduled",
    publishedAt: "2026-06-01T12:00:00.000Z",
    cancelledAt: null,
    endedAt: null,
    event_type: "event",
    name: "Issue 4334 night",
    description: "Doors at eight.",
    format: "in_person",
    category: null,
    whenMode: "single",
    date: "2026-07-01",
    doorsOpen: "20:00",
    endsAt: "23:00",
    timezone: "America/New_York",
    recurrenceRule: null,
    multiDates: null,
    venueName: "Lantern Room",
    address: ADDRESS,
    onlineUrl: null,
    hideAddressUntilTicket: false,
    coverHue: 25,
    coverMediaUrl: null,
    coverMediaPosterUrl: null,
    coverMediaType: null,
    coverMediaProvider: null,
    coverMediaSourceUrl: null,
    coverMediaCredit: null,
    coverMediaCreditUrl: null,
    coverMediaAlt: null,
    currency: "USD",
    tickets: [],
    visibility: "public",
    requireApproval: false,
    allowTransfers: true,
    hideRemainingCount: false,
    passwordProtected: false,
    privateGuestList: false,
    inPersonPaymentsEnabled: false,
    orders: [],
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    city: "Brooklyn",
    locationGeo: PIN,
    pricingSwitches: { passTax: null, passMinglaFee: null, passServiceFee: null },
    rsvpCapacity: null,
    rsvpAllowPlusOnes: false,
    rsvpPlusOnesMax: 0,
    rsvpWaitlistEnabled: false,
    rsvpApprovalMode: "auto",
    rsvpDiscoverable: false,
    rsvpContributionEnabled: false,
    rsvpContributionSuggestedCents: null,
    rsvpContributionMinCents: null,
    createdAt: "2026-06-01T11:00:00.000Z",
    updatedAt: "2026-06-01T12:00:00.000Z",
    ...patch,
  }) as LiveEvent;

/** What CreatorStep3Where's onPick writes for a Google suggestion. */
const repick = (
  draft: DraftEvent,
  pick: Partial<DraftEvent> = {},
): DraftEvent => ({
  ...draft,
  address: ADDRESS,
  city: "Brooklyn",
  locationGeo: { ...PIN },
  locationProviderPlaceId: GOOGLE_ID,
  coordinatePrecision: "exact",
  ...pick,
});

describe("EV — published event: a same-text re-pick is a change", () => {
  test("EV-0 an untouched editor still diffs to nothing", () => {
    const original = liveEvent();
    const edited = liveEventToEditableDraft(original);
    expect(editableDraftToPatch(original, edited)).toEqual({});
    expect(computeRichFieldDiffs(original, edited)).toEqual([]);
  });

  test("EV-1 same text, same coordinates, new place id → the pin is in the patch", () => {
    const original = liveEvent();
    const edited = repick(liveEventToEditableDraft(original));
    const patch = editableDraftToPatch(original, edited);
    expect(patch.locationGeo).toEqual(PIN);
    // Text and city are unchanged, so they stay out (no material "address"
    // change is invented — the guest email follows the text, as before).
    expect(patch.address).toBeUndefined();
    expect(patch.city).toBeUndefined();
    const rows = computeRichFieldDiffs(original, edited);
    expect(rows.map((r) => r.fieldKey)).toEqual(["locationGeo"]);
    expect(rows[0].summary).toBe("Updated");
  });

  test("EV-2 same coordinates and place id, approximate → exact is a change", () => {
    const original = liveEvent({
      locationProviderPlaceId: GOOGLE_ID,
      coordinatePrecision: "approximate",
    });
    const edited = repick(liveEventToEditableDraft(original));
    expect(editableDraftToPatch(original, edited).locationGeo).toEqual(PIN);
  });

  test("EV-3 a re-pick of the exact saved place (id + precision known) is no change", () => {
    const original = liveEvent({
      locationProviderPlaceId: GOOGLE_ID,
      coordinatePrecision: "exact",
    });
    const edited = repick(liveEventToEditableDraft(original));
    expect(editableDraftToPatch(original, edited)).toEqual({});
    expect(computeRichFieldDiffs(original, edited)).toEqual([]);
  });

  test("EV-4 a moved pin is still a change, summarised as Moved", () => {
    const original = liveEvent();
    const edited = repick(liveEventToEditableDraft(original), {
      locationGeo: { lat: 40.7, lng: -73.9 },
    });
    expect(editableDraftToPatch(original, edited).locationGeo).toEqual({
      lat: 40.7,
      lng: -73.9,
    });
    expect(computeRichFieldDiffs(original, edited)[0].summary).toBe("Moved");
  });
});

describe("RSVP — published RSVP: a same-text re-pick sends the pin", () => {
  test("RSVP-1 same coordinates, new place id → location_geo + place id sent", () => {
    const original = liveEvent({ event_type: "rsvp" });
    const edited = repick(liveEventToEditableDraft(original));
    const payload = buildRsvpUpdatePayloadDiff(original, edited);
    expect(payload.location_geo).toBe(`(${PIN.lng},${PIN.lat})`);
    expect(payload.location_provider_place_id).toBe(GOOGLE_ID);
    expect(payload.coordinate_precision).toBe("exact");
  });

  test("RSVP-2 an untouched pin sends no location_geo", () => {
    const original = liveEvent({ event_type: "rsvp" });
    const payload = buildRsvpUpdatePayloadDiff(
      original,
      liveEventToEditableDraft(original),
    );
    expect("location_geo" in payload).toBe(false);
  });
});

describe("BR — brand edit: a same-text re-pick carries the place id", () => {
  const brand = (patch: Partial<Brand> = {}): Brand =>
    ({
      id: "brand-4334",
      displayName: "Brand 4334",
      slug: "brand-4334",
      address: ADDRESS,
      lat: PIN.lat,
      lng: PIN.lng,
      city: "Brooklyn",
      countryCode: "US",
      locationProviderPlaceId: null,
      coverHue: 25,
      role: "owner",
      stats: { events: 0, rev: 0, rev7d: 0, attendees: 0 },
      currentLiveEvent: null,
      ...patch,
    }) as Brand;

  test("BR-1 same text and coordinates, new place id → patch has the id", () => {
    expect(
      computeDirtyFieldsPatch(
        brand({ locationProviderPlaceId: GOOGLE_ID }),
        brand(),
      ),
    ).toEqual({ locationProviderPlaceId: GOOGLE_ID });
  });

  test("BR-2 undefined and null place ids are the same (no phantom diff)", () => {
    expect(
      computeDirtyFieldsPatch(
        brand({ locationProviderPlaceId: undefined }),
        brand({ locationProviderPlaceId: null }),
      ),
    ).toEqual({});
  });
});
