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

test("production adapter admits current ticketed + RSVP rows, reuses bundle tickets, and never reads ticket_types", async () => {
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
  const bundleEventIds: string[] = [];
  const ticketEventIds: string[] = [];
  rpcMock.mockImplementation(((name: string, args: { p_event_id?: string }) => {
    if (name !== "pg_direct_event_checkout_bundle") {
      throw new Error(`unexpected RPC ${name}`);
    }
    const id = args.p_event_id;
    if (id !== "ticketed" && id !== "ended") {
      throw new Error(`unexpected bundle event ${String(id)}`);
    }
    bundleEventIds.push(id);
    const future = id === "ticketed";
    return Promise.resolve({
      data: {
        id,
        brandId: "brand-1",
        brandSlug: "brand",
        eventSlug: id,
        name: id === "ticketed" ? "Ticketed" : "Ended",
        status: "scheduled",
        brand: { id: "brand-1", slug: "brand", name: "Brand" },
        currency: "USD",
        tickets:
          id === "ticketed"
            ? [
                {
                  id: "t",
                  name: "Free",
                  isFree: true,
                  isUnlimited: true,
                  availableOnline: true,
                  availableInPerson: false,
                  displayOrder: 0,
                },
              ]
            : [],
        occurrences: [
          {
            id: `${id}-day`,
            startAt: future
              ? "2099-01-01T18:00:00Z"
              : "2020-01-01T18:00:00Z",
            endAt: future
              ? "2099-01-01T20:00:00Z"
              : "2020-01-01T20:00:00Z",
            timezone: "UTC",
            isMaster: true,
          },
        ],
      },
      error: null,
    });
  }) as never);
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
      builder.order = jest.fn(() => Promise.resolve({ data: [], error: null }));
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
  expect(result[0]?.terminalSource.kind).toBe("occurrences");
  expect(result[1]?.terminalSource).toEqual({
    kind: "single_end",
    endAtUtc: "2099-01-01T20:00:00Z",
  });
  expect(bundleEventIds.sort()).toEqual(["ended", "ticketed"]);
  expect(ticketEventIds).toEqual([]);
});
