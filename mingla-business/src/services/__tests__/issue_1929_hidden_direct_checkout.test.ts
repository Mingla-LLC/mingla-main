import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const rpcMock = jest.fn() as ReturnType<typeof jest.fn>;
const fromMock = jest.fn() as ReturnType<typeof jest.fn>;
jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}));
jest.mock(
  "@mingla/offering-rendering",
  () => ({
    isThemeAnimationSlug: () => false,
    isThemeColor: () => false,
    isThemeFontSlug: () => false,
  }),
  { virtual: true },
);

import { getPublicEventById, getPublicEventBySlug } from "../publicEventsService";

const bundle = (patch: Record<string, unknown> = {}) => ({
  id: "event-1929",
  brandId: "brand-1929",
  brandSlug: "brand-1929",
  eventSlug: "event-1929",
  name: "Direct event",
  description: "Exact-key event",
  status: "scheduled",
  currency: "USD",
  tickets: [],
  brand: { id: "brand-1929", slug: "brand-1929", name: "Brand 1929" },
  ...patch,
});

const rsvpRow = {
  id: "rsvp-1929",
  brand_id: "brand-1929",
  brand_slug: "brand-1929",
  brand_name: "Brand 1929",
  brand_description: null,
  brand_profile_photo_url: null,
  brand_display_attendee_count: false,
  brand_address: null,
  brand_cover_media_url: null,
  brand_theme_color: null,
  brand_theme_font: null,
  brand_theme_animation: null,
  title: "RSVP",
  description: null,
  slug: "rsvp-1929",
  event_type: "rsvp",
  location_text: null,
  online_url: null,
  is_online: false,
  is_recurring: false,
  is_multi_date: false,
  recurrence_rules: null,
  cover_media_url: null,
  cover_media_type: null,
  cover_media_gallery: [],
  cover_media_provider: null,
  cover_media_source_url: null,
  cover_media_credit: null,
  cover_media_credit_url: null,
  cover_media_alt: null,
  currency: "USD",
  visibility: "public",
  show_on_discover: true,
  status: "scheduled",
  published_at: "2026-08-12T00:00:00Z",
  timezone: "UTC",
  created_at: "2026-08-12T00:00:00Z",
  updated_at: "2026-08-12T00:00:00Z",
  public_theme: null,
  theme_color_override: null,
  theme_font_override: null,
  theme_animation_override: null,
  master_start_at: "2026-08-13T18:00:00Z",
  master_end_at: "2026-08-13T20:00:00Z",
  master_timezone: "UTC",
  master_event_date_id: "date-1929",
};

const exactViewQuery = (data: unknown, error: unknown = null) => ({
  select: () => ({
    eq: () => ({
      eq: () => ({ maybeSingle: () => Promise.resolve({ data, error }) }),
      maybeSingle: () => Promise.resolve({ data, error }),
    }),
  }),
});

const emptyTicketsQuery = {
  select: () => ({
    eq: () => ({
      eq: () => ({
        is: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
  }),
};

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
});

describe("#1929 hidden direct checkout Business composition", () => {
  test.each([[], 42, { id: "incomplete" }])(
    "malformed non-null bundle %p throws redacted error without fallback",
    async (data) => {
      rpcMock.mockResolvedValue({ data, error: null });
      await expect(getPublicEventById("event-1929")).rejects.toThrow(
        "invalid_direct_event_checkout_bundle",
      );
      expect(fromMock).not.toHaveBeenCalled();
    },
  );

  test("valid standard bundle is sole hydration authority", async () => {
    rpcMock.mockResolvedValue({ data: bundle(), error: null });
    const detail = await getPublicEventBySlug("brand-1929", "event-1929");
    expect(detail?.event.id).toBe("event-1929");
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  test("bundle NULL cannot be rescued by a public standard view row", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    fromMock.mockReturnValue(exactViewQuery({ ...rsvpRow, event_type: "event" }));
    await expect(getPublicEventById("event-1929")).resolves.toBeNull();
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  test("bundle NULL preserves exact public RSVP compatibility", async () => {
    rpcMock.mockImplementation((name: string) =>
      Promise.resolve({ data: name === "pg_direct_event_checkout_bundle" ? null : [], error: null }),
    );
    fromMock.mockImplementation((table: string) =>
      table === "business_public_events_view"
        ? exactViewQuery(rsvpRow)
        : emptyTicketsQuery,
    );
    const detail = await getPublicEventBySlug("brand-1929", "rsvp-1929");
    expect(detail?.event.event_type).toBe("rsvp");
  });

  test.each(["private", "unknown"])(
    "%s remains indistinguishable bundle-NULL absence",
    async () => {
      rpcMock.mockResolvedValue({ data: null, error: null });
      fromMock.mockReturnValue(exactViewQuery(null));
      await expect(getPublicEventById("absent-1929")).resolves.toBeNull();
    },
  );
});
