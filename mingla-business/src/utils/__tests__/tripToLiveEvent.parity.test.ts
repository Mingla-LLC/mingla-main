/**
 * META-ORCH-1059 Pass 2 — trip → LiveEvent adapter regression.
 *
 * Pins the adapter that lets the SHARED event sub-screens (scanner/scanners/
 * orders/guests/reconciliation) resolve a TRIP id without forking the screens
 * or relaxing the locked fetchBusinessEventById trip-rejection probe. The
 * sub-screens read id/brandId/brandSlug/eventSlug/name/currency/status/tickets;
 * those MUST survive the adaptation faithfully.
 *
 * Fails-on-revert: deleting tripToLiveEvent or dropping a consumed field
 * breaks the matching assertion (and the shared scanner would render
 * "not found" for trips).
 */

import { describe, expect, test } from "@jest/globals";

import { tripToLiveEvent } from "../tripToLiveEvent";
import type { Trip, TripPricingTier } from "../../services/tripsService";

function tier(over: Partial<TripPricingTier> = {}): TripPricingTier {
  return {
    id: "tier_1",
    eventId: "trip_abc",
    ticketTypeId: "tt_1",
    tierName: "Standard",
    tierMetadata: {},
    priceCents: 12000,
    currency: "USD",
    quantityTotal: 20,
    ticketsRemaining: 5,
    isUnlimited: false,
    ...over,
  } as TripPricingTier;
}

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: "trip_abc",
    brandId: "brand_1",
    brandSlug: "travelbrand",
    title: "The DC Adventure",
    description: "A weekend in DC",
    slug: "the-dc-adventure",
    status: "scheduled",
    visibility: "public",
    publishedAt: "2026-06-01T00:00:00Z",
    timezone: "America/New_York",
    coverMediaUrl: null,
    coverMediaType: null,
    businessTrip: {
      startAt: "2026-09-10T12:00:00Z",
      endAt: "2026-09-12T20:00:00Z",
      destinationPlaceId: null,
      destinationLocationText: "Washington, DC",
      destinationLat: null,
      destinationLng: null,
      departurePlaceId: null,
      departureLocationText: null,
      departureLat: null,
      departureLng: null,
      capacity: 20,
    },
    days: [],
    pricingTiers: [tier()],
    inclusions: [],
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-15T00:00:00Z",
    refundPolicy: null,
    bookingDeadline: null,
    bookingsClosed: false,
    bookingsClosedAt: null,
    ticketsSoldCount: 24,
    ...over,
  } as Trip;
}

describe("tripToLiveEvent — fields the shared sub-screens consume", () => {
  test("returns null for a null trip (caller passes through)", () => {
    expect(tripToLiveEvent(null)).toBeNull();
  });

  test("maps identity + display fields the scanner/orders/recon screens read", () => {
    const le = tripToLiveEvent(trip())!;
    expect(le).not.toBeNull();
    expect(le.id).toBe("trip_abc");
    expect(le.brandId).toBe("brand_1");
    expect(le.brandSlug).toBe("travelbrand");
    expect(le.eventSlug).toBe("the-dc-adventure");
    expect(le.name).toBe("The DC Adventure");
    expect(le.currency).toBe("USD");
    expect(le.event_type).toBe("trip");
  });

  test("maps each pricing tier into a ticket stub (ticketTypeId preserved for scan/sold counts)", () => {
    const le = tripToLiveEvent(
      trip({ pricingTiers: [tier({ ticketTypeId: "tt_a" }), tier({ id: "tier_2", ticketTypeId: "tt_b" })] }),
    )!;
    expect(le.tickets.map((t) => t.id)).toEqual(["tt_a", "tt_b"]);
  });

  test("draft trip maps to a published-status scaffold (LiveEventStatus has no draft)", () => {
    const le = tripToLiveEvent(trip({ status: "draft" }))!;
    expect(["scheduled", "live", "ended", "cancelled"]).toContain(le.status);
  });

  test("cancelled + ended carry their lifecycle status through", () => {
    expect(tripToLiveEvent(trip({ status: "cancelled" }))!.status).toBe("cancelled");
    expect(tripToLiveEvent(trip({ status: "ended" }))!.status).toBe("ended");
  });

  test("null brandSlug degrades to empty string (sub-screens guard on length)", () => {
    const le = tripToLiveEvent(trip({ brandSlug: null }))!;
    expect(le.brandSlug).toBe("");
  });
});
