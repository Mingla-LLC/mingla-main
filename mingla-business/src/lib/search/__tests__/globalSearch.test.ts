/**
 * META-ORCH-1073 Sub-A — global search service: happy-path + determinism +
 * registry-route + diacritic regression.
 *
 * Harness: mingla-business jest is node-env + ts-jest (no
 * @testing-library/react-native). These tests exercise the PURE service —
 * the core feature behavior (typing an event title returns that event with
 * the route from routeForEventRow) is fully covered here.
 *
 * Fails-on-revert: T-02 below asserts the offering route equals
 * routeForEventRow's output AND the top result is the matched event. If the
 * event adapter or the matcher is reverted/broken, this test goes red — see
 * implementation report Regression Test section.
 */

import { describe, expect, test } from "@jest/globals";

import {
  buildSearchIndex,
  searchIndex,
  GROUP_ORDER,
  GROUP_CAPS,
} from "../globalSearch";
import { FEATURE_REGISTRY } from "../registry";
import { routeForEventRow } from "../../../utils/routeForEventRow";
import type { LiveEvent } from "../../../store/liveEventStore";
import type { Trip } from "../../../services/tripsService";
import type { VenueExperience } from "../../../services/experiencesService";

const BRAND_ID = "brand_123";

function makeEvent(over: Partial<LiveEvent> & { id: string; name: string }): LiveEvent {
  return {
    id: over.id,
    serverEventId: null,
    brandId: BRAND_ID,
    brandSlug: "acme",
    eventSlug: over.id,
    status: over.status ?? "live",
    publishedAt: over.publishedAt ?? "2026-06-01T00:00:00.000Z",
    cancelledAt: null,
    endedAt: null,
    event_type: over.event_type ?? "event",
    name: over.name,
    description: over.description ?? "",
    format: "in_person",
    category: null,
    partyTypes: over.partyTypes ?? [],
    vibeTags: over.vibeTags ?? [],
    musicGenres: over.musicGenres ?? [],
    city: null,
    locationGeo: null,
    whenMode: "single",
    date: null,
    doorsOpen: null,
    endsAt: null,
    timezone: "Europe/London",
    recurrenceRule: null,
    multiDates: null,
    venueName: over.venueName ?? null,
    address: over.address ?? null,
    onlineUrl: null,
    hideAddressUntilTicket: false,
    coverHue: 0,
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
  } as unknown as LiveEvent;
}

function makeTrip(over: { id: string; title: string; status?: Trip["status"] }): Trip {
  return {
    id: over.id,
    brandId: BRAND_ID,
    brandSlug: "acme",
    title: over.title,
    description: null,
    slug: over.id,
    status: over.status ?? "live",
    visibility: "public",
    publishedAt: "2026-06-01T00:00:00.000Z",
    timezone: "Europe/London",
    coverMediaUrl: null,
    coverMediaType: null,
    businessTrip: {} as Trip["businessTrip"],
    days: [],
    pricingTiers: [],
    inclusions: [],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    refundPolicy: null,
    bookingDeadline: null,
    bookingsClosed: false,
    bookingsClosedAt: null,
    ticketsSoldCount: 0,
  } as unknown as Trip;
}

function makeExperience(over: { id: string; title: string }): VenueExperience {
  return {
    id: over.id,
    brandId: BRAND_ID,
    title: over.title,
    description: null,
    slug: over.id,
    status: "live",
    visibility: "public",
    createdAt: "2026-06-01T00:00:00.000Z",
    intentTags: [],
    priceMinCents: null,
    priceMaxCents: null,
    currency: null,
    capacityMin: null,
    capacityMax: null,
    suggestedTimeOfDay: null,
    // META-ORCH-1059 list-card fields (added on main; kept in sync post-merge).
    coverMediaUrl: null,
    coverMediaType: null,
    dateSubline: "Draft",
    priceLabel: null,
    spotsSold: 0,
    revenueCents: 0,
    revenueCurrency: null,
  };
}

const fullIndex = (events: LiveEvent[], trips: Trip[] = [], exps: VenueExperience[] = []) =>
  buildSearchIndex({
    events,
    drafts: [],
    trips,
    experiences: exps,
    brandId: BRAND_ID,
  });

