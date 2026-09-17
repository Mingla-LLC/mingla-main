// Unlisted RSVP invite link — the Business / buyer-web slug reader.
//
// An UNLISTED RSVP has no ticketed bundle and no row in the public-only
// business_public_events_view, so its own invite link rendered "This event isn't
// live". After the view misses, the reader now asks pg_public_rsvp_by_slug (web:
// through the cached /api/rsvp-event-bundle endpoint first) and renders its
// `publicEventRow` through the same detailFromRow a view hit uses.
//
// fails-on-revert: read `const data = viewData;` (no exact-link fallback) and
// U-B01, U-B05, U-B07 and U-B09 red (measured).
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

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

import {
  getPublicEventById,
  getPublicEventBySlug,
  rsvpEventRowFromPayload,
} from "../publicEventsService";

const EVENT_ID = "6efa617e-d4bd-4389-909d-be9db1763a75";

const unlistedRow = (patch: Record<string, unknown> = {}) => ({
  id: EVENT_ID,
  brand_id: "brand-harmattan",
  brand_slug: "harmattanclub",
  brand_name: "Harmattan Club",
  brand_description: null,
  brand_profile_photo_url: null,
  brand_display_attendee_count: false,
  brand_address: null,
  brand_cover_media_url: null,
  brand_theme_color: null,
  brand_theme_font: null,
  brand_theme_animation: null,
  title: "Members’ Table",
  description: "A seated dinner for 40 members.",
  slug: "members-table",
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
  currency: "NGN",
  visibility: "hidden",
  show_on_discover: false,
  status: "scheduled",
  published_at: "2026-09-15T10:23:04Z",
  timezone: "Africa/Lagos",
  created_at: "2026-09-15T10:00:00Z",
  updated_at: "2026-09-15T10:23:04Z",
  public_theme: {
    business_event: {
      hideAddressUntilTicket: true,
      location: { venueName: "Harmattan Club" },
      settings: { privateGuestList: true, hideRemainingCount: true },
    },
  },
  theme_color_override: null,
  theme_font_override: null,
  theme_animation_override: null,
  master_start_at: "2026-10-03T18:00:00Z",
  master_end_at: "2026-10-03T22:00:00Z",
  master_timezone: "Africa/Lagos",
  master_event_date_id: "date-members",
  rsvp_discoverable: false,
  rsvp_capacity: 40,
  rsvp_allow_plus_ones: false,
  rsvp_plus_ones_max: 0,
  rsvp_waitlist_enabled: false,
  rsvp_approval_mode: "manual",
  rsvp_going_count: 0,
  rsvp_contribution_enabled: true,
  rsvp_contribution_suggested_cents: 500000,
  rsvp_contribution_min_cents: 100000,
  ...patch,
});

const rsvpPayload = (row: unknown = unlistedRow()) => ({
  id: EVENT_ID,
  brandSlug: "harmattanclub",
  eventSlug: "members-table",
  name: "Members’ Table",
  publicEventRow: row,
});

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

// The view answers `viewRow`; ticket reads are empty; each RPC answers from `rpcs`.
const wire = (viewRow: unknown, rpcs: Record<string, { data: unknown; error: unknown }>) => {
  fromMock.mockImplementation((table: unknown) =>
    table === "business_public_events_view" ? exactViewQuery(viewRow) : emptyTicketsQuery,
  );
  rpcMock.mockImplementation((name: unknown) =>
    Promise.resolve(rpcs[String(name)] ?? { data: [], error: null }),
  );
};

const rpcNames = (): string[] => rpcMock.mock.calls.map((call) => String(call[0]));

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
});

