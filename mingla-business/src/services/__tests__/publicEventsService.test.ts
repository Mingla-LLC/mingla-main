import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import {
  getPublicBrandBySlug,
  publicBrandViewRowToBrand,
  publicEventViewRowToEvent,
} from "../publicEventsService";
import type { TicketStub } from "../../store/draftEventStore";

const queryBuilder = <T>(
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

// #1062 [biz-jest-residual-burndown] Wave 2 / B2 [TEST-MOD-APPROVED ORCH-1062]:
// ORCH-1186-C — getPublicBrandBySlug now fetches a DISPLAY-ONLY menu via
// fetchPublicMenus → from("public_menus_view").select().eq().order().order()
// (chained double .order, thenable terminal). Non-venue brands yield []. Route
// it so the bespoke mock resolves instead of throwing "Unexpected table".
const menusQuery = () => {
  const builder: Record<string, unknown> = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    order: jest.fn(() => builder),
    then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve),
  };
  return builder;
};

const ticket = (patch: Partial<TicketStub> = {}): TicketStub => ({
  id: "ticket-1",
  name: "General",
  priceGbp: null,
  capacity: null,
  isFree: true,
  isUnlimited: true,
  visibility: "public",
  displayOrder: 0,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  passwordConfigured: false,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
  availableAt: "online",
  ...patch,
});

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
    coverHue: 25,
    business_event: {
      format: "in_person",
      category: "music",
      whenMode: "single",
      when: {
        date: "2026-05-08",
        doorsOpen: "21:00",
        endsAt: "23:30",
        timezone: "Europe/Paris",
      },
      location: {
        venueName: "The Good Room",
        address: "1 Good Street",
      },
      settings: {
        requireApproval: true,
        allowTransfers: false,
        hideRemainingCount: true,
        passwordProtected: true,
        privateGuestList: true,
        inPersonPaymentsEnabled: true,
      },
    },
  },
  ...patch,
});

const brandRow = (
  patch: Record<string, unknown> = {},
): Record<string, unknown> => ({
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
  created_at: "2026-05-08T18:00:00.000Z",
  updated_at: "2026-05-08T18:30:00.000Z",
  ...patch,
});

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: [], error: null } as never);
});

describe("public event view mapper", () => {
  test("maps runtime business_event.when into buyer-facing event dates", () => {
    const event = publicEventViewRowToEvent(row() as never, [ticket()]);

    expect(event).toMatchObject({
      date: "2026-05-08",
      doorsOpen: "21:00",
      endsAt: "23:30",
      timezone: "Europe/Paris",
      format: "in_person",
      category: "music",
      venueName: "The Good Room",
      address: "1 Good Street",
      requireApproval: true,
      allowTransfers: false,
      hideRemainingCount: true,
      passwordProtected: true,
      privateGuestList: true,
      inPersonPaymentsEnabled: true,
    });
  });

  test("brand cards and checkout details receive the same mapped date shape", () => {
    const providerRow = row({
      cover_media_url: "https://media.giphy.com/media/event/giphy.gif",
      cover_media_type: "gif",
      cover_media_provider: "giphy",
      cover_media_source_url: "https://giphy.com/gifs/event",
      cover_media_credit: "GIPHY",
      cover_media_credit_url: "https://giphy.com",
      cover_media_alt: "Looping party GIF",
    });
    const brandEvent = publicEventViewRowToEvent(providerRow as never, [
      ticket(),
    ]);
    const checkoutEvent = publicEventViewRowToEvent(providerRow as never, [
      ticket(),
    ]);

    expect(brandEvent.date).toBe("2026-05-08");
    expect(brandEvent.doorsOpen).toBe("21:00");
    expect(checkoutEvent.date).toBe(brandEvent.date);
    expect(checkoutEvent.doorsOpen).toBe(brandEvent.doorsOpen);
    expect(brandEvent.coverMediaProvider).toBe("giphy");
    expect(checkoutEvent.coverMediaCredit).toBe("GIPHY");
    expect(checkoutEvent.coverMediaAlt).toBe("Looping party GIF");
  });

  test("preserves recurring and multi-date payloads", () => {
    const recurringRule = {
      frequency: "weekly",
      interval: 1,
      count: 4,
      byWeekday: ["FR"],
    };
    const multiDates = [
      { id: "date-1", date: "2026-05-08", startTime: "21:00" },
      { id: "date-2", date: "2026-05-09", startTime: "20:00" },
    ];

    const event = publicEventViewRowToEvent(
      row({
        is_recurring: true,
        is_multi_date: true,
        public_theme: {
          business_event: {
            whenMode: "multi_date",
            when: { date: "2026-05-08", timezone: "Europe/London" },
            recurrenceRule: recurringRule,
            multiDates,
          },
        },
      }) as never,
      [ticket()],
    );

    expect(event.whenMode).toBe("multi_date");
    expect(event.recurrenceRule).toEqual(recurringRule);
    expect(event.multiDates).toEqual(multiDates);
  });

  test("keeps Date TBD when the saved public payload lacks a valid date", () => {
    const event = publicEventViewRowToEvent(
      row({
        master_start_at: null,
        master_end_at: null,
        master_timezone: null,
        public_theme: {
          business_event: {
            whenMode: "single",
            when: { date: "not-a-date" },
          },
        },
      }) as never,
      [ticket()],
    );

    expect(event.date).toBeNull();
  });
});

