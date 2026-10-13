/* eslint-disable import/first */
/**
 * Issue #3801 — a trip's capacity is the SUM of its packages' spots, and its
 * packages come back in the order the host authored them.
 *
 * THE BUG (production trip 2385da2f…: Shared 8 / Private 2 / Couple 1).
 *   - `mapTrip` read capacity as `ticketTypes[0]?.quantity_total` of a query
 *     with no ORDER BY, so "max travelers" was whichever package Postgres
 *     happened to return first (8), and the Step 1 field that showed 12 was
 *     never saved at all.
 *   - `getTrip` and the buyer read `getPublicTripById` both read
 *     `trip_pricing_tiers` with no order, so "the first package" changed
 *     between reloads, for hosts and on the public page.
 *
 * THE FIX. Capacity = sum of `ticket_types.quantity_total` (null when any
 * package has no limit). Tiers are ordered by the joined
 * `ticket_types.display_order`, then `created_at`, then id.
 *
 * HOW THIS PROVES IT. The REAL `getTrip` / `getPublicTripById` run against a
 * Supabase stand-in that returns the rows in a deliberately scrambled order —
 * and then in the reverse of that — and the answers do not move.
 *
 * Fails on revert: restore `ticketTypes[0]?.quantity_total ?? null` in
 * mapTrip -> the sum tests go red; restore `tiers.map(` in either read -> the
 * order tests go red.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

type Rows = Record<string, unknown>[] | Record<string, unknown> | null;
const tables: Record<string, Rows> = {};
const rpcMock = jest.fn() as any;

/** A chainable PostgREST builder that resolves to the table's canned rows. */
function builder(table: string): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "order", "limit", "maybeSingle"]) {
    b[method] = (): Record<string, unknown> => b;
  }
  b.then = (
    resolve: (value: { data: Rows; error: null }) => unknown,
    reject: (reason: unknown) => unknown,
  ): Promise<unknown> =>
    Promise.resolve({ data: tables[table] ?? null, error: null }).then(resolve, reject);
  return b;
}

jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: (name: string, args: unknown) => rpcMock(name, args),
  },
}));

import { getTrip } from "../tripsService";
import { getPublicTripById } from "../publicEventsService";
import {
  compareTripPackageOrder,
  orderTripPricingTierRows,
  sumTripPackageSpots,
} from "../tripPackages";

const EVENT_ID = "38010000-0000-4000-8000-0000000000b1";

const eventRow = {
  id: EVENT_ID,
  brand_id: "brand-3801",
  title: "Lagos long weekend",
  description: null,
  slug: "lagos-long-weekend",
  status: "scheduled",
  visibility: "public",
  published_at: "2026-10-12T22:28:41.000Z",
  timezone: "UTC",
  cover_media_url: null,
  cover_media_type: null,
  theme: {},
  event_type: "trip",
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
  refund_policy: null,
  booking_deadline: null,
  bookings_closed: false,
  bookings_closed_at: null,
  brands: { slug: "casa-lenta" },
};

// Authored order: Shared (8), Private (2), Couple (1).
const ticketTypes = [
  {
    id: "tt-shared",
    event_id: EVENT_ID,
    price_cents: 120000,
    currency: "USD",
    quantity_total: 8,
    is_unlimited: false,
    display_order: 0,
    created_at: "2026-10-01T10:00:00.000Z",
  },
  {
    id: "tt-private",
    event_id: EVENT_ID,
    price_cents: 180000,
    currency: "USD",
    quantity_total: 2,
    is_unlimited: false,
    display_order: 1,
    created_at: "2026-10-01T10:05:00.000Z",
  },
  {
    id: "tt-couple",
    event_id: EVENT_ID,
    price_cents: 300000,
    currency: "USD",
    quantity_total: 1,
    is_unlimited: false,
    display_order: 2,
    created_at: "2026-10-01T10:10:00.000Z",
  },
];
const tier = (id: string, ticketTypeId: string, name: string): Record<string, unknown> => ({
  id,
  event_id: EVENT_ID,
  ticket_type_id: ticketTypeId,
  tier_name: name,
  tier_metadata: {},
});
// Tier ids are deliberately the reverse of the authored order, so an "order by
// tier id" shortcut cannot pass.
const tiers = [
  tier("tier-c", "tt-shared", "Shared"),
  tier("tier-b", "tt-private", "Private"),
  tier("tier-a", "tt-couple", "Couple"),
];

/** Heap order as Postgres might hand it back — and its mirror image. */
const SCRAMBLES: [string, number[]][] = [
  ["couple, shared, private", [2, 0, 1]],
  ["private, couple, shared", [1, 2, 0]],
  ["authored order", [0, 1, 2]],
];