describe("unlisted RSVP invite link — native (no document)", () => {
  test("U-B01 an unlisted RSVP renders from pg_public_rsvp_by_slug after the view misses", async () => {
    wire(null, {
      pg_direct_event_checkout_bundle: { data: null, error: null },
      pg_public_rsvp_by_slug: { data: rsvpPayload(), error: null },
    });
    const detail = await getPublicEventBySlug("harmattanclub", "members-table");
    expect(detail).not.toBeNull();
    expect(detail?.event.id).toBe(EVENT_ID);
    expect(detail?.event.event_type).toBe("rsvp");
    expect(detail?.event.rsvpApprovalMode).toBe("manual");
    expect(detail?.event.rsvpCapacity).toBe(40);
    expect(detail?.event.rsvpContributionEnabled).toBe(true);
    expect(detail?.event.privateGuestList).toBe(true);
    expect(detail?.event.hideRemainingCount).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("pg_public_rsvp_by_slug", {
      p_brand_slug: "harmattanclub",
      p_event_slug: "members-table",
    });
  });

  test("U-B02 a public RSVP still renders from the view and never asks the RSVP reader", async () => {
    wire(unlistedRow({ visibility: "public" }), {
      pg_direct_event_checkout_bundle: { data: null, error: null },
    });
    const detail = await getPublicEventBySlug("harmattanclub", "members-table");
    expect(detail?.event.id).toBe(EVENT_ID);
    expect(rpcNames()).not.toContain("pg_public_rsvp_by_slug");
  });

  test("U-B03 the reader's NULL (private, draft, unknown) stays not-found", async () => {
    wire(null, {
      pg_direct_event_checkout_bundle: { data: null, error: null },
      pg_public_rsvp_by_slug: { data: null, error: null },
    });
    await expect(getPublicEventBySlug("harmattanclub", "members-table")).resolves.toBeNull();
  });

  test("U-B04 a payload from before the database change (no row) stays not-found", async () => {
    wire(null, {
      pg_direct_event_checkout_bundle: { data: null, error: null },
      pg_public_rsvp_by_slug: { data: { id: EVENT_ID, name: "Members’ Table" }, error: null },
    });
    await expect(getPublicEventBySlug("harmattanclub", "members-table")).resolves.toBeNull();
  });

  test("U-B05 a reader error is thrown, not rendered as not-found", async () => {
    wire(null, {
      pg_direct_event_checkout_bundle: { data: null, error: null },
      pg_public_rsvp_by_slug: { data: null, error: { message: "db-down" } },
    });
    await expect(getPublicEventBySlug("harmattanclub", "members-table")).rejects.toBeTruthy();
  });

  test("U-B06 the by-id reader is unchanged: it never asks the RSVP reader", async () => {
    wire(null, { pg_direct_event_checkout_bundle: { data: null, error: null } });
    await expect(getPublicEventById(EVENT_ID)).resolves.toBeNull();
    expect(rpcNames()).toEqual(["pg_direct_event_checkout_bundle"]);
  });
});

describe("unlisted RSVP invite link — web (cached endpoints)", () => {
  const realFetch = globalThis.fetch;
  const respond = (routes: Record<string, { status: number; body: unknown }>) =>
    jest.fn(async (url: unknown) => {
      const path = String(url).split("?")[0];
      const hit = routes[path] ?? { status: 404, body: { error: "not_found" } };
      return {
        ok: hit.status >= 200 && hit.status < 300,
        status: hit.status,
        json: async () => hit.body,
      };
    }) as unknown as typeof fetch;

  beforeEach(() => {
    (globalThis as { document?: unknown }).document = {};
  });
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
    globalThis.fetch = realFetch;
  });

  test("U-B07 bundle 404 + view miss -> the cached RSVP endpoint renders it, with no RPC at all", async () => {
    const f = respond({
      "/api/event-checkout-bundle": { status: 404, body: { error: "not_found" } },
      "/api/rsvp-event-bundle": { status: 200, body: rsvpPayload() },
    });
    globalThis.fetch = f;
    wire(null, {});
    const detail = await getPublicEventBySlug("harmattanclub", "members-table");
    expect(detail?.event.id).toBe(EVENT_ID);
    expect(String((f as jest.Mock).mock.calls[1][0])).toBe(
      "/api/rsvp-event-bundle?brandSlug=harmattanclub&eventSlug=members-table",
    );
    expect(rpcNames()).not.toContain("pg_public_rsvp_by_slug");
    expect(rpcNames()).not.toContain("pg_direct_event_checkout_bundle");
  });

  test("U-B08 a 404 from the RSVP endpoint is not-found and does not reach Supabase", async () => {
    globalThis.fetch = respond({});
    wire(null, {});
    await expect(getPublicEventBySlug("harmattanclub", "members-table")).resolves.toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test("U-B09 an unavailable RSVP endpoint falls back to the RPC", async () => {
    globalThis.fetch = respond({
      "/api/event-checkout-bundle": { status: 404, body: { error: "not_found" } },
      "/api/rsvp-event-bundle": { status: 502, body: { error: "upstream_unavailable" } },
    });
    wire(null, { pg_public_rsvp_by_slug: { data: rsvpPayload(), error: null } });
    const detail = await getPublicEventBySlug("harmattanclub", "members-table");
    expect(detail?.event.id).toBe(EVENT_ID);
    // The page's own ticket reads follow (an RSVP has none); the bundle is never re-asked.
    expect(rpcNames().filter((name) => name === "pg_public_rsvp_by_slug")).toHaveLength(1);
    expect(rpcNames()).not.toContain("pg_direct_event_checkout_bundle");
  });
});

describe("rsvpEventRowFromPayload", () => {
  test("U-B10 only a well-formed RSVP row is accepted", () => {
    expect(rsvpEventRowFromPayload(rsvpPayload())).toMatchObject({ id: EVENT_ID });
    for (const bad of [
      null,
      [],
      "x",
      {},
      { publicEventRow: null },
      { publicEventRow: [] },
      rsvpPayload(unlistedRow({ event_type: "event" })),
      rsvpPayload(unlistedRow({ id: 7 })),
      rsvpPayload(unlistedRow({ brand_slug: null })),
    ]) {
      expect(rsvpEventRowFromPayload(bad)).toBeNull();
    }
  });
});
