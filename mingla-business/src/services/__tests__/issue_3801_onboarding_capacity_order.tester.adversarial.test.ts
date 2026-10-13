/* eslint-disable import/first */
/**
 * Issue #3801 — TESTER adversarial: trip capacity and package order cannot be
 * moved by the order rows come back in, by missing values, or by a package
 * that was removed.
 *
 * A DIFFERENT ANGLE from the implementor suite
 * (`issue_3801_onboarding_capacity_sum.implementor.test.ts`), which proves the
 * production trip (Shared 8 / Private 2 / Couple 1) under three scrambles.
 * This file attacks the rules themselves:
 *
 *   CAPACITY
 *   1. EVERY ordering of the package rows AND of the tier rows (36 combined)
 *      gives the same total through the real `getTrip`.
 *   2. An unlimited package makes the total "no cap" wherever it sits in the
 *      rows, including when it still carries a leftover number.
 *   3. A package with 0 spots counts as 0, it does not blank the total; a
 *      package with spots missing does blank it (never a partial sum).
 *   4. Zero packages is "no cap", not 0.
 *   5. Garbage quantities (negative, NaN, Infinity, a string) never produce a
 *      number that looks real.
 *   6. The package read asks the database to leave removed packages out, so a
 *      removed package's spots can never enter the sum.
 *
 *   ORDER
 *   7. Rows handed back REVERSED come out in authored order, for hosts and
 *      for buyers.
 *   8. Ties on `display_order` fall to `created_at`, then to the package id;
 *      a missing `display_order` sorts after every numbered one; a missing
 *      `created_at` sorts after a present one.
 *   9. A tier whose package is gone (removed package) sorts LAST, so it can
 *      never become "the first package", and two such tiers have a fixed order.
 *  10. The comparison is a real total order: every permutation of a mixed bag
 *      of rows sorts to one and the same sequence, and the input is untouched.
 *
 * Fails on revert (verified, see the tester report on the issue): restore
 * `ticketTypes[0]?.quantity_total ?? null` in mapTrip and the capacity tests go
 * red; restore `tiers.map(` in either read and the order tests go red.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

type Row = Record<string, unknown>;
type Rows = Row[] | Row | null;

const tables: Record<string, Rows> = {};
/** Every filter each table was read with, so the test can see what was asked. */
const filters: Record<string, string[]> = {};
const rpcMock = jest.fn() as any;

function builder(table: string): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  const note = (method: string) =>
    (...args: unknown[]): Record<string, unknown> => {
      (filters[table] ??= []).push(`${method}(${args.map((a) => JSON.stringify(a)).join(",")})`);
      return b;
    };
  for (const method of ["select", "eq", "is", "in", "order", "limit", "maybeSingle"]) {
    b[method] = note(method);
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

const EVENT_ID = "38010000-0000-4000-8000-0000000000e1";

const eventRow: Row = {
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

const pkg = (
  id: string,
  quantity: unknown,
  extra: Row = {},
): Row => ({
  id,
  event_id: EVENT_ID,
  price_cents: 100000,
  currency: "USD",
  quantity_total: quantity,
  is_unlimited: false,
  display_order: 0,
  created_at: "2026-10-01T10:00:00.000Z",
  ...extra,
});

const tier = (id: string, ticketTypeId: string, name: string): Row => ({
  id,
  event_id: EVENT_ID,
  ticket_type_id: ticketTypeId,
  tier_name: name,
  tier_metadata: {},
});

function seed(tiers: Row[], tickets: Row[]): void {
  tables.events = eventRow;
  tables.brands = {
    id: "brand-3801",
    slug: "casa-lenta",
    name: "Casa Lenta",
    description: null,
    cover_media_url: null,
  };
  tables.trip_days = [];
  tables.trip_inclusions = [];
  tables.event_dates = {
    event_id: EVENT_ID,
    start_at: "2026-11-12T00:00:00.000Z",
    end_at: "2026-11-16T23:59:59.000Z",
    is_master: true,
  };
  tables.trip_pricing_tiers = tiers;
  tables.ticket_types = tickets;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) out.push([item, ...tail]);
  });
  return out;
}

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key];
  for (const key of Object.keys(filters)) delete filters[key];
  rpcMock.mockReset();
  rpcMock.mockImplementation((name: string) =>
    Promise.resolve({ data: name === "biz_trip_tickets_sold" ? 0 : [], error: null }),
  );
});