describe("public brand lookup", () => {
  test("returns a real empty brand instead of null when no public event rows exist", async () => {
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
      if (table === "public_menus_view") return menusQuery();
      throw new Error(`Unexpected table ${String(table)}`);
    });

    const detail = await getPublicBrandBySlug("brand-3");

    expect(detail).not.toBeNull();
    expect(detail?.brand).toMatchObject({
      id: "brand-1",
      displayName: "Brand 3",
      slug: "brand-3",
      address: "3 Brand Street",
      coverHue: 180,
      coverMediaUrl: "https://cdn.example.com/cover.gif",
      coverMediaType: "gif",
      profilePhotoType: "image",
      photo: "https://cdn.example.com/brand.png",
      bio: "Tiny parties, big feelings.",
      displayAttendeeCount: false,
      stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
    });
    expect(detail?.brand.links).toEqual({
      instagram: "@brand3",
      custom: [{ label: "Menu", url: "https://brand.example.com/menu" }],
    });
    expect(detail?.events).toEqual([]);
    expect(brandQuery.eq).toHaveBeenCalledWith("slug", "brand-3");
    expect(eventsQuery.eq).toHaveBeenCalledWith("brand_slug", "brand-3");
    // [TEST-MOD-APPROVED ORCH-1365] Brand pages no longer aggregate venue
    // menus. An exact venue route owns the public_menus_view read.
    expect(mockFrom).toHaveBeenCalledTimes(3);
    expect(mockFrom).not.toHaveBeenCalledWith("public_menus_view");
  });

  test("returns null only when the brand profile row is missing", async () => {
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

  test("keeps populated brand events and hydrates tickets from the canonical direct bundle", async () => {
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
    mockRpc.mockImplementation((name, args) => {
      if (name === "pg_direct_event_checkout_bundle") {
        expect(args).toEqual({
          p_event_id: "event-1",
          p_brand_slug: null,
          p_event_slug: null,
        });
        return Promise.resolve({
          data: {
            id: "event-1",
            brandId: "brand-1",
            brandSlug: "test-stripe",
            eventSlug: "great-free-event",
            name: "Great Free Event",
            status: "scheduled",
            brand: { id: "brand-1", slug: "test-stripe", name: "Test Stripe" },
            currency: "GBP",
            timezone: "Europe/Paris",
            masterStartAt: "2099-01-01T18:00:00Z",
            masterEndAt: "2099-01-01T20:00:00Z",
            occurrences: [
              {
                id: "occurrence-1",
                startAt: "2099-01-01T18:00:00Z",
                endAt: "2099-01-01T20:00:00Z",
                timezone: "Europe/Paris",
                isMaster: true,
              },
            ],
            tickets: [
              {
                id: "ticket-1",
                name: "General",
                isFree: true,
                isUnlimited: true,
                availableOnline: true,
                availableInPerson: false,
                priceCents: 0,
                currency: "GBP",
              },
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });
    mockFrom.mockImplementation((table) => {
      if (table === "claimed_venues_public_view") return claimedQuery;
      if (table === "business_public_brands_view") return brandQuery;
      if (table === "business_public_events_view") return eventsQuery;
      if (table === "events") return eventTypesQuery;
      if (table === "public_menus_view") return menusQuery();
      throw new Error(`Unexpected table ${String(table)}`);
    });

    const detail = await getPublicBrandBySlug("test-stripe");

    expect(detail?.brand.displayName).toBe("Test Stripe");
    expect(detail?.brand.stats.events).toBe(1);
    expect(detail?.events).toHaveLength(1);
    expect(detail?.events[0]).toMatchObject({
      id: "event-1",
      brandSlug: "test-stripe",
      eventSlug: "great-free-event",
      tickets: [expect.objectContaining({ id: "ticket-1", name: "General" })],
      terminalSource: { kind: "occurrences" },
    });
    expect(mockRpc).toHaveBeenCalledWith("pg_direct_event_checkout_bundle", {
      p_event_id: "event-1",
      p_brand_slug: null,
      p_event_slug: null,
    });
    expect(mockFrom).not.toHaveBeenCalledWith("ticket_types");
  });
});

describe("public brand view mapper", () => {
  test("preserves public brand profile fields from the brand view", () => {
    expect(publicBrandViewRowToBrand(brandRow() as never, 4)).toMatchObject({
      displayName: "Brand 3",
      address: "3 Brand Street",
      coverHue: 180,
      coverMediaUrl: "https://cdn.example.com/cover.gif",
      coverMediaType: "gif",
      profilePhotoType: "image",
      links: {
        instagram: "@brand3",
        custom: [{ label: "Menu", url: "https://brand.example.com/menu" }],
      },
      displayAttendeeCount: false,
      stats: { events: 4, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
    });
  });
});

describe("ORCH-0962 public brand migration", () => {
  test("exposes contact fields without leaking internal brand fields", () => {
    const sql = readFileSync(
      path.join(
        __dirname,
        "../../../..",
        "supabase/migrations/20260727000003_orch_0962_brand_field_render_truthful.sql",
      ),
      "utf8",
    );
    const businessBrandViewSql = sql.slice(
      sql.indexOf("CREATE OR REPLACE VIEW public.business_public_brands_view"),
      sql.indexOf("COMMENT ON VIEW public.business_public_brands_view"),
    );

    expect(businessBrandViewSql).toContain(
      "CREATE OR REPLACE VIEW public.business_public_brands_view",
    );
    expect(businessBrandViewSql).toContain("slug");
    expect(businessBrandViewSql).toContain("cover_media_url");
    expect(businessBrandViewSql).toMatch(/\bcontact_email\b/);
    expect(businessBrandViewSql).toMatch(/\bcontact_phone\b/);
    expect(sql).toContain("GRANT SELECT ON public.business_public_brands_view");
    expect(businessBrandViewSql).not.toMatch(/\baccount_id\b/);
    expect(businessBrandViewSql).not.toMatch(/\btax_settings\b/);
    expect(businessBrandViewSql).not.toMatch(/\bdefault_currency\b/);
    expect(businessBrandViewSql).not.toMatch(/\bstripe_/);
  });
});
