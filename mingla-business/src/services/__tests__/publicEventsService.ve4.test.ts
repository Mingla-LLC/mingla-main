import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { getPublicBrandBySlug } from "../publicEventsService";

const queryBuilder = <T,>(
  terminal: "maybeSingle" | "order",
  result: { data: T; error: Error | null },
) => {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    is: jest.fn(() => builder),
    order: jest.fn(() =>
      terminal === "order" ? Promise.resolve(result) : builder,
    ),
    maybeSingle: jest.fn(() =>
      terminal === "maybeSingle" ? Promise.resolve(result) : builder,
    ),
  };
  return builder;
};

const row = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "event-1",
  brand_id: "brand-1",
  brand_slug: "test-stripe",
  brand_name: "Test Stripe",
  brand_description: null,
  brand_profile_photo_url: null,
  brand_display_attendee_count: true,
  title: "Great Free Event",
  description: "A real public event.",
  slug: "great-free-event",
  event_type: "event",
  location_text: "Fallback venue",
  online_url: null,
  is_online: false,
  is_recurring: false,
  is_multi_date: false,
  recurrence_rules: null,
  cover_media_url: null,
  cover_media_type: null,
  cover_media_provider: null,
  cover_media_source_url: null,
  cover_media_credit: null,
  cover_media_credit_url: null,
  cover_media_alt: null,
  visibility: "public",
  show_on_discover: true,
  status: "scheduled",
  published_at: "2026-05-08T18:30:00.000Z",
  timezone: "Europe/London",
  master_start_at: "2026-05-08T19:00:00.000Z",
  master_end_at: "2026-05-08T21:30:00.000Z",
  master_timezone: "Europe/Paris",
  created_at: "2026-05-08T18:00:00.000Z",
  updated_at: "2026-05-08T18:30:00.000Z",
  public_theme: {
    business_event: {
      whenMode: "single",
      when: { date: "2026-05-08" },
    },
  },
  ...patch,
});

const brandRow = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "brand-1",
  slug: "brand-3",
  name: "Brand 3",
  description: "Tiny parties, big feelings.",
  profile_photo_url: "https://cdn.example.com/brand.png",
  social_links: { instagram: "@brand3" },
  custom_links: [{ label: "Menu", url: "https://brand.example.com/menu" }],
  display_attendee_count: false,
  address: "3 Brand Street",
  cover_hue: 180,
  cover_media_url: "https://cdn.example.com/cover.gif",
  cover_media_type: "gif",
  profile_photo_type: "image",
  claim_status: "verified",
  created_at: "2026-05-08T18:00:00.000Z",
  updated_at: "2026-05-08T18:30:00.000Z",
  ...patch,
});

const claimedVenueRow = (
  patch: Record<string, unknown> = {},
): Record<string, unknown> => ({
  ...brandRow({ display_attendee_count: undefined }),
  city: "London",
  country_code: "GB",
  lat: 51.5,
  lng: -0.12,
  venue_category: "restaurant",
  place_pool_id: "pool-1",
  google_place_id: "gp-1",
  hours: [
    {
      weekday: 0,
      open_time: "09:00",
      close_time: "17:00",
      is_closed: false,
    },
  ],
  pool_photo_urls: ["https://pool.example.com/a.jpg"],
  ...patch,
});

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: [], error: null } as never);
});

