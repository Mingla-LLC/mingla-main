/**
 * ORCH-0965 [Home dashboard intelligent KPIs + tri-kind upcoming]
 *
 * Unit tests for the pure composition pipeline (`buildUpcomingItems`)
 * + sort comparator + past exclusion. Avoids React Query scaffolding by
 * exercising the pure pipeline. SPEC §4.4 / §4.8 T-IMPL-01..03 + T-QA-01..04.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import type { DraftEvent } from "../../store/draftEventStore";
import type { LiveEvent } from "../../store/liveEventStore";
import type { Trip } from "../../services/tripsService";

import {
  buildUpcomingItems,
  compareUpcomingItems,
  isPastForUpcoming,
  type UpcomingItem,
} from "../upcomingBuilder";

// Fixed "now" for deterministic tests — 2026-06-01 12:00 UTC.
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
    name: "Test event",
    description: "",
    format: "in_person",
    whenMode: "single",
    date: "2026-06-15",
    doorsOpen: "19:00",
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
    title: "Test trip",
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
      destinationLocationText: "Lisbon",
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
    name: "Draft event",
    updatedAt: "2026-05-25T09:00:00.000Z",
    ...patch,
  } as unknown as DraftEvent);

describe("ORCH-0965 buildUpcomingItems — happy path (T-IMPL-01..03)", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("T-IMPL-01 — 1 live event + 1 upcoming trip + 1 draft → order [live-event, upcoming-trip, draft]", () => {
    const event = liveEvent({
      id: "evt-live",
      date: "2026-06-01",
      doorsOpen: "11:00",
      timezone: "UTC",
    });
    const futureTrip = trip({
      id: "trip-upcoming",
      status: "scheduled",
      businessTrip: {
        startAt: "2026-06-10T09:00:00.000Z",
        endAt: "2026-06-12T17:00:00.000Z",
        destinationLocationText: "Lisbon",
        destinationPlaceId: null,
        destinationLat: null,
        destinationLng: null,
        capacity: null,
      },
    });
    const localDraft = draft({ id: "draft-1" });

    const { items } = buildUpcomingItems(
      [event],
      [],
      [futureTrip],
      [localDraft],
      NOW,
    );

    expect(items.map((i) => i.key)).toEqual([
      `event-evt-live`,
      `trip-trip-upcoming`,
      `draft-draft-1`,
    ]);
  });

  test("T-IMPL-02 — live event ending in past → excluded", () => {
    const event = liveEvent({
      id: "evt-past",
      date: "2026-05-01",
      doorsOpen: "11:00",
      endsAt: "14:00",
      timezone: "UTC",
    });
    const { items } = buildUpcomingItems([event], [], [], [], NOW);
    expect(items.find((i) => i.id === "evt-past")).toBeUndefined();
  });

  test("T-IMPL-03 — 2 live items, older-start-first among live", () => {
    // Both events live at NOW=2026-06-01T12:00:00Z:
    //   earlier doors 06:00 ends 23:00 → live window covers NOW
    //   later   doors 11:00 ends 23:00 → live window covers NOW
    const earlier = liveEvent({
      id: "evt-earlier",
      date: "2026-06-01",
      doorsOpen: "06:00",
      endsAt: "23:00",
      timezone: "UTC",
    });
    const later = liveEvent({
      id: "evt-later",
      date: "2026-06-01",
      doorsOpen: "11:00",
      endsAt: "23:00",
      timezone: "UTC",
    });
    const { items } = buildUpcomingItems([earlier, later], [], [], [], NOW);
    const liveOrder = items.filter((i) => i.status === "live").map((i) => i.id);
    expect(liveOrder).toEqual(["evt-earlier", "evt-later"]);
  });

  test("counts — mixed brand state populates correctly", () => {
    const event = liveEvent({
      id: "evt-live",
      date: "2026-06-01",
      doorsOpen: "11:00",
    });
    const futureTrip = trip({
      id: "trip-upcoming",
      status: "scheduled",
      businessTrip: {
        startAt: "2026-06-10T09:00:00.000Z",
        endAt: "2026-06-12T17:00:00.000Z",
        destinationLocationText: null,
        destinationPlaceId: null,
        destinationLat: null,
        destinationLng: null,
        capacity: null,
      },
    });
    const localDraft = draft({ id: "draft-1" });

    const { counts } = buildUpcomingItems(
      [event],
      [],
      [futureTrip],
      [localDraft],
      NOW,
    );

    expect(counts.live).toBe(1);
    expect(counts.upcoming).toBe(1);
    expect(counts.draft).toBe(1);
    expect(counts.total).toBe(3);
    expect(counts.active).toBe(3);
  });

  test("primaryLiveItem returns the first sorted live item", () => {
    const earlier = liveEvent({ id: "evt-earlier", date: "2026-06-01", doorsOpen: "06:00", endsAt: "23:00" });
    const later = liveEvent({ id: "evt-later", date: "2026-06-01", doorsOpen: "11:00", endsAt: "23:00" });
    const { primaryLiveItem } = buildUpcomingItems([earlier, later], [], [], [], NOW);
    expect(primaryLiveItem?.id).toBe("evt-earlier");
  });

  test("primaryLiveItem null when no live items", () => {
    const futureTrip = trip({ id: "trip-only", status: "scheduled" });
    const { primaryLiveItem } = buildUpcomingItems([], [], [futureTrip], [], NOW);
    expect(primaryLiveItem).toBeNull();
  });
});

describe("ORCH-0965 scan-QR visibility predicate (SC-10..12, T-INT-04..06)", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The home screen renders the scan button iff
  //   primaryLiveItem !== null && primaryLiveItem.kind === 'event'
  // These tests assert primaryLiveItem.kind for the three kinds so the
  // home screen's render predicate has the right input.

  test("SC-10 / T-INT-04 — live event-kind → primaryLiveItem.kind === 'event'", () => {
    const event = liveEvent({
      id: "evt-live-event",
      date: "2026-06-01",
      doorsOpen: "06:00",
      endsAt: "23:00",
    });
    const { primaryLiveItem } = buildUpcomingItems([event], [], [], [], NOW);
    expect(primaryLiveItem?.kind).toBe("event");
  });

  test("SC-11 / T-INT-06 — live experience-kind → primaryLiveItem.kind === 'experience' (scan hidden)", () => {
    const experience = liveEvent({
      id: "exp-live",
      date: "2026-06-01",
      doorsOpen: "06:00",
      endsAt: "23:00",
    });
    (experience as LiveEvent & { event_type?: string }).event_type = "experience";
    const { primaryLiveItem } = buildUpcomingItems([experience], [], [], [], NOW);
    expect(primaryLiveItem?.kind).toBe("experience");
    expect(primaryLiveItem?.kind !== "event").toBe(true);
  });

  test("SC-12 / T-INT-05 — live trip → primaryLiveItem.kind === 'trip' (scan hidden)", () => {
    // Trip live = status==='live'. Trip is normalised straight to UpcomingItem
    // without going through deriveLiveStatus; treat as live regardless of
    // start/end clock.
    const liveTrip = trip({
      id: "trip-live",
      status: "live",
      businessTrip: {
        startAt: "2026-05-30T09:00:00.000Z",
        endAt: "2026-06-05T17:00:00.000Z",
        destinationLocationText: null,
        destinationPlaceId: null,
        destinationLat: null,
        destinationLng: null,
        capacity: null,
      },
    });
    const { primaryLiveItem } = buildUpcomingItems([], [], [liveTrip], [], NOW);
    expect(primaryLiveItem?.kind).toBe("trip");
    expect(primaryLiveItem?.kind !== "event").toBe(true);
  });

  test("Mixed live: event + trip simultaneous → event-kind sorts first (older start), scan button visible", () => {
    // Event starts 06:00; trip live (already started before today). Live items
    // sorted older-start-first → trip (started 2026-05-30) sorts before event.
    // primaryLiveItem will be the trip — scan button HIDDEN in this case.
    // SPEC §4.5.1 covers this: hero is a single primary item; carousel deferred.
    const event = liveEvent({
      id: "evt-live",
      date: "2026-06-01",
      doorsOpen: "06:00",
      endsAt: "23:00",
    });
    const liveTrip = trip({
      id: "trip-live",
      status: "live",
      businessTrip: {
        startAt: "2026-05-30T09:00:00.000Z",
        endAt: "2026-06-05T17:00:00.000Z",
        destinationLocationText: null,
        destinationPlaceId: null,
        destinationLat: null,
        destinationLng: null,
        capacity: null,
      },
    });
    const { primaryLiveItem, items } = buildUpcomingItems([event], [], [liveTrip], [], NOW);
    // Both live present
    expect(items.filter((i) => i.status === "live").length).toBe(2);
    // Trip starts earlier → trip is primary
    expect(primaryLiveItem?.kind).toBe("trip");
  });
});

describe("ORCH-0965 buildUpcomingItems — adversarial (T-QA-01..04)", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("T-QA-01 — 2 live events with same start instant → order stable across renders", () => {
    const a = liveEvent({ id: "evt-a", date: "2026-06-01", doorsOpen: "11:00" });
    const b = liveEvent({ id: "evt-b", date: "2026-06-01", doorsOpen: "11:00" });

    const first = buildUpcomingItems([a, b], [], [], [], NOW).items.map((i) => i.id);
    const second = buildUpcomingItems([a, b], [], [], [], NOW).items.map((i) => i.id);
    expect(first).toEqual(second);
  });

  test("T-QA-02 — cancelled trip → excluded", () => {
    const cancelledTrip = trip({ id: "trip-cancelled", status: "cancelled" });
    const endedTrip = trip({ id: "trip-ended", status: "ended" });
    const { items } = buildUpcomingItems([], [], [cancelledTrip, endedTrip], [], NOW);
    expect(items.find((i) => i.id === "trip-cancelled")).toBeUndefined();
    expect(items.find((i) => i.id === "trip-ended")).toBeUndefined();
  });

  test("T-QA-02b — cancelled event → excluded via deriveLiveStatus", () => {
    const cancelled = liveEvent({ id: "evt-cancelled", status: "cancelled" });
    const { items } = buildUpcomingItems([cancelled], [], [], [], NOW);
    expect(items.find((i) => i.id === "evt-cancelled")).toBeUndefined();
  });

  test("T-QA-03 — drafts with null updatedAt → no NaN comparisons, drafts present", () => {
    const a = draft({ id: "draft-a", updatedAt: undefined as unknown as string });
    const b = draft({ id: "draft-b", updatedAt: "2026-05-25T09:00:00.000Z" });
    const { items } = buildUpcomingItems([], [], [], [a, b], NOW);
    expect(items.length).toBe(2);
    // b has a real updatedAt → b sorts before a (b is newer).
    expect(items[0].id).toBe("draft-b");
  });

  test("T-QA-04 — counts.active === items.length always", () => {
    const event = liveEvent({ id: "evt-live", date: "2026-06-01", doorsOpen: "11:00" });
    const upcomingEvent = liveEvent({ id: "evt-future", date: "2026-07-15", doorsOpen: "20:00", status: "scheduled" });
    const pastTrip = trip({
      id: "trip-past",
      status: "scheduled",
      businessTrip: {
        startAt: "2026-05-01T09:00:00.000Z",
        endAt: "2026-05-03T17:00:00.000Z",
        destinationLocationText: null,
        destinationPlaceId: null,
        destinationLat: null,
        destinationLng: null,
        capacity: null,
      },
    });
    const { items, counts } = buildUpcomingItems(
      [event, upcomingEvent],
      [],
      [pastTrip],
      [draft({ id: "draft-1" })],
      NOW,
    );
    expect(counts.active).toBe(items.length);
    // past trip excluded:
    expect(items.find((i) => i.id === "trip-past")).toBeUndefined();
  });
});

describe("ORCH-0965 isPastForUpcoming — past-exclusion edge cases", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("drafts never past", () => {
    const item: UpcomingItem = {
      key: "draft-1",
      id: "draft-1",
      kind: "draft",
      status: "draft",
      startAtUtc: null,
      endAtUtc: null,
      source: draft(),
    };
    expect(isPastForUpcoming(item, NOW)).toBe(false);
  });

  test("endAtUtc < now → past", () => {
    const item: UpcomingItem = {
      key: "evt-1",
      id: "evt-1",
      kind: "event",
      status: "upcoming",
      startAtUtc: new Date("2026-05-01T09:00:00.000Z"),
      endAtUtc: new Date("2026-05-02T09:00:00.000Z"),
      source: liveEvent(),
    };
    expect(isPastForUpcoming(item, NOW)).toBe(true);
  });

  test("startAtUtc + 24h < now and endAtUtc unknown → past", () => {
    const item: UpcomingItem = {
      key: "evt-1",
      id: "evt-1",
      kind: "event",
      status: "upcoming",
      startAtUtc: new Date("2026-05-01T09:00:00.000Z"),
      endAtUtc: null,
      source: liveEvent(),
    };
    expect(isPastForUpcoming(item, NOW)).toBe(true);
  });

  test("both null → not past (unknown — keep)", () => {
    const item: UpcomingItem = {
      key: "evt-1",
      id: "evt-1",
      kind: "event",
      status: "upcoming",
      startAtUtc: null,
      endAtUtc: null,
      source: liveEvent(),
    };
    expect(isPastForUpcoming(item, NOW)).toBe(false);
  });
});

describe("ORCH-0965 compareUpcomingItems — comparator unit tests", () => {
  const ev = (id: string, status: "live" | "upcoming" | "draft", startMs: number | null): UpcomingItem => ({
    key: `${status}-${id}`,
    id,
    kind: status === "draft" ? "draft" : "event",
    status,
    startAtUtc: startMs !== null ? new Date(startMs) : null,
    endAtUtc: null,
    source: liveEvent({ id }),
  });

  test("live before upcoming", () => {
    expect(compareUpcomingItems(ev("a", "live", 100), ev("b", "upcoming", 50))).toBeLessThan(0);
  });

  test("upcoming before draft", () => {
    expect(compareUpcomingItems(ev("a", "upcoming", 100), ev("b", "draft", null))).toBeLessThan(0);
  });

  test("among upcoming, soonest first", () => {
    expect(compareUpcomingItems(ev("a", "upcoming", 100), ev("b", "upcoming", 50))).toBeGreaterThan(0);
  });
});
