/**
 * #4334 — tester adversarial: the same-address re-pick, attacked from the
 * angles the implementor's happy path does not cover.
 *
 *   T-1 phantom-diff guards: a loaded place id that is blank or padded with
 *       spaces, and a precision of `undefined` vs `null`, never invent a
 *       change on an untouched editor — while a genuinely new place id at the
 *       same coordinates still does.
 *   T-2 a typed ("approximate") address that resolves onto the saved
 *       coordinates with NO place id replaces a known exact place: the save
 *       sends the pin with a null id and "approximate", never keeps the old id.
 *   T-3 Clear, then re-pick the same place: the cleared step is "Removed";
 *       re-picking the known saved place is back to no change; re-picking it
 *       with a fresh place id is "Updated", not "Moved".
 *   T-4 the summary, the event save and the RSVP save agree on every pin case
 *       (one rule, three callers).
 *   T-5 a pin-only re-pick is NOT a guest/buyer notice: the row is a safe
 *       "Map pin · Updated", the edit is additive, and no row is tagged
 *       NOTIFIES GUESTS. (Server side, biz_update_live_rsvp alerts guests on
 *       location_text only, and the edit-notice snapshot reads the address
 *       text, so a pin-only change emails nobody — this pins the client half.)
 *   T-6 brand: a typed address with no place id replacing a known id sends
 *       the clear (null), so a stale id never outlives its pin.
 *
 * Fails-on-revert: restore the coordinate-only compare in
 * liveEventAdapter.ts (editableDraftToPatch / computeRichFieldDiffs) or
 * serverDraftEventMapper.ts (buildRsvpUpdatePayloadDiff), or drop the
 * locationProviderPlaceId compare from brandPatch.ts → red.
 */
import { describe, expect, test } from "@jest/globals";

import {
  classifySeverity,
  computeRichFieldDiffs,
  editableDraftToPatch,
  liveEventToEditableDraft,
} from "../liveEventAdapter";
import { buildRsvpUpdatePayloadDiff } from "../serverDraftEventMapper";
import { computeDirtyFieldsPatch } from "../brandPatch";
import { changeSummaryNotice } from "../buyerNoticeCopy";
import type { DraftEvent } from "../../store/draftEventStore";
import type { LiveEvent } from "../../store/liveEventStore";
import type { Brand } from "../../store/currentBrandStore";

const ADDRESS = "14 Admiralty Way, Lekki Phase 1, Lagos, Nigeria";
const PIN = { lat: 6.4474, lng: 3.4723 };
const SAVED_ID = "ChIJsaved-lekki-0001";
const FRESH_ID = "ChIJfresh-lekki-0002";