const capacityOf = async (): Promise<number | null | undefined> =>
  (await getTrip(EVENT_ID))?.businessTrip.capacity;
const hostOrder = async (): Promise<string[] | undefined> =>
  (await getTrip(EVENT_ID))?.pricingTiers.map((t) => t.tierName);
const buyerOrder = async (): Promise<string[] | undefined> =>
  (await getPublicTripById(EVENT_ID))?.trip.pricingTiers.map((t) => t.tierName);

// ---------------------------------------------------------------------------
// CAPACITY
// ---------------------------------------------------------------------------

describe("#3801 tester — capacity is the same whatever order the rows come back in", () => {
  const tickets = [
    pkg("tt-shared", 8, { display_order: 0 }),
    pkg("tt-private", 2, { display_order: 1 }),
    pkg("tt-couple", 1, { display_order: 2 }),
  ];
  const tiers = [
    tier("tier-c", "tt-shared", "Shared"),
    tier("tier-b", "tt-private", "Private"),
    tier("tier-a", "tt-couple", "Couple"),
  ];

  test("all 36 combinations of package-row order and tier-row order total 11", async () => {
    const seen = new Set<unknown>();
    for (const ticketOrder of permutations(tickets)) {
      for (const tierOrder of permutations(tiers)) {
        seed(tierOrder, ticketOrder);
        seen.add(await capacityOf());
      }
    }
    expect([...seen]).toEqual([11]);
  });

  test("the first package returned is never mistaken for the trip: 1 first still totals 11", async () => {
    seed(tiers, [tickets[2], tickets[1], tickets[0]]);
    expect(await capacityOf()).toBe(11);
  });

  test("the package read leaves removed packages out, so their spots cannot enter the sum", async () => {
    seed(tiers, tickets);
    await getTrip(EVENT_ID);
    expect(filters.ticket_types).toContain('is("deleted_at",null)');
  });
});

describe("#3801 tester — when the total is 'no cap' and when it is a number", () => {
  test("an unlimited package blanks the total wherever it sits in the rows", async () => {
    const rows = [
      pkg("tt-a", 8),
      pkg("tt-b", null, { is_unlimited: true }),
      pkg("tt-c", 1),
    ];
    const tiers = [tier("t1", "tt-a", "A"), tier("t2", "tt-b", "B"), tier("t3", "tt-c", "C")];
    for (const order of permutations(rows)) {
      seed(tiers, order);
      expect(await capacityOf()).toBeNull();
    }
  });

  test("an unlimited package that still carries an old number is still unlimited", () => {
    expect(
      sumTripPackageSpots([
        { quantity_total: 8, is_unlimited: false },
        { quantity_total: 40, is_unlimited: true },
      ]),
    ).toBeNull();
  });

  test("a package with 0 spots counts as 0 and does not blank the total", async () => {
    seed(
      [tier("t1", "tt-a", "A"), tier("t2", "tt-b", "B")],
      [pkg("tt-a", 0), pkg("tt-b", 10)],
    );
    expect(await capacityOf()).toBe(10);
    expect(sumTripPackageSpots([{ quantity_total: 0 }])).toBe(0);
  });

  test("a package with spots missing blanks the total: never a partial sum", async () => {
    seed(
      [tier("t1", "tt-a", "A"), tier("t2", "tt-b", "B")],
      [pkg("tt-a", 8), pkg("tt-b", null)],
    );
    expect(await capacityOf()).toBeNull();
    // Not 8, which is what "whichever row came first" used to say.
    seed(
      [tier("t1", "tt-a", "A"), tier("t2", "tt-b", "B")],
      [pkg("tt-b", null), pkg("tt-a", 8)],
    );
    expect(await capacityOf()).toBeNull();
  });

  test("no packages at all is 'no cap', not zero travelers", async () => {
    seed([], []);
    expect(await capacityOf()).toBeNull();
    expect(sumTripPackageSpots([])).toBeNull();
  });

  test("a single package is its own spots (the one-package trip is unchanged)", async () => {
    seed([tier("t1", "tt-a", "A")], [pkg("tt-a", 12)]);
    expect(await capacityOf()).toBe(12);
  });

  test("garbage quantities never produce a number that looks real", () => {
    const junk: unknown[] = [Number.NaN, Number.POSITIVE_INFINITY, "8", undefined, {}];
    for (const value of junk) {
      expect(
        sumTripPackageSpots([
          { quantity_total: 8 },
          { quantity_total: value as number | null },
        ]),
      ).toBeNull();
    }
    // A negative count cannot subtract from the other packages.
    expect(sumTripPackageSpots([{ quantity_total: 8 }, { quantity_total: -3 }])).toBe(8);
  });

  test("the sum does not depend on the order of its input (every permutation of five)", () => {
    const rows = [3, 0, 7, 12, 1].map((n) => ({ quantity_total: n, is_unlimited: false }));
    const totals = new Set(permutations(rows).map((p) => sumTripPackageSpots(p)));
    expect([...totals]).toEqual([23]);
  });
});

