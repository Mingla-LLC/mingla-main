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

test("consumer production adapter admits RSVP and excludes its id from ticket reads", async () => {
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
  const ticketIn = jest.fn();
  mockFrom.mockImplementation(((table: string) => {
    if (table === "business_public_brands_view")
      return chain({ data: brand, error: null });
    if (table === "business_public_events_view")
      return chain({ data: events, error: null });
    if (table === "ticket_types") {
      const builder: Record<string, unknown> = {};
      builder.select = jest.fn(() => builder);
      builder.in = ticketIn.mockImplementation(((
        _field: string,
        ids: string[],
      ) => {
        expect(ids).toEqual(["e"]);
        return builder;
      }) as never);
      builder.is = jest.fn(() =>
        Promise.resolve({
          data: [
            {
              event_id: "e",
              price_cents: 0,
              currency: "USD",
              is_free: true,
              is_hidden: false,
              available_online: true,
            },
          ],
          error: null,
        }),
      );
      return builder;
    }
    throw new Error(`unexpected ${table}`);
  }) as never);
  mockRpc.mockResolvedValue({ data: [], error: null } as never);
  const result = await fetchConsumerBrandBySlug("brand");
  expect(
    result?.events.map((event) => [
      event.id,
      event.eventType,
      event.tickets.length,
    ]),
  ).toEqual([
    ["e", "event", 1],
    ["r", "rsvp", 0],
  ]);
  expect(ticketIn).toHaveBeenCalledTimes(1);
});