const liveEvent = (patch: Partial<LiveEvent> = {}): LiveEvent =>
  ({
    id: "event-4334-t",
    serverEventId: "server-event-4334-t",
    brandId: "brand-t",
    brandSlug: "brand-t",
    eventSlug: "tester-night",
    status: "scheduled",
    publishedAt: "2026-06-01T12:00:00.000Z",
    cancelledAt: null,
    endedAt: null,
    event_type: "event",
    name: "Tester night",
    description: "Doors at nine.",
    format: "in_person",
    category: null,
    whenMode: "single",
    date: "2026-12-01",
    doorsOpen: "21:00",
    endsAt: "23:30",
    timezone: "Africa/Lagos",
    recurrenceRule: null,
    multiDates: null,
    venueName: "Rooftop",
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
    currency: "NGN",
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
    city: "Lagos",
    locationGeo: { ...PIN },
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

const edit = (original: LiveEvent, change: Partial<DraftEvent> = {}): DraftEvent => ({
  ...liveEventToEditableDraft(original),
  ...change,
});

/** One rule, three callers: does each one say the pin changed? */
const verdicts = (original: LiveEvent, edited: DraftEvent) => ({
  save: editableDraftToPatch(original, edited).locationGeo !== undefined,
  summary: computeRichFieldDiffs(original, edited).some(
    (row) => row.fieldKey === "locationGeo",
  ),
  rsvp: "location_geo" in buildRsvpUpdatePayloadDiff(
    { ...original, event_type: "rsvp" } as LiveEvent,
    edited,
  ),
});

describe("T-1 phantom-diff guards still hold beside a real re-pick", () => {
  test("blank / padded ids and undefined-vs-null precision are no change; a fresh id is", () => {
    // A read that carried a blank id, or the id with stray spaces.
    for (const savedId of ["", "   ", ` ${SAVED_ID} `]) {
      const original = liveEvent({
        locationProviderPlaceId: savedId,
        coordinatePrecision: undefined,
      });
      const untouched = edit(original);
      expect(editableDraftToPatch(original, untouched)).toEqual({});
      expect(computeRichFieldDiffs(original, untouched)).toEqual([]);
      expect(verdicts(original, untouched)).toEqual({
        save: false,
        summary: false,
        rsvp: false,
      });
    }
    // The padded saved id equals the clean pick of the same place.
    const padded = liveEvent({
      locationProviderPlaceId: ` ${SAVED_ID} `,
      coordinatePrecision: "exact",
    });
    expect(
      verdicts(padded, edit(padded, { locationProviderPlaceId: SAVED_ID })),
    ).toEqual({ save: false, summary: false, rsvp: false });

    // …but a fresh id at the same coordinates IS a change (fails on revert).
    const known = liveEvent({
      locationProviderPlaceId: SAVED_ID,
      coordinatePrecision: "exact",
    });
    expect(
      verdicts(known, edit(known, { locationProviderPlaceId: FRESH_ID })),
    ).toEqual({ save: true, summary: true, rsvp: true });
  });
});

describe("T-2 a typed approximate address onto the saved coordinates", () => {
  test("replaces a known exact place: sends the pin, null id, approximate", () => {
    const original = liveEvent({
      event_type: "rsvp",
      locationProviderPlaceId: SAVED_ID,
      coordinatePrecision: "exact",
    });
    // What CreatorStep3Where's free-text resolve writes when the geocoder
    // lands on the same point but returns no place id.
    const edited = edit(original, {
      locationGeo: { ...PIN },
      locationProviderPlaceId: null,
      coordinatePrecision: "approximate",
    });
    const payload = buildRsvpUpdatePayloadDiff(original, edited);
    expect(payload.location_geo).toBe(`(${PIN.lng},${PIN.lat})`);
    expect(payload.location_provider_place_id).toBeNull();
    expect(payload.coordinate_precision).toBe("approximate");
    expect(editableDraftToPatch(original, edited).locationGeo).toEqual(PIN);
  });
});

describe("T-3 Clear, then re-pick the same place", () => {
  test("cleared is Removed; the known place again is no change; a fresh id is Updated", () => {
    const original = liveEvent({
      locationProviderPlaceId: SAVED_ID,
      coordinatePrecision: "exact",
    });
    const cleared = edit(original, {
      address: "",
      city: null,
      locationGeo: null,
      locationProviderPlaceId: null,
      coordinatePrecision: null,
    });
    const clearedRow = computeRichFieldDiffs(original, cleared).find(
      (row) => row.fieldKey === "locationGeo",
    );
    expect(clearedRow?.summary).toBe("Removed");
    expect(editableDraftToPatch(original, cleared).locationGeo).toBeNull();

    const samePlace = edit(original, {
      locationGeo: { ...PIN },
      locationProviderPlaceId: SAVED_ID,
      coordinatePrecision: "exact",
    });
    expect(editableDraftToPatch(original, samePlace)).toEqual({});

    const fresh = { ...samePlace, locationProviderPlaceId: FRESH_ID };
    const rows = computeRichFieldDiffs(original, fresh);
    expect(rows.map((row) => [row.fieldKey, row.summary])).toEqual([
      ["locationGeo", "Updated"],
    ]);
  });
});

describe("T-4 the summary, the event save and the RSVP save agree", () => {
  type Case = [string, Partial<LiveEvent>, Partial<DraftEvent>, boolean];
  const cases: Case[] = [
    ["untouched, nothing known", {}, {}, false],
    ["fresh id, nothing known", {}, { locationProviderPlaceId: FRESH_ID, coordinatePrecision: "exact" }, true],
    ["same id, precision approximate→exact", { locationProviderPlaceId: SAVED_ID, coordinatePrecision: "approximate" }, { locationProviderPlaceId: SAVED_ID, coordinatePrecision: "exact" }, true],
    ["same id + precision", { locationProviderPlaceId: SAVED_ID, coordinatePrecision: "exact" }, { locationProviderPlaceId: SAVED_ID, coordinatePrecision: "exact" }, false],
    ["id dropped (typed address)", { locationProviderPlaceId: SAVED_ID, coordinatePrecision: "exact" }, { locationProviderPlaceId: null, coordinatePrecision: "exact" }, true],
    ["moved pin", {}, { locationGeo: { lat: PIN.lat + 0.01, lng: PIN.lng } }, true],
    ["pin removed", {}, { locationGeo: null }, true],
  ];
  test.each(cases)("%s", (_label, saved, change, expected) => {
    const original = liveEvent(saved);
    expect(verdicts(original, edit(original, change))).toEqual({
      save: expected,
      summary: expected,
      rsvp: expected,
    });
  });
});

describe("T-5 a pin-only re-pick tells no guest or buyer", () => {
  test("safe 'Map pin · Updated', additive, no NOTIFIES GUESTS tag", () => {
    const original = liveEvent({ event_type: "rsvp" });
    const edited = edit(original, {
      locationProviderPlaceId: FRESH_ID,
      coordinatePrecision: "exact",
    });
    const rows = computeRichFieldDiffs(original, edited);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fieldKey: "locationGeo",
      fieldLabel: "Map pin",
      summary: "Updated",
      severity: "safe",
    });
    // The text did not change, so no material "address" key reaches the save.
    const payload = buildRsvpUpdatePayloadDiff(original, edited);
    expect(payload.location_provider_place_id).toBe(FRESH_ID);
    expect(editableDraftToPatch(original, edited).address).toBeUndefined();

    const keys = rows.map((row) => row.fieldKey);
    const severity = classifySeverity(keys as never);
    expect(severity).toBe("additive");
    const notice = changeSummaryNotice({
      loggedCopy: "Logged.",
      entityLabel: "event",
      severity,
      noBuyers: false,
      fieldKeys: keys,
      status: { live: true, audience: 40 } as never,
      noun: "guests",
    });
    expect(notice.taggedKeys.size).toBe(0);
    expect(notice.footer).toBe("Logged.");
  });
});

describe("T-6 brand: a typed address with no place id clears a known id", () => {
  const brand = (patch: Partial<Brand> = {}): Brand =>
    ({
      id: "brand-4334-t",
      displayName: "Brand T",
      slug: "brand-t",
      address: ADDRESS,
      lat: PIN.lat,
      lng: PIN.lng,
      city: "Lagos",
      countryCode: "NG",
      locationProviderPlaceId: SAVED_ID,
      coverHue: 25,
      role: "owner",
      stats: { events: 0, rev: 0, rev7d: 0, attendees: 0 },
      currentLiveEvent: null,
      ...patch,
    }) as Brand;

  test("same text and point, id → null is sent as null; untouched sends nothing", () => {
    expect(computeDirtyFieldsPatch(brand(), brand())).toEqual({});
    expect(
      computeDirtyFieldsPatch(brand({ locationProviderPlaceId: null }), brand()),
      // #4334 follow-ups — the pin travels with its id (biz_update_brand_pin).
    ).toEqual({ lat: PIN.lat, lng: PIN.lng, locationProviderPlaceId: null });
  });
});
