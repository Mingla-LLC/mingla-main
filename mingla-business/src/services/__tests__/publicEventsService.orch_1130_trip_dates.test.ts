/* eslint-disable import/first */
/**
 * ORCH-1130 Fix #1 [trip-pay-structure] — public trip getter sources dates from
 * the event_dates master row, NOT the stripped theme.business_trip mirror.
 *
 * Root cause (INVESTIGATE_ORCH-1130): ORCH-0950 moved canonical trip dates onto
 * the event_dates master row and biz_update_live_trip strips the
 * theme business-trip start/end mirror on every live edit. The public trip getter
 * still read theme → "Dates to be set" on every edited/published trip even
 * though dates exist. The event public page already reads event_dates.
 *
 * This test mocks a trip whose theme dates are NULL but whose event_dates master
 * row is populated, calls getPublicTripById, and asserts formatTripDateRange
 * yields the REAL range (not the "Dates to be set" fallback).
 *
 * Fails-on-revert: delete the event_dates source (revert businessTrip.startAt|
 * endAt to `typeof bt.startAt === "string" ? bt.startAt : null`) → with NULL
 * theme dates the getter returns null → formatTripDateRange returns
 * "Dates to be set" → the first assertion fails.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import { formatTripDateRange } from "../../../../packages/offering-rendering/formatTripDateRange";

const rpcMock = jest.fn() as ReturnType<typeof jest.fn>;
const fromMock = jest.fn() as ReturnType<typeof jest.fn>;

jest.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (table: string) => fromMock(table),
  },
}));

jest.mock("expo-image", () => ({}), { virtual: true });

// `@mingla/offering-rendering` is a monorepo workspace package resolved by Metro at
// build time, not by jest's node resolver in this worktree (no moduleNameMapper).
// publicEventsService only pulls in the theme-slug guards from it; stub them so
// the service module loads. The date-formatter under test is imported directly
// from its file path above, so this stub does NOT mask the behavior we assert.
jest.mock(
  "@mingla/offering-rendering",
  () => ({
    isThemeAnimationSlug: () => false,
    isThemeColor: () => false,
    isThemeFontSlug: () => false,
  }),
  { virtual: true },
);

import { getPublicTripById } from "../publicEventsService";

const TRIP_EVENT_ID = "743ad25b-9075-4738-aef6-43a0a6c2ffd1";

// Live-prod shape (per INVESTIGATE evidence): theme dates NULL, dates live in
// the event_dates master row.
const EVENT_ROW_THEME_DATES_NULL = {
  id: TRIP_EVENT_ID,
  brand_id: "brand-uuid-travelbrand",
  title: "The Sone",
  description: null,
  slug: "the-sone",
  status: "scheduled",
  visibility: "public",
  published_at: "2026-05-01T00:00:00Z",
  timezone: "America/Mexico_City",
  cover_media_url: null,
  cover_media_type: null,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
  destination_text: "Tulum, Quintana Roo, Mexico",
  departure_text: null,
  booking_deadline: null,
  bookings_closed: false,
  bookings_closed_at: null,
  refund_policy: null,
  // theme.business_trip carries NO startAt/endAt (stripped by biz_update_live_trip).
  theme: { business_trip: { destinationLocationText: "Tulum" } },
};

const MASTER_DATE_ROW = {
  event_id: TRIP_EVENT_ID,
  start_at: "2026-09-19T00:00:00Z",
  end_at: "2026-09-22T23:59:59Z",
  is_master: true,
};

const BRAND_ROW = {
  id: "brand-uuid-travelbrand",
  slug: "travelbrand",
  name: "Travel Brand",
  description: null,
  cover_media_url: null,
};

/** Build a from() mock honoring getPublicTripById's call graph. */
function installFromMock(masterDateData: typeof MASTER_DATE_ROW | null): void {
  fromMock.mockImplementation((table: string) => {
    if (table === "events") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              in: () => ({
                is: () => ({
                  maybeSingle: jest
                    .fn<() => Promise<{ data: unknown; error: null }>>()
                    .mockResolvedValue({
                      data: EVENT_ROW_THEME_DATES_NULL,
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        }),
      };
    }
    if (table === "brands") {
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: jest
                .fn<() => Promise<{ data: unknown; error: null }>>()
                .mockResolvedValue({ data: BRAND_ROW, error: null }),
            }),
          }),
        }),
      };
    }
    if (
      table === "trip_days" ||
      table === "trip_inclusions"
    ) {
      // .select().eq().order()[.order()] resolving to empty.
      const order = jest
        .fn<() => Promise<{ data: never[]; error: null }>>()
        .mockResolvedValue({ data: [], error: null });
      // order() may chain a second order(); make it thenable + chainable.
      const chain: Record<string, unknown> = {
        order: () => chain,
        then: (
          resolve: (v: { data: never[]; error: null }) => unknown,
        ) => resolve({ data: [], error: null }),
      };
      return {
        select: () => ({ eq: () => chain }),
        // satisfy the unused `order` ref pattern (kept for clarity)
        _order: order,
      };
    }
    if (table === "trip_pricing_tiers" || table === "ticket_types") {
      const resolved = { data: [], error: null };
      return {
        select: () => ({
          eq: () => ({
            is: () =>
              Promise.resolve(resolved) as unknown,
            then: (r: (v: typeof resolved) => unknown) => r(resolved),
          }),
        }),
      };
    }
    if (table === "event_dates") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: jest
                .fn<() => Promise<{ data: unknown; error: null }>>()
                .mockResolvedValue({ data: masterDateData, error: null }),
            }),
          }),
        }),
      };
    }
    throw new Error(`unexpected from(${table}) in ORCH-1130 trip-dates test`);
  });
}

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  // remaining-capacity RPC: empty map.
  rpcMock.mockResolvedValue({ data: [], error: null });
});

