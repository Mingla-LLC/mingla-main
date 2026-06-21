/**
 * ORCH-0876 [Trip CRUD + Purchase Flow Completion] — implementor happy-path
 * regression test per ORCH-0840 [Regression-test enforcement + append-only CI].
 *
 * Tests the client-side UX fast-path mirror of `biz_update_live_trip` RPC's
 * 8-path refund-gate (`src/utils/publishedTripEditGuards.ts`).
 *
 * Server is canonical; this guard pre-flights destructive intent to avoid the
 * 800ms RPC round-trip when the patch is provably bad. Every server-side
 * rejection reason MUST be mirrored here, or the operator sees a delayed
 * dialog instead of an immediate one.
 *
 * Mirror of `publishedEventEditGuards.test.ts` shape.
 */

import { describe, expect, test } from "@jest/globals";

import type { Trip } from "../../services/tripsService";
import { validateLiveTripFieldUpdate } from "../publishedTripEditGuards";

const trip = (patch: Partial<Trip> = {}): Trip => ({
  id: "trip-1",
  brandId: "brand-1",
  brandSlug: "tulum-yoga-co",
  title: "Tulum Yoga Retreat",
  description: "A trip.",
  slug: "tulum-yoga-march-2026",
  status: "live",
  visibility: "public",
  publishedAt: "2026-05-01T10:00:00.000Z",
  timezone: "America/Cancun",
  coverMediaUrl: null,
  coverMediaType: null,
  businessTrip: {
    startAt: "2026-06-10T00:00:00.000Z",
    endAt: "2026-06-14T23:59:59.000Z",
    destinationPlaceId: "place-1",
    destinationLocationText: "Tulum, Quintana Roo, Mexico",
    destinationLat: 20.2114,
    destinationLng: -87.4654,
    departurePlaceId: null,
    departureLocationText: null,
    departureLat: null,
    departureLng: null,
    capacity: 12,
  },
  days: [
    { id: "day-1", eventId: "trip-1", ordinal: 1, title: "Arrival", narrative: null, date: null, stops: [], media: [] },
    { id: "day-2", eventId: "trip-1", ordinal: 2, title: "Day 2", narrative: null, date: null, stops: [], media: [] },
  ],
  pricingTiers: [
    {
      id: "tier-1",
      eventId: "trip-1",
      ticketTypeId: "ticket-1",
      tierName: "Standard",
      tierMetadata: {},
      priceCents: 150000,
      currency: "USD",
      quantityTotal: 12,
      ticketsRemaining: null,
      isUnlimited: false,
      installmentSchedule: null,
      // [TEST-MOD-APPROVED META-ORCH-1174] — TripPricingTier gained `description`.
      description: null,
    },
  ],
  inclusions: [
    { id: "inc-1", eventId: "trip-1", kind: "included", item: "Lodging", ordinal: 0 },
    { id: "inc-2", eventId: "trip-1", kind: "included", item: "Breakfast", ordinal: 1 },
  ],
  createdAt: "2026-05-01T10:00:00.000Z",
  updatedAt: "2026-05-01T10:00:00.000Z",
  refundPolicy: null,
  bookingDeadline: null,
  bookingsClosed: false,
  bookingsClosedAt: null,
  ticketsSoldCount: 0,
  ...patch,
});

