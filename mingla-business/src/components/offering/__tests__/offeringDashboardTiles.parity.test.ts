/**
 * META-ORCH-1059 Pass 2 — dashboard tile parity regression.
 *
 * Pins the per-kind dashboard tile config so trips + experiences keep the
 * operator-confirmed event-grade tile set, each routed to the correct
 * per-kind URL ("see through the right lens"). Companion to the experience
 * stops-gallery + trip-adapter tests.
 *
 * Fails-on-revert: removing a tile, reordering the canonical set, or pointing
 * a tile at the wrong route breaks the matching assertion below.
 */

import { describe, expect, test } from "@jest/globals";

import {
  buildOfferingDashboardTiles,
  type OfferingTileKey,
} from "../offeringDashboardTiles";

const CANONICAL_KEYS: OfferingTileKey[] = [
  "scan",
  "scanners",
  "orders",
  "guests",
  "blasts",
  "public",
  "brand",
  "reconciliation",
];

describe("buildOfferingDashboardTiles — canonical set per kind", () => {
  for (const kind of ["event", "trip", "experience"] as const) {
    test(`${kind} has exactly the 8 operator-confirmed tiles in order`, () => {
      const keys = buildOfferingDashboardTiles(kind).map((t) => t.key);
      expect(keys).toEqual(CANONICAL_KEYS);
    });
  }
});

describe("tiles route through the right lens per kind", () => {
  const id = "evt_123";
  const slug = "sunset-crawl";
  const input = { id, brandSlug: "lanternvine", slug };

  test("scan/scanners/orders/reconciliation reuse the shared /event sub-screens for ALL kinds", () => {
    for (const kind of ["event", "trip", "experience"] as const) {
      const byKey = Object.fromEntries(
        buildOfferingDashboardTiles(kind).map((t) => [t.key, t.route(input)]),
      );
      expect(byKey.scan).toBe(`/event/${id}/scanner`);
      expect(byKey.scanners).toBe(`/event/${id}/scanners`);
      expect(byKey.orders).toBe(`/event/${id}/orders`);
      expect(byKey.reconciliation).toBe(`/event/${id}/reconciliation`);
      expect(byKey.blasts).toBe(`/event/${id}/blasts`);
    }
  });

  test("Guests tile: trips route to /trip/{id}/travelers; events + experiences to /event/{id}/guests", () => {
    const tripGuests = buildOfferingDashboardTiles("trip").find(
      (t) => t.key === "guests",
    )!;
    const expGuests = buildOfferingDashboardTiles("experience").find(
      (t) => t.key === "guests",
    )!;
    const eventGuests = buildOfferingDashboardTiles("event").find(
      (t) => t.key === "guests",
    )!;
    expect(tripGuests.route(input)).toBe(`/trip/${id}/travelers`);
    expect(expGuests.route(input)).toBe(`/event/${id}/guests`);
    expect(eventGuests.route(input)).toBe(`/event/${id}/guests`);
  });

  test("Guests tile label reads the per-kind metric: Travelers / Spots / Attendees", () => {
    const label = (k: "event" | "trip" | "experience"): string =>
      buildOfferingDashboardTiles(k).find((t) => t.key === "guests")!.label;
    expect(label("trip")).toBe("Travelers");
    expect(label("experience")).toBe("Spots");
    expect(label("event")).toBe("Attendees");
  });

  test("Public page tile uses the per-kind public prefix (/e, /t, /exp)", () => {
    const pub = (k: "event" | "trip" | "experience"): string =>
      buildOfferingDashboardTiles(k).find((t) => t.key === "public")!.route(input);
    expect(pub("event")).toBe(`/e/lanternvine/${slug}`);
    expect(pub("trip")).toBe(`/t/lanternvine/${slug}`);
    expect(pub("experience")).toBe(`/exp/lanternvine/${slug}`);
  });

  test("Public + Brand tiles are flagged requiresPublicPage; the rest are not", () => {
    const tiles = buildOfferingDashboardTiles("experience");
    const needsPublic = tiles
      .filter((t) => t.requiresPublicPage)
      .map((t) => t.key)
      .sort();
    expect(needsPublic).toEqual(["brand", "public"]);
  });
});
