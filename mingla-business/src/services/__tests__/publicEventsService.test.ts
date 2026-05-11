import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const mockFrom = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import {
  getPublicBrandBySlug,
  publicBrandViewRowToBrand,
  publicEventViewRowToEvent,
} from "../publicEventsService";
import type { TicketStub } from "../../store/draftEventStore";

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

const brandRow = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "brand-1",
  slug: "brand-3",
  name: "Brand 3",
  description: "Tiny parties, big feelings.",
  profile_photo_url: "https://cdn.example.com/brand.png",
  social_links: { instagram: "@brand3" },
  custom_links: [{ label: "Menu", url: "https://brand.example.com/menu" }],
  display_attendee_count: false,
  kind: "physical",
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
    const brandEvent = publicEventViewRowToEvent(providerRow as never, [ticket()]);
    const checkoutEvent = publicEventViewRowToEvent(providerRow as never, [ticket()]);

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
    const brandQuery = queryBuilder("maybeSingle", {
      data: brandRow(),
      error: null,
    });
    const eventsQuery = queryBuilder("order", {
      data: [],
      error: null,
    });
    mockFrom.mockImplementation((table) => {
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
      kind: "physical",
      address: "3 Brand Street",
      coverHue: 180,
      coverMediaUrl: "https://cdn.example.com/cover.gif",
      coverMediaType: "gif",
      profilePhotoType: "image",
      photo: "https://cdn.example.com/brand.png",
      bio: "Tiny parties, big feelings.",
      displayAttendeeCount: false,
      stats: { events: 0, followers: 0, rev: 0, attendees: 0 },
    });
    expect(detail?.brand.links).toEqual({
      instagram: "@brand3",
      custom: [{ label: "Menu", url: "https://brand.example.com/menu" }],
    });
    expect(detail?.events).toEqual([]);
    expect(brandQuery.eq).toHaveBeenCalledWith("slug", "brand-3");
    expect(eventsQuery.eq).toHaveBeenCalledWith("brand_slug", "brand-3");
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  test("returns null only when the brand profile row is missing", async () => {
    const brandQuery = queryBuilder("maybeSingle", {
      data: null,
      error: null,
    });
    mockFrom.mockImplementation((table) => {
      if (table === "business_public_brands_view") return brandQuery;
      throw new Error(`Unexpected table ${String(table)}`);
    });

    await expect(getPublicBrandBySlug("missing-brand")).resolves.toBeNull();
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  test("keeps populated brand events and ticket fetches public-event-backed", async () => {
    const brandQuery = queryBuilder("maybeSingle", {
      data: brandRow({ slug: "test-stripe", name: "Test Stripe" }),
      error: null,
    });
    const eventsQuery = queryBuilder("order", {
      data: [row()],
      error: null,
    });
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
      if (table === "business_public_brands_view") return brandQuery;
      if (table === "business_public_events_view") return eventsQuery;
      if (table === "ticket_types") return ticketsQuery;
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
    });
    expect(ticketsQuery.eq).toHaveBeenCalledWith("event_id", "event-1");
  });
});

describe("public brand view mapper", () => {
  test("preserves public brand profile fields from the brand view", () => {
    expect(publicBrandViewRowToBrand(brandRow() as never, 4)).toMatchObject({
      displayName: "Brand 3",
      kind: "physical",
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
      stats: { events: 4, followers: 0, rev: 0, attendees: 0 },
    });
  });
});

describe("ORCH-0767 public brand migration", () => {
  test("exposes only the field-limited public brand read model", () => {
    const sql = readFileSync(
      path.join(
        __dirname,
        "../../../..",
        "supabase/migrations/20260515000008_orch_0767_public_brand_profile_view.sql",
      ),
      "utf8",
    );

    expect(sql).toContain("CREATE OR REPLACE VIEW public.business_public_brands_view");
    expect(sql).toContain("b.slug");
    expect(sql).toContain("b.cover_media_url");
    expect(sql).toContain("GRANT SELECT ON public.business_public_brands_view");
    expect(sql).not.toMatch(/\baccount_id\b/);
    expect(sql).not.toMatch(/\bcontact_email\b/);
    expect(sql).not.toMatch(/\bcontact_phone\b/);
    expect(sql).not.toMatch(/\btax_settings\b/);
    expect(sql).not.toMatch(/\bdefault_currency\b/);
    expect(sql).not.toMatch(/\bstripe_/);
  });
});