describe("ORCH-0876 — published trip edit guards (client-side fast-path)", () => {
  test("rejects missing reason with reason='missing_edit_reason'", () => {
    const result = validateLiveTripFieldUpdate(
      trip(),
      { title: "New title" },
      { "ticket-1": 0 },
      0,
      "",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("missing_edit_reason");
  });

  test("rejects reason shorter than 10 chars with reason='invalid_edit_reason'", () => {
    const result = validateLiveTripFieldUpdate(
      trip(),
      { title: "New title" },
      { "ticket-1": 0 },
      0,
      "too short",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("invalid_edit_reason");
  });

  test("rejects reason longer than 200 chars with reason='invalid_edit_reason'", () => {
    const result = validateLiveTripFieldUpdate(
      trip(),
      { title: "New title" },
      { "ticket-1": 0 },
      0,
      "x".repeat(201),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("invalid_edit_reason");
  });

  test("rejects when trip.status is not editable", () => {
    const result = validateLiveTripFieldUpdate(
      trip({ status: "ended" }),
      { title: "New title" },
      { "ticket-1": 0 },
      0,
      "Updating title for clarity",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("trip_not_editable_status");
  });

  test("rejects capacity below confirmed sold count with affectedOrderCount", () => {
    const result = validateLiveTripFieldUpdate(
      trip(),
      { theme: { business_trip: { capacity: 5 } } },
      { "ticket-1": 7 },
      7,
      "Reducing capacity to free up spots",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("capacity_below_sold");
    expect(result.affectedOrderCount).toBe(7);
  });

  test("rejects date shift when at least one confirmed order exists", () => {
    const result = validateLiveTripFieldUpdate(
      trip(),
      { theme: { business_trip: { startAt: "2026-07-10T00:00:00.000Z" } } },
      { "ticket-1": 3 },
      3,
      "Shifting trip to a later month",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("dates_shifted_with_sales");
    expect(result.affectedOrderCount).toBe(3);
  });

  test("rejects day drop when at least one confirmed order exists", () => {
    const result = validateLiveTripFieldUpdate(
      trip(),
      {
        days: [
          { ordinal: 1, title: "Arrival" },
          // ordinal 2 removed
        ],
      },
      { "ticket-1": 2 },
      2,
      "Removing day 2 from the itinerary",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("days_dropped_with_sales");
    expect(result.affectedOrderCount).toBe(2);
    expect(result.droppedDates).toEqual(["2"]);
  });

  test("rejects inclusion removal when at least one confirmed order exists", () => {
    const result = validateLiveTripFieldUpdate(
      trip(),
      {
        inclusions: [
          { kind: "included", item: "Lodging", ordinal: 0 },
          // "Breakfast" removed
        ],
      },
      { "ticket-1": 1 },
      1,
      "Dropping breakfast from inclusions",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("inclusions_removed_with_sales");
    expect(result.affectedOrderCount).toBe(1);
    expect(result.droppedInclusions).toEqual(["included:Breakfast"]);
  });

  test("rejects tier delete when sold > 0 for that tier", () => {
    const result = validateLiveTripFieldUpdate(
      trip(),
      { pricing_tiers: [] },
      { "ticket-1": 3 },
      3,
      "Deleting the standard tier",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("tier_delete_with_sales");
    expect(result.affectedOrderCount).toBe(3);
  });

  test("rejects tier price change when sold > 0 for that tier", () => {
    const result = validateLiveTripFieldUpdate(
      trip(),
      {
        pricing_tiers: [
          {
            ticket_type_id: "ticket-1",
            price_cents: 200000,
          },
        ],
      },
      { "ticket-1": 2 },
      2,
      "Bumping the price for the next sale wave",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("tier_price_change_with_sales");
    expect(result.affectedOrderCount).toBe(2);
  });

  test("accepts additive patch (cover-only) with valid reason and zero sold", () => {
    const result = validateLiveTripFieldUpdate(
      trip(),
      {
        cover_media_url: "https://cdn.example.com/new.jpg",
        cover_media_type: "image",
      },
      { "ticket-1": 0 },
      0,
      "Refreshing the trip cover image",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.trimmedReason).toBe("Refreshing the trip cover image");
  });

  test("accepts additive patch (inclusion ADD) even when sold > 0", () => {
    const result = validateLiveTripFieldUpdate(
      trip(),
      {
        inclusions: [
          { kind: "included", item: "Lodging", ordinal: 0 },
          { kind: "included", item: "Breakfast", ordinal: 1 },
          { kind: "included", item: "Yoga sessions", ordinal: 2 }, // new
        ],
      },
      { "ticket-1": 3 },
      3,
      "Adding yoga to included inclusions",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.trimmedReason).toBe("Adding yoga to included inclusions");
  });

  test("accepts capacity increase even when sold > 0", () => {
    const result = validateLiveTripFieldUpdate(
      trip(),
      { theme: { business_trip: { capacity: 16 } } },
      { "ticket-1": 5 },
      5,
      "Opening up four more spots after pop-up",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.trimmedReason).toBe(
      "Opening up four more spots after pop-up",
    );
  });

  test("trims surrounding whitespace from the reason on accept", () => {
    const result = validateLiveTripFieldUpdate(
      trip(),
      { title: "New title" },
      { "ticket-1": 0 },
      0,
      "   Updating the trip title to be clearer   ",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.trimmedReason).toBe("Updating the trip title to be clearer");
  });
});