// ---------------------------------------------------------------------------
// ORDER
// ---------------------------------------------------------------------------

describe("#3801 tester — packages come back in authored order for hosts and buyers", () => {
  const tickets = [
    pkg("tt-shared", 8, { display_order: 0, created_at: "2026-10-01T10:00:00.000Z" }),
    pkg("tt-private", 2, { display_order: 1, created_at: "2026-10-01T10:05:00.000Z" }),
    pkg("tt-couple", 1, { display_order: 2, created_at: "2026-10-01T10:10:00.000Z" }),
  ];
  // Tier ids run AGAINST the authored order, so sorting by tier id cannot pass.
  const tiers = [
    tier("tier-z", "tt-shared", "Shared"),
    tier("tier-m", "tt-private", "Private"),
    tier("tier-a", "tt-couple", "Couple"),
  ];

  test("rows handed back reversed come out Shared, Private, Couple", async () => {
    seed([...tiers].reverse(), [...tickets].reverse());
    expect(await hostOrder()).toEqual(["Shared", "Private", "Couple"]);
    expect(await buyerOrder()).toEqual(["Shared", "Private", "Couple"]);
  });

  test("every ordering of the rows gives hosts and buyers the same sequence", async () => {
    const seen = new Set<string>();
    for (const tierOrder of permutations(tiers)) {
      for (const ticketOrder of permutations(tickets)) {
        seed(tierOrder, ticketOrder);
        seen.add(`host:${(await hostOrder())?.join(",")}`);
        seen.add(`buyer:${(await buyerOrder())?.join(",")}`);
      }
    }
    expect([...seen].sort()).toEqual([
      "buyer:Shared,Private,Couple",
      "host:Shared,Private,Couple",
    ]);
  });

  test("ties on display_order (all 0, an old trip) fall to when each package was made", async () => {
    const tied = tickets.map((t) => ({ ...t, display_order: 0 }));
    seed([...tiers].reverse(), [...tied].reverse());
    expect(await hostOrder()).toEqual(["Shared", "Private", "Couple"]);
    expect(await buyerOrder()).toEqual(["Shared", "Private", "Couple"]);
  });

  test("no display_order anywhere (null) still gives creation order, the same for both reads", async () => {
    const unset = tickets.map((t) => ({ ...t, display_order: null }));
    for (const order of permutations(unset)) {
      seed([...tiers].reverse(), order);
      expect(await hostOrder()).toEqual(["Shared", "Private", "Couple"]);
      expect(await buyerOrder()).toEqual(["Shared", "Private", "Couple"]);
    }
  });

  test("a package with no display_order sorts after every numbered package", async () => {
    const mixed = [
      { ...tickets[0], display_order: null, created_at: "2026-09-01T00:00:00.000Z" }, // oldest, unnumbered
      { ...tickets[1], display_order: 5 },
      { ...tickets[2], display_order: 9 },
    ];
    seed(tiers, mixed);
    expect(await hostOrder()).toEqual(["Private", "Couple", "Shared"]);
    expect(await buyerOrder()).toEqual(["Private", "Couple", "Shared"]);
  });

  test("identical display_order AND created_at fall to the package id, not to row order", async () => {
    const twins = tickets.map((t) => ({
      ...t,
      display_order: 0,
      created_at: "2026-10-01T10:00:00.000Z",
    }));
    const expected = ["Couple", "Private", "Shared"]; // tt-couple < tt-private < tt-shared
    for (const order of permutations(twins)) {
      seed(tiers, order);
      expect(await hostOrder()).toEqual(expected);
      expect(await buyerOrder()).toEqual(expected);
    }
  });
});

