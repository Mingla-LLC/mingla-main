import { beforeEach, expect, jest, test } from "@jest/globals";

const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock("../../services/supabase", () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));
jest.mock(
  "@mingla/offering-rendering",
  () => ({
    resolveTheme: () => ({
      color: "#000000",
      foregroundColor: "#ffffff",
      font: "inter",
      fontFamilyValue: "Inter",
      animation: "none",
    }),
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

import { fetchConsumerBrandBySlug } from "../useBrandBySlug";

const chain = (result: unknown) => {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in"])
    builder[method] = jest.fn(() => builder);
  builder.order = jest.fn(() => Promise.resolve(result));
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  return builder;
};

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
});

test("consumer production adapter reuses bundle tickets, preserves RSVP single-end, and never reads ticket_types", async () => {
  const brand = {
    id: "b",
    slug: "brand",
    name: "Brand",
    description: null,
    profile_photo_url: null,
    contact_email: null,
    contact_phone: null,
    social_links: null,
    custom_links: null,
    address: null,
    cover_hue: 25,
    cover_media_url: null,
    cover_media_type: null,
    theme_color: null,
    theme_font: null,
    theme_animation: null,
  };
  const base = {
    brand_id: "b",
    brand_slug: "brand",
    location_text: null,
    is_online: false,
    cover_media_url: null,
    cover_media_type: null,
    status: "scheduled",
    public_theme: null,
    currency: "USD",
    master_start_at: "2099-01-01T18:00:00Z",
    master_end_at: "2099-01-01T20:00:00Z",
    master_timezone: "UTC",
  };
  const events = [
    {
      ...base,
      id: "e",
      title: "Tickets",
      slug: "tickets",
      event_type: "event",
    },
    { ...base, id: "r", title: "RSVP", slug: "rsvp", event_type: "rsvp" },
  ];
  const ticketTableReads = jest.fn();
  mockFrom.mockImplementation(((table: string) => {
    if (table === "business_public_brands_view")
      return chain({ data: brand, error: null });
    if (table === "business_public_events_view")
      return chain({ data: events, error: null });
    if (table === "ticket_types") {
      ticketTableReads();
      return chain({ data: [], error: null });
    }
    throw new Error(`unexpected ${table}`);
  }) as never);
  mockRpc.mockImplementation(((name: string, args: Record<string, unknown>) => {
    if (
      name === "pg_public_trips_by_brand" ||
      name === "pg_public_experiences_by_brand" ||
      name === "pg_public_brand_upcoming"
    ) {
      return Promise.resolve({ data: [], error: null });
    }
    if (name !== "pg_direct_event_checkout_bundle") {
      throw new Error(`unexpected RPC ${name}`);
    }
    expect(args).toEqual({
      p_event_id: "e",
      p_brand_slug: null,
      p_event_slug: null,
    });
    return Promise.resolve({
      data: {
        id: "e",
        brandId: "b",
        brandSlug: "brand",
        eventSlug: "tickets",
        name: "Tickets",
        status: "scheduled",
        brand: { id: "b", slug: "brand", name: "Brand" },
        currency: "USD",
        occurrences: [
          {
            id: "occ-e",
            startAt: "2099-01-01T18:00:00Z",
            endAt: "2099-01-01T20:00:00Z",
            timezone: "UTC",
            isMaster: true,
          },
        ],
        tickets: [
          {
            id: "ticket-e",
            name: "Free",
            priceCents: 0,
            currency: "USD",
            isFree: true,
            isHidden: false,
            isDisabled: false,
            availableOnline: true,
            availableInPerson: false,
          },
        ],
      },
      error: null,
    });
  }) as never);
  const mockedOffering = jest.requireMock("@mingla/offering-rendering") as {
    forwardableAcquisitionState?: unknown;
  };
  mockedOffering.forwardableAcquisitionState = (
    jest.requireActual(
      "../../../../packages/offering-rendering/eventAcquisitionLifecycle",
    ) as { forwardableAcquisitionState: unknown }
  ).forwardableAcquisitionState;
  const result = await fetchConsumerBrandBySlug("brand");
  expect(
    result?.events.map((event) => [
      event.id,
      event.eventType,
      event.tickets.length,
      event.terminalSource.kind,
    ]),
  ).toEqual([
    ["e", "event", 1, "occurrences"],
    ["r", "rsvp", 0, "single_end"],
  ]);
  expect(
    mockRpc.mock.calls.filter(([name]) => name === "pg_direct_event_checkout_bundle"),
  ).toEqual([
    [
      "pg_direct_event_checkout_bundle",
      { p_event_id: "e", p_brand_slug: null, p_event_slug: null },
    ],
  ]);
  expect(ticketTableReads).not.toHaveBeenCalled();
});