describe("Ve4 public brand lookup", () => {
  test("returns a verified physical venue with listing detail when no events exist", async () => {
    const claimedQuery = queryBuilder("maybeSingle", {
      data: claimedVenueRow(),
      error: null,
    });
    const eventsQuery = queryBuilder("order", {
      data: [],
      error: null,
    });
    const brandQuery = queryBuilder("maybeSingle", {
      data: brandRow(),
      error: null,
    });
    mockFrom.mockImplementation((table) => {
      if (table === "claimed_venues_public_view") return claimedQuery;
      if (table === "business_public_brands_view") return brandQuery;
      if (table === "business_public_events_view") return eventsQuery;
      throw new Error(`Unexpected table ${String(table)}`);
    });

    const detail = await getPublicBrandBySlug("brand-3");

    expect(detail).not.toBeNull();
    expect(detail?.brand).toMatchObject({
      id: "brand-1",
      displayName: "Brand 3",
      slug: "brand-3",
      claimStatus: "verified",
      city: "London",
      stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
    });
    expect(detail?.venue).toMatchObject({
      isVerifiedVenue: true,
      city: "London",
      venueCategory: "restaurant",
      galleryPhotoUrls: [
        "https://cdn.example.com/cover.gif",
        "https://cdn.example.com/brand.png",
      ],
    });
    expect(detail?.events).toEqual([]);
    expect(claimedQuery.eq).toHaveBeenCalledWith("slug", "brand-3");
    expect(brandQuery.eq).toHaveBeenCalledWith("slug", "brand-3");
    expect(eventsQuery.eq).toHaveBeenCalledWith("brand_slug", "brand-3");
    expect(mockFrom).toHaveBeenCalledTimes(3);
  });

  test("falls back to business_public_brands_view when claimed row is absent", async () => {
    const claimedQuery = queryBuilder("maybeSingle", {
      data: null,
      error: null,
    });
    const brandQuery = queryBuilder("maybeSingle", {
      data: brandRow(),
      error: null,
    });
    const eventsQuery = queryBuilder("order", {
      data: [],
      error: null,
    });
    mockFrom.mockImplementation((table) => {
      if (table === "claimed_venues_public_view") return claimedQuery;
      if (table === "business_public_brands_view") return brandQuery;
      if (table === "business_public_events_view") return eventsQuery;
      throw new Error(`Unexpected table ${String(table)}`);
    });

    const detail = await getPublicBrandBySlug("brand-3");

    expect(detail).not.toBeNull();
    expect(detail?.brand).toMatchObject({
      displayName: "Brand 3",
      displayAttendeeCount: false,
    });
    expect(detail?.venue).toBeNull();
    expect(mockFrom).toHaveBeenCalledTimes(3);
  });

  test("returns null only after claimed and business profile rows are missing", async () => {
    const claimedQuery = queryBuilder("maybeSingle", {
      data: null,
      error: null,
    });
    const brandQuery = queryBuilder("maybeSingle", {
      data: null,
      error: null,
    });
    mockFrom.mockImplementation((table) => {
      if (table === "claimed_venues_public_view") return claimedQuery;
      if (table === "business_public_brands_view") return brandQuery;
      throw new Error(`Unexpected table ${String(table)}`);
    });

    await expect(getPublicBrandBySlug("missing-brand")).resolves.toBeNull();
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  test("returns null venue detail for non-claimed popup brands", async () => {
    const claimedQuery = queryBuilder("maybeSingle", {
      data: null,
      error: null,
    });
    const brandQuery = queryBuilder("maybeSingle", {
      data: brandRow({ slug: "test-stripe", name: "Test Stripe" }),
      error: null,
    });
    const eventsQuery = queryBuilder("order", {
      data: [row()],
      error: null,
    });
    const eventTypesQuery = {
      select: jest.fn(() => eventTypesQuery),
      in: jest.fn(() =>
        Promise.resolve({
          data: [{ id: "event-1", event_type: "event" }],
          error: null,
        }),
      ),
    };
    const ticketsQuery = queryBuilder("order", {
      data: [
        {
          id: "ticket-1",
          event_id: "event-1",
          name: "General",
          description: null,
          price_cents: 0,
          currency: "GBP",
          quantity_total: null,
          is_unlimited: true,
          is_free: true,
          sale_start_at: null,
          sale_end_at: null,
          min_purchase_qty: 1,
          max_purchase_qty: null,
          is_hidden: false,
          is_disabled: false,
          requires_approval: false,
          allow_transfers: true,
          password_protected: false,
          available_online: true,
          available_in_person: false,
          waitlist_enabled: false,
          display_order: 0,
        },
      ],
      error: null,
    });
    mockFrom.mockImplementation((table) => {
      if (table === "claimed_venues_public_view") return claimedQuery;
      if (table === "business_public_brands_view") return brandQuery;
      if (table === "business_public_events_view") return eventsQuery;
      if (table === "events") return eventTypesQuery;
      if (table === "ticket_types") return ticketsQuery;
      throw new Error(`Unexpected table ${String(table)}`);
    });

    const detail = await getPublicBrandBySlug("test-stripe");

    expect(detail?.brand.displayName).toBe("Test Stripe");
    expect(detail?.venue).toBeNull();
    expect(detail?.brand.stats.events).toBe(1);
    expect(detail?.events).toHaveLength(1);
  });
});