describe("#3801 tester — a tier whose package was removed", () => {
  const tickets = [
    pkg("tt-shared", 8, { display_order: 1 }),
    pkg("tt-private", 2, { display_order: 2 }),
  ];
  const live = [tier("tier-2", "tt-shared", "Shared"), tier("tier-3", "tt-private", "Private")];
  // The removed package had display_order 0 and the smallest tier id: every
  // naive rule would put it first.
  const ghostA = tier("tier-0", "tt-removed-a", "Removed A");
  const ghostB = tier("tier-1", "tt-removed-b", "Removed B");

  test("it is never ahead of a live package on either read, so it is never 'the first package'", async () => {
    // Whether a read should return such a tier at all is a separate question
    // (see the tester report). What this pins: if it is returned, it is after
    // every live package, in every row order.
    for (const order of permutations([ghostA, ...live])) {
      seed(order, tickets);
      for (const names of [(await hostOrder()) as string[], (await buyerOrder()) as string[]]) {
        expect(names.slice(0, 2)).toEqual(["Shared", "Private"]);
        expect(names.filter((n) => n !== "Removed A")).toEqual(["Shared", "Private"]);
        expect([-1, names.length - 1]).toContain(names.indexOf("Removed A"));
      }
    }
  });

  test("it adds nothing to the trip total", async () => {
    seed([ghostA, ...live], tickets);
    expect(await capacityOf()).toBe(10);
  });

  test("two of them have one fixed order between themselves (by tier id)", () => {
    const byId = new Map(tickets.map((t) => [t.id as string, t as { id: string }]));
    type TierRow = { id: string; ticket_type_id: string };
    for (const order of permutations([ghostB, ghostA, ...live] as unknown as TierRow[])) {
      expect(orderTripPricingTierRows(order, byId).map((t) => t.id)).toEqual([
        "tier-2",
        "tier-3",
        "tier-0",
        "tier-1",
      ]);
    }
  });
});

describe("#3801 tester — the comparison is a real total order", () => {
  const rows = [
    { id: "e", display_order: 0, created_at: "2026-10-02T00:00:00.000Z" },
    { id: "d", display_order: 0, created_at: "2026-10-01T00:00:00.000Z" },
    { id: "c", display_order: 0, created_at: null },
    { id: "b", display_order: null, created_at: "2026-09-01T00:00:00.000Z" },
    { id: "a", display_order: undefined, created_at: undefined },
    { id: "f", display_order: 3, created_at: "2026-01-01T00:00:00.000Z" },
  ];

  test("every one of the 720 orderings sorts to the same sequence", () => {
    const results = new Set(
      permutations(rows).map((p) =>
        [...p]
          .sort(compareTripPackageOrder)
          .map((r) => r.id)
          .join(""),
      ),
    );
    // display_order 0 (by created_at, missing last), then 3, then unnumbered
    // (by created_at, missing last).
    expect([...results]).toEqual(["decfba"]);
  });

  test("it is antisymmetric and reflexive for every pair, including a missing row", () => {
    const withMissing = [...rows, undefined];
    for (const a of withMissing) {
      expect(compareTripPackageOrder(a, a)).toBe(0);
      for (const b of withMissing) {
        const ab = compareTripPackageOrder(a, b);
        const ba = compareTripPackageOrder(b, a);
        expect(Math.sign(ab)).toBe(-Math.sign(ba) || 0);
      }
    }
    // A missing row is after every present row.
    for (const row of rows) expect(compareTripPackageOrder(undefined, row)).toBeGreaterThan(0);
  });

  test("a non-finite display_order is treated as unset, not as first", () => {
    const sorted = [
      { id: "x", display_order: Number.NaN, created_at: "2026-01-01T00:00:00.000Z" },
      { id: "y", display_order: 4, created_at: "2026-12-01T00:00:00.000Z" },
    ].sort(compareTripPackageOrder);
    expect(sorted.map((r) => r.id)).toEqual(["y", "x"]);
  });

  test("ordering never mutates the rows it was given", () => {
    const byId = new Map<string, { id: string; display_order: number }>([
      ["tt-1", { id: "tt-1", display_order: 2 }],
      ["tt-2", { id: "tt-2", display_order: 1 }],
    ]);
    const input = Object.freeze([
      Object.freeze({ id: "t-1", ticket_type_id: "tt-1" }),
      Object.freeze({ id: "t-2", ticket_type_id: "tt-2" }),
    ]);
    const out = orderTripPricingTierRows(input, byId);
    expect(out.map((t) => t.id)).toEqual(["t-2", "t-1"]);
    expect(input.map((t) => t.id)).toEqual(["t-1", "t-2"]);
    expect(out).not.toBe(input);
  });
});
