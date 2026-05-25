/* eslint-disable import/first */
/**
 * ORCH-0963 [Public brand page business-case optimization] T-02 happy-path.
 *
 * Verifies the service-layer trip-fetch path:
 *   - `pg_public_trips_by_brand` RPC is called via supabase.rpc with the slug param
 *   - Snake_case rows are mapped to camelCase PublicTripCard shape
 *   - getPublicBrandBySlug dispatches on brand.kind='trip_planner' →
 *     populates `trips` array and leaves `events` empty
 *
 * Fails-on-revert: if `getPublicBrandBySlug` reverts the dispatch (always calls
 * `fetchPublicBrandEvents`), the `trips` field stays [] for a trip-planner
 * brand and T-02c FAILs.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpcMock = jest.fn() as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromMock = jest.fn() as any;

jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (table: string) => fromMock(table),
  },
}));

// Stub transitively-imported react-native modules for Node test runtime.
jest.mock("expo-image", () => ({}), { virtual: true });

import {
  getPublicBrandBySlug,
  tripRowToCard,
  type PublicTripCardRow,
} from "../publicEventsService";

const TRAVELBRAND_ROW = {
  id: "brand-uuid-travelbrand",
  slug: "travelbrand",
  name: "Travel Brand",
  description: null,
  profile_photo_url: null,
  social_links: {},
  custom_links: [],
  display_attendee_count: false,
  kind: "trip_planner" as const,
  address: null,
  cover_hue: 200,
  cover_media_url: null,
  cover_media_type: null,
  profile_photo_type: null,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
};

const TRIP_FIXTURE_THE_SONE: PublicTripCardRow = {
  trip_id: "743ad25b-9075-4738-aef6-43a0a6c2ffd1",
  trip_slug: "the-sone",
  brand_slug: "travelbrand",
  title: "The Sone",
  description: null,
  destination_text: "Tulum, Quintana Roo, Mexico",
  cover_media_url: "https://example.com/sone.jpg",
  cover_media_type: "image",
  status: "scheduled",
  start_at: "2026-09-19T00:00:00Z",
  end_at: "2026-09-22T23:59:59Z",
  timezone: "America/Mexico_City",
  bookings_closed: false,
  total_capacity: 200,
  tickets_sold: 0,
  spots_left: 200,
  min_price_cents: 50000,
  currency: "GBP",
  has_free_tier: false,
  published_at: "2026-05-01T00:00:00Z",
};

const TRIP_FIXTURE_DC: PublicTripCardRow = {
  trip_id: "060d0483-50db-48d1-840b-73d9fc59356a",
  trip_slug: "the-dc-adventure",
  brand_slug: "travelbrand",
  title: "The DC Adventure",
  description: null,
  destination_text: "Washington DC, USA",
  cover_media_url: "https://example.com/dc.jpg",
  cover_media_type: "image",
  status: "scheduled",
  start_at: "2026-08-17T00:00:00Z",
  end_at: "2026-08-22T23:59:59Z",
  timezone: "America/New_York",
  bookings_closed: false,
  total_capacity: 102,
  tickets_sold: 81,
  spots_left: 21,
  min_price_cents: 50000,
  currency: "GBP",
  has_free_tier: false,
  published_at: "2026-05-01T00:00:00Z",
};

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
});

describe("ORCH-0963 T-02 — public trips by brand fetch path", () => {
  test("T-02a tripRowToCard maps snake_case → camelCase with all 20 fields", () => {
    const card = tripRowToCard(TRIP_FIXTURE_DC);
    expect(card).toEqual({
      id: "060d0483-50db-48d1-840b-73d9fc59356a",
      slug: "the-dc-adventure",
      brandSlug: "travelbrand",
      title: "The DC Adventure",
      description: null,
      destinationText: "Washington DC, USA",
      coverMediaUrl: "https://example.com/dc.jpg",
      coverMediaType: "image",
      status: "scheduled",
      startAt: "2026-08-17T00:00:00Z",
      endAt: "2026-08-22T23:59:59Z",
      timezone: "America/New_York",
      bookingsClosed: false,
      totalCapacity: 102,
      ticketsSold: 81,
      spotsLeft: 21,
      minPriceCents: 50000,
      currency: "GBP",
      hasFreeTier: false,
      publishedAt: "2026-05-01T00:00:00Z",
    });
  });

  test("T-02b spotsLeft preserved when null (unlimited capacity)", () => {
    const unlimitedRow: PublicTripCardRow = {
      ...TRIP_FIXTURE_THE_SONE,
      total_capacity: null,
      tickets_sold: 0,
      spots_left: null,
    };
    const card = tripRowToCard(unlimitedRow);
    expect(card.spotsLeft).toBeNull();
    expect(card.totalCapacity).toBeNull();
  });

  test("T-02c getPublicBrandBySlug dispatches on trip_planner kind → trips populated, events empty", async () => {
    // Verified-venue lookup (claimed_venues_public_view) returns null
    // for non-physical brands.
    const claimedVenueMaybeSingle = jest
      .fn<() => Promise<{ data: null; error: null }>>()
      .mockResolvedValue({ data: null, error: null });
    // Generic brand view returns the trip-planner brand row.
    const brandMaybeSingle = jest
      .fn<() => Promise<{ data: typeof TRAVELBRAND_ROW; error: null }>>()
      .mockResolvedValue({ data: TRAVELBRAND_ROW, error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === "claimed_venues_public_view") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: claimedVenueMaybeSingle }),
          }),
        };
      }
      if (table === "business_public_brands_view") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: brandMaybeSingle }),
          }),
        };
      }
      throw new Error(`unexpected from(${table}) call in T-02c`);
    });
    // pg_public_trips_by_brand returns the 2 trip rows.
    rpcMock.mockResolvedValue({
      data: [TRIP_FIXTURE_DC, TRIP_FIXTURE_THE_SONE],
      error: null,
    });

    const detail = await getPublicBrandBySlug("travelbrand");
    expect(detail).not.toBeNull();
    expect(detail!.brand.kind).toBe("trip_planner");
    expect(detail!.events).toEqual([]);
    expect(detail!.trips).toHaveLength(2);
    expect(detail!.trips[0].slug).toBe("the-dc-adventure");
    expect(detail!.trips[0].spotsLeft).toBe(21);
    expect(detail!.trips[1].slug).toBe("the-sone");
    expect(detail!.trips[1].spotsLeft).toBe(200);
    // Verify the RPC was called with the slug param
    expect(rpcMock).toHaveBeenCalledWith("pg_public_trips_by_brand", {
      p_brand_slug: "travelbrand",
    });
  });

  test("T-02d getPublicBrandBySlug for popup brand does NOT call the trips RPC", async () => {
    const popupBrandRow = {
      ...TRAVELBRAND_ROW,
      slug: "leggothis",
      name: "Leggo This",
      kind: "popup" as const,
    };
    const claimedVenueMaybeSingle = jest
      .fn<() => Promise<{ data: null; error: null }>>()
      .mockResolvedValue({ data: null, error: null });
    const brandMaybeSingle = jest
      .fn<() => Promise<{ data: typeof popupBrandRow; error: null }>>()
      .mockResolvedValue({ data: popupBrandRow, error: null });
    // Mock fetchPublicBrandEvents via its underlying calls: from("business_public_events_view")
    // returns empty (test focus is RPC NON-call, not the events shape).
    const eventsViewMock = jest.fn().mockReturnValue({
      select: () => ({
        eq: () => ({
          order: jest
            .fn<() => Promise<{ data: never[]; error: null }>>()
            .mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });
    fromMock.mockImplementation((table: string) => {
      if (table === "claimed_venues_public_view") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: claimedVenueMaybeSingle }),
          }),
        };
      }
      if (table === "business_public_brands_view") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: brandMaybeSingle }),
          }),
        };
      }
      if (table === "business_public_events_view") {
        return eventsViewMock();
      }
      throw new Error(`unexpected from(${table}) call in T-02d`);
    });

    const detail = await getPublicBrandBySlug("leggothis");
    expect(detail).not.toBeNull();
    expect(detail!.brand.kind).toBe("popup");
    expect(detail!.trips).toEqual([]);
    // T-02d core assertion: pg_public_trips_by_brand RPC was NOT called for a popup brand
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