describe("globalSearch — T-02 event title match (happy path / fails-on-revert)", () => {
  const event = makeEvent({ id: "le_summer", name: "Summer Rooftop Party" });
  const index = fullIndex([event]);

  test("typing the event title returns that event under Offerings", () => {
    const results = searchIndex("Summer Rooftop Party", index);
    expect(results.length).toBeGreaterThan(0);
    const top = results[0];
    expect(top.type).toBe("event");
    expect(top.id).toBe("le_summer");
    expect(top.group).toBe("offerings");
    expect(top.score).toBeGreaterThanOrEqual(0.85);
  });

  test("the offering route is produced by routeForEventRow (R-2)", () => {
    const results = searchIndex("Summer Rooftop", index);
    const top = results.find((r) => r.id === "le_summer");
    expect(top).toBeDefined();
    expect(top?.route).toBe(
      routeForEventRow({ id: "le_summer", event_type: "event", status: "live" }),
    );
    expect(top?.route).toBe("/event/le_summer");
  });

  test("a draft event routes to the edit wizard via routeForEventRow", () => {
    const draftIndex = buildSearchIndex({
      events: [],
      drafts: [
        {
          id: "d_wip",
          brandId: BRAND_ID,
          name: "Work In Progress Gig",
          description: "",
          partyTypes: [],
          vibeTags: [],
          musicGenres: [],
          venueName: null,
          address: null,
          status: "draft",
          createdAt: "2026-06-02T00:00:00.000Z",
          updatedAt: "2026-06-02T00:00:00.000Z",
        } as never,
      ],
      trips: [],
      experiences: [],
      brandId: BRAND_ID,
    });
    const results = searchIndex("Work In Progress", draftIndex);
    const top = results[0];
    expect(top.id).toBe("d_wip");
    expect(top.subtitle).toBe("Draft");
    expect(top.route).toBe(
      routeForEventRow({ id: "d_wip", event_type: "event", status: "draft" }),
    );
    expect(top.route).toBe("/event/d_wip/edit");
  });
});

describe("globalSearch — T-03 trip + experience routes", () => {
  test("trip title returns trip routed via routeForEventRow", () => {
    const trip = makeTrip({ id: "le_trip", title: "Iceland Aurora Escape" });
    const index = fullIndex([], [trip]);
    const results = searchIndex("Iceland Aurora", index);
    const top = results.find((r) => r.type === "trip");
    expect(top?.id).toBe("le_trip");
    expect(top?.route).toBe(
      routeForEventRow({ id: "le_trip", event_type: "trip", status: "live" }),
    );
    expect(top?.route).toBe("/trip/le_trip");
  });

  test("experience resolves to /experience/{id} dashboard (no dead tap)", () => {
    const exp = makeExperience({ id: "vx_wine", title: "Wine Tasting Flight" });
    const index = fullIndex([], [], [exp]);
    const results = searchIndex("Wine Tasting", index);
    const top = results.find((r) => r.type === "experience");
    expect(top?.id).toBe("vx_wine");
    // META-ORCH-1059 landed the experience dashboard; routeForEventRow now
    // returns /experience/{id} (coming-soon stub retired) — still no dead tap.
    expect(top?.route).toBe("/experience/vx_wine");
  });
});

describe("globalSearch — T-04 synonym → registry destination", () => {
  const index = buildSearchIndex({
    events: [],
    drafts: [],
    trips: [],
    experiences: [],
    brandId: BRAND_ID,
  });
  const routeFor = (key: string): string =>
    `/brand/${BRAND_ID}/${key}`;

  test('"refund" → Payout reports', () => {
    const results = searchIndex("refund", index);
    const top = results[0];
    expect(top.id).toBe("payments-reports");
    expect(top.route).toBe(routeFor("payments/reports"));
  });

  test('"currency" → Pricing defaults', () => {
    const top = searchIndex("currency", index)[0];
    expect(top.id).toBe("pricing-defaults");
  });

  test('"invite scanner" → Scanners', () => {
    const top = searchIndex("invite scanner", index)[0];
    expect(top.id).toBe("brand-scanners");
  });

  test('"team" → Team', () => {
    const top = searchIndex("team", index)[0];
    expect(top.id).toBe("brand-team");
  });

  test('"tax" → Tax registrations or Pricing defaults', () => {
    const ids = searchIndex("tax", index).map((r) => r.id);
    expect(
      ids.includes("tax-registrations") || ids.includes("pricing-defaults"),
    ).toBe(true);
  });

  test('"notifications" → Notifications', () => {
    const top = searchIndex("notifications", index)[0];
    expect(top.id).toBe("account-notifications");
  });
});

