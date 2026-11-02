import { describe, expect, test } from "@jest/globals";

import type { TicketExtraStub } from "../../store/draftEventStore";
import {
  emptyExtra,
  extrasUnavailableFor,
  isExtraDayLocked,
  toggleExtraDay,
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

describe("issue #3281 sold dates and saved tiers", () => {
  test("only a sold date is locked; an unsold date can leave the list", () => {
    const sold = extra({
      validDayIds: ["fri", "sat"],
      soldCount: 2,
      soldDayIds: ["sat"],
    });
    expect(isExtraDayLocked(sold, "sat")).toBe(true);
    expect(isExtraDayLocked(sold, "fri")).toBe(false);
    expect(toggleExtraDay(sold, "fri")).toEqual(["sat"]);
    expect(toggleExtraDay(sold, "sat")).toEqual(["fri", "sat"]);
  });

  test("leaving every date keeps the dates it sold on, without repeats", () => {
    const allDates = extra({
      validDayIds: null,
      soldCount: 1,
      soldDayIds: ["sat"],
    });
    expect(toggleExtraDay(allDates, "fri")).toEqual(["sat", "fri"]);
    expect(toggleExtraDay(allDates, "sat")).toEqual(["sat"]);
    expect(toggleExtraDay(extra({ validDayIds: null }), "fri")).toEqual([
      "fri",
    ]);
  });

  test("an unloaded saved tier is locked; a new local tier is not", () => {
    const saved = { id: "3b0f2a1c-0000-4000-8000-000000000001" };
    expect(extrasUnavailableFor(true, saved)).toBe(true);
    expect(extrasUnavailableFor(true, { ...saved, extras: [] })).toBe(false);
    expect(extrasUnavailableFor(true, { id: "t_abc123" })).toBe(false);
    expect(extrasUnavailableFor(false, saved)).toBe(false);
    expect(extrasUnavailableFor(true, null)).toBe(false);
  });
});
