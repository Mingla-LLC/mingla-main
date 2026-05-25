/**
 * ORCH-0965 — TESTER ADVERSARIAL regression set.
 *
 * Attacks DIFFERENT angles than the implementor's 36 tests:
 *   - Invalid / malformed trip dates (Date('Invalid') edge case).
 *   - Mutating input arrays during sort (referential transparency).
 *   - Rule-ladder when counts and drafts disagree (inconsistent state).
 *   - Rule-ladder reference-stability invariant (useMemo correctness).
 *   - Trip-typed draft routes to /trip/{id}/edit via rung 3.
 *   - Strict-grep gate false-positive resistance to forbidden tokens in comments.
 *   - Past-exclusion off-by-one at exactly `endAtUtc === now`.
 *
 * Per SPEC §4.8 + Constitution audit. These tests are append-only per ORCH-0840
 * — do NOT modify post-merge without `[TEST-MOD-APPROVED ORCH-NNNN]`.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import type { DraftEvent } from "../../store/draftEventStore";
import type { LiveEvent } from "../../store/liveEventStore";
import type { Trip } from "../../services/tripsService";
import type { Brand } from "../../store/currentBrandStore";

import {
  buildUpcomingItems,
  isPastForUpcoming,
  normaliseTripRow,
  type UpcomingCounts,
  type UpcomingItem,
} from "../upcomingBuilder";
import { pickHomeNextAction } from "../homeNextAction";

const NOW = new Date("2026-06-01T12:00:00.000Z").getTime();

const liveEvent = (patch: Partial<LiveEvent> = {}): LiveEvent =>
  ({
    id: "evt-1",
    serverEventId: null,
    brandId: "brand-1",
    brandSlug: "brand-one",
    eventSlug: "evt-one",
    status: "live",
    publishedAt: "2026-05-01T09:00:00.000Z",
    cancelledAt: null,
    endedAt: null,
    name: "Adversarial event",
    description: "",
    format: "in_person",
    whenMode: "single",
    date: "2026-06-01",
    doorsOpen: "11:00",
    endsAt: "23:00",
    timezone: "UTC",
    recurrenceRule: null,
    multiDates: null,
    venueName: "Venue",
    address: "1 Main St",
    onlineUrl: null,
    hideAddressUntilTicket: true,
    coverHue: 25,
    coverMediaUrl: null,
    coverMediaType: null,
    tickets: [],
    visibility: "public",
    requireApproval: false,
    allowTransfers: true,
    hideRemainingCount: false,
    passwordProtected: false,
    privateGuestList: false,
    inPersonPaymentsEnabled: false,
    orders: [],
    createdAt: "2026-05-01T09:00:00.000Z",
    updatedAt: "2026-05-07T09:00:00.000Z",
    ...patch,
  } as unknown as LiveEvent);

const trip = (patch: Partial<Trip> = {}): Trip =>
  ({
    id: "trip-1",
    brandId: "brand-1",
    brandSlug: "brand-one",
    title: "Adversarial trip",
    description: null,
    slug: "trip-one",
    status: "scheduled",
    visibility: "public",
    publishedAt: "2026-05-01T09:00:00.000Z",
    timezone: "UTC",
    coverMediaUrl: null,
    coverMediaType: null,
    businessTrip: {
      startAt: "2026-06-10T09:00:00.000Z",
      endAt: "2026-06-12T17:00:00.000Z",
      destinationLocationText: null,
      destinationPlaceId: null,
      destinationLat: null,
      destinationLng: null,
      capacity: null,
    },
    days: [],
    pricingTiers: [],
    inclusions: [],
    createdAt: "2026-05-01T09:00:00.000Z",
    updatedAt: "2026-05-07T09:00:00.000Z",
    refundPolicy: null,
    bookingDeadline: null,
    bookingsClosed: false,
    bookingsClosedAt: null,
    ticketsSoldCount: 0,
    ...patch,
  } as unknown as Trip);

const draft = (patch: Partial<DraftEvent> = {}): DraftEvent =>
  ({
    id: "draft-1",
    brandId: "brand-1",
    serverSlug: null,
    name: "Draft",
    updatedAt: "2026-05-25T09:00:00.000Z",
    ...patch,
  } as unknown as DraftEvent);

const baseBrand = (patch: Partial<Brand> = {}): Brand => ({
  id: "brand-1",
  displayName: "Brand",
  slug: "brand-one",
  kind: "popup",
  address: null,
  coverHue: 25,
  role: "owner",
  stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
  currentLiveEvent: null,
  stripeStatus: "active",
  ...patch,
});

describe("ORCH-0965 ADVERSARIAL — malformed inputs + edge cases", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("ADV-01 — trip with malformed startAt 'banana' → no crash; item produced with Invalid Date", () => {
    const malformed = trip({
      id: "trip-malformed",
      status: "scheduled",
      businessTrip: {
        startAt: "banana",
        endAt: null,
        destinationLocationText: null,
        destinationPlaceId: null,
        destinationLat: null,
        destinationLng: null,
        capacity: null,
      },
    });
    // Should not throw at normalisation time.
    expect(() => normaliseTripRow(malformed)).not.toThrow();
    const item = normaliseTripRow(malformed);
    expect(item).not.toBeNull();
    // The resulting startAtUtc is `new Date('banana')` → an Invalid Date object.
    // Date(NaN).getTime() === NaN, which is what isPastForUpcoming will see.
    // Critical: this must NOT throw in the sort or filter pipeline.
    const { items } = buildUpcomingItems([], [], [malformed], [], NOW);
    // Either it's filtered (Invalid Date treated as no-date by comparator) or
    // present in the list — both are acceptable; the contract is "no crash".
    expect(Array.isArray(items)).toBe(true);
  });

  test("ADV-02 — buildUpcomingItems does not mutate input arrays (referential transparency)", () => {
    const evt = liveEvent({ id: "evt-a" });
    const tr = trip({ id: "trip-a" });
    const dr = draft({ id: "draft-a" });
    const serverEvents = [evt];
    const trips = [tr];
    const drafts = [dr];
    const beforeServerLen = serverEvents.length;
    const beforeTripsLen = trips.length;
    const beforeDraftsLen = drafts.length;
    buildUpcomingItems(serverEvents, [], trips, drafts, NOW);
    expect(serverEvents.length).toBe(beforeServerLen);
    expect(trips.length).toBe(beforeTripsLen);
    expect(drafts.length).toBe(beforeDraftsLen);
    // Pipeline must NOT have reordered or removed elements from caller's arrays.
    expect(serverEvents[0]).toBe(evt);
    expect(trips[0]).toBe(tr);
    expect(drafts[0]).toBe(dr);
  });

  test("ADV-03 — past-exclusion off-by-one: endAtUtc === now → NOT past (boundary)", () => {
    const item: UpcomingItem = {
      key: "evt-boundary",
      id: "evt-boundary",
      kind: "event",
      status: "upcoming",
      startAtUtc: new Date(NOW - 1000),
      endAtUtc: new Date(NOW),
      source: liveEvent(),
    };
    // endAtUtc < now is the past check; equality should NOT be past.
    expect(isPastForUpcoming(item, NOW)).toBe(false);
  });

  test("ADV-04 — past-exclusion: endAtUtc === now - 1ms → past", () => {
    const item: UpcomingItem = {
      key: "evt-just-past",
      id: "evt-just-past",
      kind: "event",
      status: "upcoming",
      startAtUtc: new Date(NOW - 2000),
      endAtUtc: new Date(NOW - 1),
      source: liveEvent(),
    };
    expect(isPastForUpcoming(item, NOW)).toBe(true);
  });
});

describe("ORCH-0965 ADVERSARIAL — rule ladder under inconsistent state", () => {
  test("ADV-05 — counts.draft > 0 but drafts array empty → rung 3 NOT fired (predicate guards correctly)", () => {
    const brand = baseBrand();
    // Inconsistent state: counts says 1 draft, but drafts array is empty.
    // The rung 3 predicate `counts.draft > 0 && drafts.length > 0` must guard
    // against this — otherwise mostRecentDraft would be undefined and crash.
    const counts: UpcomingCounts = { total: 1, active: 1, live: 0, upcoming: 0, draft: 1 };
    const result = pickHomeNextAction(brand, counts, []);
    // Must not crash. Must not fire rung 3 (no draft to route to).
    // Result will fall through to rung 4 check (which also doesn't fire on
    // popup brand) and return null.
    expect(result).toBeNull();
  });

  test("ADV-06 — counts.total === 0 + counts.live > 0 (logically impossible) → still picks rung 2", () => {
    // Defensive: counts.total === 0 wins the rung 2 check; live count is moot.
    const brand = baseBrand();
    const counts: UpcomingCounts = { total: 0, active: 0, live: 5, upcoming: 0, draft: 0 };
    const result = pickHomeNextAction(brand, counts, []);
    expect(result?.rung).toBe(2);
  });

  test("ADV-07 — trip_planner draft with event_type='trip' → rung 3 routes to /trip/{id}/edit", () => {
    const brand = baseBrand({ kind: "trip_planner" });
    const counts: UpcomingCounts = { total: 1, active: 1, live: 0, upcoming: 0, draft: 1 };
    const tripDraft = draft({ id: "draft-trip-99" });
    (tripDraft as DraftEvent & { event_type?: string }).event_type = "trip";
    const result = pickHomeNextAction(brand, counts, [tripDraft]);
    expect(result?.rung).toBe(3);
    expect(result?.ctaRoute).toBe("/trip/draft-trip-99/edit");
  });

  test("ADV-08 — Rung object content is deterministic across calls with same inputs", () => {
    // Important for React.useMemo to avoid spurious re-renders.
    // We don't require referential equality (functions allocate new objects),
    // but the shape must match exactly.
    const brand = baseBrand({ stripeStatus: "not_connected" });
    const counts: UpcomingCounts = { total: 0, active: 0, live: 0, upcoming: 0, draft: 0 };
    const a = pickHomeNextAction(brand, counts, []);
    const b = pickHomeNextAction(brand, counts, []);
    expect(a).toEqual(b);
    expect(a?.rung).toBe(b?.rung);
    expect(a?.ctaLabel).toBe(b?.ctaLabel);
    expect(a?.ctaRoute).toBe(b?.ctaRoute);
  });
});

describe("ORCH-0965 ADVERSARIAL — invariant violations under live mutation", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("ADV-09 — Brand-switch mid-render: pickHomeNextAction called twice with different brands → results don't bleed", () => {
    const brandA = baseBrand({ id: "brand-A", stripeStatus: "not_connected" });
    const brandB = baseBrand({ id: "brand-B", stripeStatus: "active", kind: "trip_planner" });
    const emptyCounts: UpcomingCounts = { total: 0, active: 0, live: 0, upcoming: 0, draft: 0 };
    const resultA = pickHomeNextAction(brandA, emptyCounts, []);
    const resultB = pickHomeNextAction(brandB, emptyCounts, []);
    expect(resultA?.rung).toBe(1);
    expect(resultA?.ctaRoute).toBe("/brand/brand-A/payments");
    expect(resultB?.rung).toBe(2);
    expect(resultB?.title).toBe("Plan a trip");
  });

  test("ADV-10 — Cancelled live event in input → excluded, counts.live === 0, primaryLiveItem null", () => {
    const cancelled = liveEvent({ id: "evt-cancelled", status: "cancelled" });
    const { items, counts, primaryLiveItem } = buildUpcomingItems(
      [cancelled],
      [],
      [],
      [],
      NOW,
    );
    expect(items.length).toBe(0);
    expect(counts.live).toBe(0);
    expect(primaryLiveItem).toBeNull();
  });

  test("ADV-11 — Trip with status='draft' → excluded by trip normaliser (drafts handled via Zustand only)", () => {
    const tripDraft = trip({ id: "trip-as-draft", status: "draft" });
    const item = normaliseTripRow(tripDraft);
    expect(item).toBeNull();
  });
});