describe("globalSearch — T-05 ranking determinism", () => {
  test("exact > prefix > substring; stable across runs", () => {
    const events = [
      makeEvent({ id: "e_sub", name: "Late Night Jam" }), // substring of "jam"
      makeEvent({ id: "e_exact", name: "Jam" }), // exact
      makeEvent({ id: "e_prefix", name: "Jamboree Fest" }), // prefix
    ];
    const index = fullIndex(events);
    const run1 = searchIndex("jam", index).map((r) => r.id);
    const run2 = searchIndex("jam", index).map((r) => r.id);
    expect(run1).toEqual(run2);
    // exact first, then prefix, then word-boundary/substring
    expect(run1.indexOf("e_exact")).toBeLessThan(run1.indexOf("e_prefix"));
    expect(run1.indexOf("e_prefix")).toBeLessThan(run1.indexOf("e_sub"));
  });
});

describe("globalSearch — T-06 recency tiebreak", () => {
  test("equal-score offerings: newer createdAt first", () => {
    const older = makeEvent({
      id: "e_old",
      name: "Gala",
      publishedAt: "2026-01-01T00:00:00.000Z",
    });
    const newer = makeEvent({
      id: "e_new",
      name: "Gala",
      publishedAt: "2026-06-01T00:00:00.000Z",
    });
    const index = fullIndex([older, newer]);
    const results = searchIndex("gala", index);
    expect(results[0].id).toBe("e_new");
    expect(results[1].id).toBe("e_old");
  });
});

describe("globalSearch — T-09 diacritic + case insensitivity", () => {
  test('"cafe" matches title "Café" and vice-versa', () => {
    const event = makeEvent({ id: "e_cafe", name: "Café Social" });
    const index = fullIndex([event]);
    expect(searchIndex("cafe", index).some((r) => r.id === "e_cafe")).toBe(true);
    expect(searchIndex("café", index).some((r) => r.id === "e_cafe")).toBe(true);
  });

  test('uppercase query matches lowercase content', () => {
    const event = makeEvent({ id: "e_low", name: "midnight market" });
    const index = fullIndex([event]);
    expect(searchIndex("MIDNIGHT", index).some((r) => r.id === "e_low")).toBe(true);
  });
});

describe("globalSearch — T-12 every registry route resolves + group order", () => {
  test("group order is fixed Offerings → Go to → Settings", () => {
    expect(GROUP_ORDER).toEqual(["offerings", "goto", "settings"]);
  });

  test("registry has 27 entries, all with non-empty static routes", () => {
    expect(FEATURE_REGISTRY.length).toBe(27);
    for (const item of FEATURE_REGISTRY) {
      expect(item.route.length).toBeGreaterThan(0);
      expect(item.route.startsWith("/")).toBe(true);
    }
  });

  test("brand-scoped registry routes substitute :brandId and never leak the token", () => {
    const index = buildSearchIndex({
      events: [],
      drafts: [],
      trips: [],
      experiences: [],
      brandId: BRAND_ID,
    });
    for (const entry of index) {
      expect(entry.route.includes(":brandId")).toBe(false);
    }
  });

  test("with no brand, :brandId entries are dropped (no dead taps)", () => {
    const index = buildSearchIndex({
      events: [],
      drafts: [],
      trips: [],
      experiences: [],
      brandId: null,
    });
    for (const entry of index) {
      expect(entry.route.includes(":brandId")).toBe(false);
    }
    // account/* + connect-* + create-* survive (no :brandId).
    expect(index.some((e) => e.id === "account-notifications")).toBe(true);
    expect(index.some((e) => e.id === "brand-team")).toBe(false);
  });
});

describe("globalSearch — per-group caps", () => {
  test("offerings capped at 8", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      makeEvent({ id: `e_${i}`, name: `Party Number ${i}` }),
    );
    const index = fullIndex(events);
    const results = searchIndex("party", index).filter(
      (r) => r.group === "offerings",
    );
    expect(results.length).toBeLessThanOrEqual(GROUP_CAPS.offerings);
  });
});
