import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import {
  claimedVenueRowToBrand,
  getPublicEventBySlug,
  publicBrandViewRowToBrand,
} from "../publicEventsService";

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

const publicBrandRow = (
  patch: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: "brand-0962",
  slug: "orch-0962-brand",
  name: "ORCH 0962 Brand",
  description: null,
  profile_photo_url: null,
  contact_email: null,
  contact_phone: null,
  social_links: {},
  custom_links: [],
  display_attendee_count: true,
  kind: "popup",
  address: null,
  cover_hue: 25,
  cover_media_url: null,
  cover_media_type: null,
  profile_photo_type: null,
  created_at: "2026-05-25T00:00:00.000Z",
  updated_at: "2026-05-25T00:00:00.000Z",
  ...patch,
});

const claimedVenueRow = (
  patch: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: "venue-0962",
  slug: "orch-0962-venue",
  name: "ORCH 0962 Venue",
  description: null,
  profile_photo_url: null,
  profile_photo_type: null,
  contact_email: null,
  contact_phone: null,
  social_links: {},
  custom_links: [],
  display_attendee_count: false,
  address: "12 Old St",
  city: "London",
  country_code: "GB",
  lat: null,
  lng: null,
  cover_hue: 25,
  cover_media_url: null,
  cover_media_type: null,
  kind: "physical",
  venue_category: null,
  place_pool_id: null,
  google_place_id: null,
  created_at: "2026-05-25T00:00:00.000Z",
  updated_at: "2026-05-25T00:00:00.000Z",
  hours: [],
  pool_photo_urls: null,
  ...patch,
});

const eventRow = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "event-0962",
  brand_id: "brand-0962",
  brand_slug: "orch-0962-brand",
  brand_name: "ORCH 0962 Brand",
  brand_description: null,
  brand_profile_photo_url: null,
  brand_display_attendee_count: true,
  brand_kind: "popup",
  brand_address: null,
  brand_cover_media_url: null,
  title: "ORCH 0962 Event",
  description: null,
  slug: "orch-0962-event",
  location_text: null,
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
  currency: "GBP",
  visibility: "public",
  show_on_discover: true,
  status: "scheduled",
  published_at: "2026-05-25T00:00:00.000Z",
  timezone: "Europe/London",
  created_at: "2026-05-25T00:00:00.000Z",
  updated_at: "2026-05-25T00:00:00.000Z",
  public_theme: { business_event: {} },
  master_start_at: null,
  master_end_at: null,
  master_timezone: null,
  master_event_date_id: null,
  city: null,
  party_types: null,
  vibe_tags: null,
  music_genres: null,
  location_geo: null,
  ...patch,
});

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: [], error: null } as never);
});

describe("ORCH-0962 public brand mapper happy paths", () => {
  test("T-01 splits joined tagline and bio from the public brand view", () => {
    const brand = publicBrandViewRowToBrand(
      publicBrandRow({
        description: "Eat well, live well\n\nWe brunch hard.",
      }) as never,
    );

    expect(brand.tagline).toBe("Eat well, live well");
    expect(brand.bio).toBe("We brunch hard.");
  });

  test("T-02 produces contact when public contact fields are non-empty", () => {
    const brand = publicBrandViewRowToBrand(
      publicBrandRow({
        contact_email: "x@y.com",
        contact_phone: "+447700900312",
      }) as never,
    );

    expect(brand.contact).toEqual({
      email: "x@y.com",
      phone: "+447700900312",
    });
  });

  test("T-03 keeps contact undefined when both public contact fields are empty", () => {
    const brand = publicBrandViewRowToBrand(
      publicBrandRow({ contact_email: null, contact_phone: null }) as never,
    );

    expect(Object.prototype.hasOwnProperty.call(brand, "contact")).toBe(true);
    expect(brand.contact).toBeUndefined();
  });

  test("T-04 reads verified-venue displayAttendeeCount from the view row", () => {
    const brand = claimedVenueRowToBrand(
      claimedVenueRow({ display_attendee_count: true }) as never,
    );

    expect(brand.displayAttendeeCount).toBe(true);
  });

  test("T-05 event-detail brand context reads kind and address from the view row", async () => {
    const detail = await resolvePublicEventBrand({
      brand_kind: "physical",
      brand_address: "12 Old St",
    });

    expect(detail?.brand.kind).toBe("physical");
    expect(detail?.brand.address).toBe("12 Old St");
  });

  test("T-06 event-detail brand context reads cover media from the view row", async () => {
    const detail = await resolvePublicEventBrand({
      brand_cover_media_url: "https://cdn.example/cover.jpg",
    });

    expect(detail?.brand.coverMediaUrl).toBe("https://cdn.example/cover.jpg");
  });
});

async function resolvePublicEventBrand(patch: Record<string, unknown>) {
  const eventQuery = queryBuilder("maybeSingle", {
    data: eventRow(patch),
    error: null,
  });
  const typeQuery = queryBuilder("maybeSingle", {
    data: { event_type: "event" },
    error: null,
  });
  const ticketsQuery = queryBuilder("order", {
    data: [],
    error: null,
  });

  mockFrom.mockImplementation((table) => {
    if (table === "business_public_events_view") return eventQuery;
    if (table === "events") return typeQuery;
    if (table === "ticket_types") return ticketsQuery;
    throw new Error(`Unexpected table ${String(table)}`);
  });

  return getPublicEventBySlug("orch-0962-brand", "orch-0962-event");
}
