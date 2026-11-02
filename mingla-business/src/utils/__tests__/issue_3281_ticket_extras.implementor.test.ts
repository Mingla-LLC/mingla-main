import { describe, expect, test } from "@jest/globals";

import type {
  MultiDateEntry,
  TicketExtraStub,
  TicketStub,
} from "../../store/draftEventStore";
import {
  ticketsOnAllDates,
  ticketsOnCurrentDays,
  ticketsWithoutDay,
} from "../ticketDayScope";
import {
  emptyExtra,
  extrasFromServer,
  keepExtraDaysInTier,
  validateTicketExtra,
} from "../ticketExtras";

const extra = (patch: Partial<TicketExtraStub> = {}): TicketExtraStub => ({
  id: "x_1",
  name: "Friday dinner",
  description: null,
  priceGbp: 15,
  isUnlimited: false,
  capacity: 40,
  maxPerTicket: 1,
  validDayIds: null,
  ...patch,
});

const tierWith = (extras: TicketExtraStub[] | undefined): TicketStub =>
  ({
    id: "t_1",
    name: "Weekend",
    visibility: "public",
    validDayIds: ["fri", "sat"],
    ...(extras !== undefined ? { extras } : {}),
  }) as TicketStub;

describe("issue #3281 extras validation mirrors the database", () => {
  test("a complete extra can save", () => {
    expect(validateTicketExtra(extra(), { tierIsFree: false })).toBeNull();
    expect(
      validateTicketExtra(extra({ priceGbp: 0 }), { tierIsFree: true }),
    ).toBeNull();
    expect(
      validateTicketExtra(extra({ isUnlimited: true, capacity: null }), {
        tierIsFree: false,
      }),
    ).toBeNull();
  });

  test("prices with two decimals are valid despite floating point", () => {
    for (const priceGbp of [0.29, 1.1, 1.1, 19.99, 0.07]) {
      expect(
        validateTicketExtra(extra({ priceGbp }), { tierIsFree: false }),
      ).toBeNull();
    }
  });

  test("a dated extra's capacity floor is its busiest date, not its total", () => {
    const dated = extra({
      validDayIds: ["fri", "sat"],
      capacity: 10,
      soldCount: 12,
      capacityFloor: 6,
    });
    expect(validateTicketExtra(dated, { tierIsFree: false })).toBeNull();
    expect(
      validateTicketExtra({ ...dated, capacity: 5 }, { tierIsFree: false }),
    ).toMatch(/below the 6 already sold on its busiest date/);
  });

  test("each problem has its own sentence", () => {
    const cases: [Partial<TicketExtraStub>, boolean, RegExp][] = [
      [{ name: "  " }, false, /name/],
      [{ priceGbp: -1 }, false, /less than nothing/],
      [{ priceGbp: 1.005 }, false, /two decimal places/],
      [{}, true, /free ticket can only have free extras/],
      [{ capacity: 0 }, false, /Capacity must be 1 or more/],
      [{ capacity: 2, soldCount: 3 }, false, /below the 3 already sold/],
      [{ maxPerTicket: 21 }, false, /between 1 and 20/],
      [{ validDayIds: [] }, false, /at least one date/],
    ];
    for (const [patch, tierIsFree, sentence] of cases) {
      expect(validateTicketExtra(extra(patch), { tierIsFree })).toMatch(
        sentence,
      );
    }
  });

  test("a new extra starts unnamed and blocks the save until named", () => {
    const fresh = emptyExtra();
    expect(fresh.id).toMatch(/^x_/);
    expect(validateTicketExtra(fresh, { tierIsFree: false })).toMatch(/name/);
  });
});

describe("issue #3281 extras follow their tier's dates", () => {
  test("an extra keeps only dates its tier admits", () => {
    const kept = keepExtraDaysInTier(
      [
        extra({ validDayIds: ["fri", "sun"] }),
        extra({ id: "x_2", validDayIds: null }),
      ],
      ["fri", "sat"],
    );
    expect(kept[0].validDayIds).toEqual(["fri"]);
    expect(kept[1].validDayIds).toBeNull();
    expect(
      keepExtraDaysInTier([extra({ validDayIds: ["sun"] })], null)[0]
        .validDayIds,
    ).toEqual(["sun"]);
  });

  test("deleting a date removes it from extras and never widens one", () => {
    const [tier] = ticketsWithoutDay(
      [
        tierWith([
          extra({ validDayIds: ["fri"] }),
          extra({ id: "x_2", validDayIds: ["fri", "sat"] }),
        ]),
      ],
      "fri",
    );
    expect(tier.extras?.[0].validDayIds).toEqual([]);
    expect(tier.extras?.[1].validDayIds).toEqual(["sat"]);
  });

  test("leaving multi-date clears extras' lists; new ids prune stale ones", () => {
    expect(
      ticketsOnAllDates([tierWith([extra({ validDayIds: ["fri"] })])])[0]
        .extras?.[0].validDayIds,
    ).toBeNull();
    const entries = [{ id: "sat" }] as unknown as MultiDateEntry[];
    expect(
      ticketsOnCurrentDays(
        [tierWith([extra({ validDayIds: ["fri", "sat"] })])],
        entries,
      )[0].extras?.[0].validDayIds,
    ).toEqual(["sat"]);
  });

  test("a tier without loaded extras stays without the key", () => {
    const [tier] = ticketsWithoutDay([tierWith(undefined)], "fri");
    expect("extras" in tier).toBe(false);
  });
});

describe("issue #3281 extras from the server", () => {
  test("a missing or malformed list is not loaded, so a save leaves extras alone", () => {
    expect(extrasFromServer(undefined)).toBeUndefined();
    expect(extrasFromServer(null)).toBeUndefined();
    expect(extrasFromServer({})).toBeUndefined();
  });

  test("the server's normalized list reads straight into the editor", () => {
    const rows = [
      {
        id: "a1",
        name: "Dinner",
        description: null,
        priceGbp: 15,
        isUnlimited: false,
        capacity: 40,
        maxPerTicket: 2,
        validDayIds: ["fri"],
        soldCount: 3,
      },
    ];
    expect(extrasFromServer(rows)).toEqual(rows);
    expect(extrasFromServer([])).toEqual([]);
  });
});