function seed(order: number[], tickets: Record<string, unknown>[] = ticketTypes): void {
  tables.events = eventRow;
  tables.brands = { id: "brand-3801", slug: "casa-lenta", name: "Casa Lenta", description: null, cover_media_url: null };
  tables.trip_days = [];
  tables.trip_inclusions = [];
  tables.event_dates = {
    event_id: EVENT_ID,
    start_at: "2026-11-12T00:00:00.000Z",
    end_at: "2026-11-16T23:59:59.000Z",
    is_master: true,
  };
  tables.trip_pricing_tiers = order.map((i) => tiers[i]);
  // Ticket rows scrambled differently from the tier rows.
  tables.ticket_types = [...order].reverse().map((i) => tickets[i]);
}

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key];
  rpcMock.mockReset();
  rpcMock.mockImplementation((name: string) =>
    Promise.resolve({ data: name === "biz_trip_tickets_sold" ? 0 : [], error: null }),
  );
});

describe("#3801 — trip capacity is the sum of package spots", () => {
  test.each(SCRAMBLES)("host read returns 11 (8 + 2 + 1) when rows arrive as: %s", async (_label, order) => {
    seed(order);
    const trip = await getTrip(EVENT_ID);
    expect(trip).not.toBeNull();
    expect(trip?.businessTrip.capacity).toBe(11);
  });

  test("a package with no limit means the trip has no cap, never a partial sum", async () => {
    seed(
      [0, 1, 2],
      ticketTypes.map((tt) =>
        tt.id === "tt-private" ? { ...tt, quantity_total: null, is_unlimited: true } : tt,
      ),
    );
    const trip = await getTrip(EVENT_ID);
    expect(trip?.businessTrip.capacity).toBeNull();
  });

  test("the rule, on its own", () => {
    expect(sumTripPackageSpots([])).toBeNull();
    expect(
      sumTripPackageSpots([{ quantity_total: 8 }, { quantity_total: 2 }, { quantity_total: 1 }]),
    ).toBe(11);
    expect(sumTripPackageSpots([{ quantity_total: 8 }, { quantity_total: null }])).toBeNull();
    expect(
      sumTripPackageSpots([{ quantity_total: 8 }, { quantity_total: 4, is_unlimited: true }]),
    ).toBeNull();
  });
});

describe("#3801 — packages keep their authored order", () => {
  test.each(SCRAMBLES)("host read: Shared, Private, Couple when rows arrive as: %s", async (_label, order) => {
    seed(order);
    const trip = await getTrip(EVENT_ID);
    expect(trip?.pricingTiers.map((t) => t.tierName)).toEqual(["Shared", "Private", "Couple"]);
    expect(trip?.pricingTiers.map((t) => t.quantityTotal)).toEqual([8, 2, 1]);
  });

  test.each(SCRAMBLES)("buyer read: Shared, Private, Couple when rows arrive as: %s", async (_label, order) => {
    seed(order);
    const detail = await getPublicTripById(EVENT_ID);
    expect(detail).not.toBeNull();
    expect(detail?.trip.pricingTiers.map((t) => t.tierName)).toEqual([
      "Shared",
      "Private",
      "Couple",
    ]);
  });

  test("ties fall through display_order to created_at, then id", () => {
    const a = { id: "b", display_order: 0, created_at: "2026-10-01T10:00:00.000Z" };
    const b = { id: "a", display_order: 0, created_at: "2026-10-01T10:00:00.000Z" };
    const earlier = { id: "z", display_order: 0, created_at: "2026-10-01T09:00:00.000Z" };
    const noOrder = { id: "0", display_order: null, created_at: "2026-01-01T00:00:00.000Z" };
    expect(compareTripPackageOrder(a, b)).toBeGreaterThan(0);
    expect(compareTripPackageOrder(earlier, b)).toBeLessThan(0);
    expect(compareTripPackageOrder(noOrder, a)).toBeGreaterThan(0);
    expect(compareTripPackageOrder(a, undefined)).toBeLessThan(0);
    const rows = [
      { id: "t1", ticket_type_id: "gone" },
      { id: "t2", ticket_type_id: "a" },
      { id: "t3", ticket_type_id: "z" },
    ];
    const byId = new Map([
      ["a", b],
      ["z", earlier],
    ]);
    expect(orderTripPricingTierRows(rows, byId).map((r) => r.id)).toEqual(["t3", "t2", "t1"]);
    // The input is not mutated.
    expect(rows.map((r) => r.id)).toEqual(["t1", "t2", "t3"]);
  });
});