describe("ORCH-1130 Fix #1 — public trip dates from event_dates master row", () => {
  test("theme dates NULL + event_dates populated → real range, not 'Dates to be set'", async () => {
    installFromMock(MASTER_DATE_ROW);

    const detail = await getPublicTripById(TRIP_EVENT_ID);
    expect(detail).not.toBeNull();

    const { startAt, endAt } = detail!.trip.businessTrip;
    // Canonical dates came from event_dates, NOT the (null) theme mirror.
    expect(startAt).toBe("2026-09-19T00:00:00Z");
    expect(endAt).toBe("2026-09-22T23:59:59Z");

    // The shared formatter (drives the public pill + checkout mini-card +
    // consumer card) yields a real range, never the fallback.
    const formatted = formatTripDateRange(startAt, endAt);
    expect(formatted).not.toBe("Dates to be set");
    expect(formatted).toMatch(/2026/);
  });

  test("fallback: no event_dates master row → legacy theme mirror still used", async () => {
    // Trip with NO master row but a populated legacy theme mirror.
    fromMock.mockImplementation((table: string) => {
      const evt = {
        ...EVENT_ROW_THEME_DATES_NULL,
        theme: {
          business_trip: {
            startAt: "2026-01-10T00:00:00Z",
            endAt: "2026-01-14T00:00:00Z",
          },
        },
      };
      if (table === "events") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: () => ({
                  is: () => ({
                    maybeSingle: jest
                      .fn<() => Promise<{ data: unknown; error: null }>>()
                      .mockResolvedValue({ data: evt, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "brands") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: jest
                  .fn<() => Promise<{ data: unknown; error: null }>>()
                  .mockResolvedValue({ data: BRAND_ROW, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "trip_days" || table === "trip_inclusions") {
        const chain: Record<string, unknown> = {
          order: () => chain,
          then: (resolve: (v: { data: never[]; error: null }) => unknown) =>
            resolve({ data: [], error: null }),
        };
        return { select: () => ({ eq: () => chain }) };
      }
      if (table === "trip_pricing_tiers" || table === "ticket_types") {
        const resolved = { data: [], error: null };
        return {
          select: () => ({
            eq: () => ({
              is: () => Promise.resolve(resolved) as unknown,
              then: (r: (v: typeof resolved) => unknown) => r(resolved),
            }),
          }),
        };
      }
      if (table === "event_dates") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: jest
                  .fn<() => Promise<{ data: null; error: null }>>()
                  .mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected from(${table}) in fallback test`);
    });

    const detail = await getPublicTripById(TRIP_EVENT_ID);
    expect(detail).not.toBeNull();
    expect(detail!.trip.businessTrip.startAt).toBe("2026-01-10T00:00:00Z");
    expect(detail!.trip.businessTrip.endAt).toBe("2026-01-14T00:00:00Z");
  });
});
