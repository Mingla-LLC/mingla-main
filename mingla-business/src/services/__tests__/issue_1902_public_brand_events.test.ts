import { beforeEach, expect, jest, test } from "@jest/globals";

const fromMock = jest.fn();
const rpcMock = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));
jest.mock(
  "@mingla/offering-rendering",
  () => ({
    isThemeAnimationSlug: () => false,
    isThemeColor: () => false,
    isThemeFontSlug: () => false,
    resolveEventAcquisitionState: (
      jest.requireActual(
        "../../../../packages/offering-rendering/eventAcquisitionLifecycle",
      ) as { resolveEventAcquisitionState: unknown }
    ).resolveEventAcquisitionState,
  }),
  { virtual: true },
);

import { fetchPublicBrandEvents } from "../publicEventsService";

const base = {
  brand_id: "brand-1",
  brand_slug: "brand",
  brand_name: "Brand",
  brand_description: null,
  brand_profile_photo_url: null,
  brand_display_attendee_count: true,
  brand_address: null,
  brand_cover_media_url: null,
  brand_theme_color: null,
  brand_theme_font: null,
  brand_theme_animation: null,
  description: "Description",
  location_text: "Venue",
  location_geo: null,
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
  published_at: "2026-01-01T00:00:00Z",
  timezone: "UTC",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  public_theme: {},
  theme_color_override: null,
  theme_font_override: null,
  theme_animation_override: null,
  master_start_at: "2099-01-01T18:00:00Z",
  master_end_at: "2099-01-01T20:00:00Z",
  master_timezone: "UTC",
  master_event_date_id: "date-1",
  currency: "USD",
  status: "scheduled",
};

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
});

test("production adapter admits current ticketed + RSVP rows and reads tickets only for ticketed", async () => {
  rpcMock.mockResolvedValue({ data: [], error: null } as never);
  const rows = [
    {
      ...base,
      id: "ticketed",
      slug: "ticketed",
      title: "Ticketed",
      event_type: "event",
    },
    { ...base, id: "rsvp", slug: "rsvp", title: "RSVP", event_type: "rsvp" },
    {
      ...base,
      id: "ended",
      slug: "ended",
      title: "Ended",
      event_type: "event",
      master_end_at: "2020-01-01T00:00:00Z",
    },
  ];
  const ticketEventIds: string[] = [];
  fromMock.mockImplementation(((table: string) => {
    if (table === "business_public_events_view") {
      const builder: Record<string, unknown> = {};
      builder.select = jest.fn(() => builder);
      builder.eq = jest.fn(() => builder);
      builder.order = jest.fn(() =>
        Promise.resolve({ data: rows, error: null }),
      );
      return builder;
    }
    if (table === "ticket_types") {
      const builder: Record<string, unknown> = {};
      builder.select = jest.fn(() => builder);
      builder.eq = jest.fn((field: string, value: unknown) => {
        if (field === "event_id") ticketEventIds.push(String(value));
        return builder;
      });
      builder.is = jest.fn(() => builder);
      builder.order = jest.fn(() =>
        Promise.resolve({
          data: [
            {
              id: "t",
              event_id: "ticketed",
              name: "Free",
              description: null,
              price_cents: 0,
              currency: "USD",
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
        }),
      );
      return builder;
    }
    throw new Error(`unexpected table ${table}`);
  }) as never);

  const result = await fetchPublicBrandEvents("brand");
  expect(result.map((row) => [row.id, row.event_type])).toEqual([
    ["ticketed", "event"],
    ["rsvp", "rsvp"],
  ]);
  expect(result[0]?.tickets).toHaveLength(1);
  expect(result[1]?.tickets).toHaveLength(0);
  expect(ticketEventIds).toEqual(["ticketed"]);
});
