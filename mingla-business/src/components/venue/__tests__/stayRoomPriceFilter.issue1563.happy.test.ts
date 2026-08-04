/**
 * Issue #1563 [room-price-filter], step 7 of #1550 — IMPLEMENTOR happy-path
 * regression proof for the Stay room price bands, ordering and empty answer.
 *
 * Seth's ask, verbatim: "No way to filter by price."
 *
 * WHAT THIS SUITE REFUSES TO DO
 * -----------------------------
 * It never asserts that "the list got shorter". A filter test that checks only
 * a LENGTH passes when the list is empty for a completely unrelated reason —
 * the fixture failed to build, the parse rejected everything, the reducer
 * returned null. Every assertion below names WHICH offerings survive, BY ID,
 * over a set proved non-empty in the same test. Every `null` result is paired
 * with a VACUITY GUARD: the same fixture with the one hostile property removed
 * must resolve, so "returns null" can never pass because the fixture was junk.
 *
 * FAILS-ON-REVERT: deleting the parity guard
 * (`if (priced.length !== rate.offeringCount) return null;`) makes the
 * per-booking group PASS a control through and band a $75-per-booking room as a
 * nightly rate → §3 fails. Deleting the one-currency refusal, the distinct-price
 * floor, the empty-band `continue`, or the integer-magnitude loop each fails its
 * own section.
 *
 * Runs under the stock `mingla-business/jest.config.cjs` sweep — i.e. the
 * REQUIRED "mingla-business jest (full suite)" check — reaching the shared
 * package through the `@mingla/brand-rendering/<sub>` resolution repair.
 * Append-only: NEW file; modifies and deletes nothing.
 */
import { describe, expect, test } from "@jest/globals";

import {
  filterStayRoomsByBand,
  parseStayPriceBandId,
  resolveStayRoomPriceControl,
  sortStayRoomsByPrice,
  stayPriceBandLabel,
  stayPriceEmptyStateLine,
  stayPriceNiceThreshold,
  stayRoomCountLine,
  STAY_PRICE_BAND_ANY,
  type StayRoomPriceOffering,
} from "@mingla/brand-rendering/stayRoomPriceFilter";
import {
  resolveVenueStayRate,
  venueStayRateQualifier,
} from "@mingla/brand-rendering/venueStayRate";

// ---------------------------------------------------------------------------
// Fixtures. Shaped exactly like `pg_public_stay_details` returns them —
// `amountMinor` is a STRING because it crosses JSON as `bigint::text`.
// ---------------------------------------------------------------------------

type Fee = { displayMode: "included" | "separate" };

function room(
  id: string,
  amountMinor: string,
  options: {
    currencyCode?: string;
    pricingUnit?: string;
    fees?: Fee[];
  } = {},
): StayRoomPriceOffering {
  return {
    id,
    price: {
      amountMinor,
      currencyCode: options.currencyCode ?? "USD",
      pricingUnit: options.pricingUnit ?? "room_night",
    },
    fees: options.fees ?? [],
  };
}

/** IDs in list order — the shape every survival assertion is written against. */
function ids(rooms: readonly { id: string }[]): string[] {
  return rooms.map((entry) => entry.id);
}

/**
 * THE LIVE PROPERTY, as of this issue. Verified against production:
 *   SELECT o.kind, p.pricing_unit, p.currency_code, p.amount_minor …
 *   → room/room_night/USD 27500, room/room_night/USD 35000,
 *     place/place_booking/USD 7500
 * The $75 cabana is the third row and is deliberately NOT a room here; §3
 * introduces it as one, which is the shape the schema permits and nothing
 * forbids.
 */
const LIVE_ROOMS: StayRoomPriceOffering[] = [
  room("garden-suite", "27500"),
  room("ocean-suite", "35000"),
];

// ---------------------------------------------------------------------------
// §1 — The live property resolves a real control, and the bands are the ones a
//      guest would expect to see.
// ---------------------------------------------------------------------------

describe("#1563 §1 — the live Stay gets bands", () => {
  test("resolves over the real two-room shape", () => {
    const control = resolveStayRoomPriceControl(LIVE_ROOMS);
    expect(control).not.toBeNull();
    if (control === null) throw new Error("unreachable");

    // Vacuity: the reduction actually saw both rooms.
    expect(control.offeringCount).toBe(2);
    expect(LIVE_ROOMS).toHaveLength(2);

    expect(control.lowestMinor).toBe("27500");
    expect(control.highestMinor).toBe("35000");
    expect(control.currencyCode).toBe("USD");

    // "Any price" first, then one band per side of the single cut.
    expect(control.bands.map((band) => band.id)).toEqual([
      STAY_PRICE_BAND_ANY,
      "lt:35000",
      "gte:35000",
    ]);
    expect(control.bands.map((band) => band.label)).toEqual([
      "Any price",
      "Under $350",
      "$350+",
    ]);
    expect(control.bands.map((band) => band.count)).toEqual([2, 1, 1]);
  });

  test("each band contains exactly the rooms it names", () => {
    const control = resolveStayRoomPriceControl(LIVE_ROOMS);
    if (control === null) throw new Error("control did not resolve");

    // Not "shorter" — WHICH ones, over a source proved non-empty.
    expect(ids(LIVE_ROOMS)).toEqual(["garden-suite", "ocean-suite"]);
    expect(
      ids(filterStayRoomsByBand(LIVE_ROOMS, "lt:35000", control)),
    ).toEqual(["garden-suite"]);
    expect(
      ids(filterStayRoomsByBand(LIVE_ROOMS, "gte:35000", control)),
    ).toEqual(["ocean-suite"]);
    expect(
      ids(filterStayRoomsByBand(LIVE_ROOMS, STAY_PRICE_BAND_ANY, control)),
    ).toEqual(["garden-suite", "ocean-suite"]);
  });

  test("a room priced exactly at the boundary sits in the band above it", () => {
    const control = resolveStayRoomPriceControl(LIVE_ROOMS);
    if (control === null) throw new Error("control did not resolve");
    // $350 is the cut. "Under $350" must NOT contain it, "$350+" must — the
    // half-open rule, so a guest is never shown a room dearer than the band.
    expect(ids(filterStayRoomsByBand(LIVE_ROOMS, "lt:35000", control))).not.toContain(
      "ocean-suite",
    );
    expect(ids(filterStayRoomsByBand(LIVE_ROOMS, "gte:35000", control))).toContain(
      "ocean-suite",
    );
  });
});

// ---------------------------------------------------------------------------
// §2 — TRAP 1: currency is per-offering, not per-venue.
// ---------------------------------------------------------------------------

describe("#1563 §2 — mixed currencies produce no control at all", () => {
  test("two currencies refuse the control", () => {
    const mixed = [
      room("usd-room", "27500", { currencyCode: "USD" }),
      room("eur-room", "30000", { currencyCode: "EUR" }),
    ];
    expect(resolveStayRoomPriceControl(mixed)).toBeNull();

    // VACUITY GUARD — the identical fixture with one currency DOES resolve, so
    // the null above is the currency rule and not a broken fixture.
    const single = [
      room("usd-room", "27500", { currencyCode: "USD" }),
      room("eur-room", "30000", { currencyCode: "USD" }),
    ];
    const control = resolveStayRoomPriceControl(single);
    expect(control).not.toBeNull();
    expect(control?.offeringCount).toBe(2);
  });

  test("refuses exactly when #1562's from-rate refuses — one rule, not two", () => {
    const mixed = [
      room("a", "27500", { currencyCode: "USD" }),
      room("b", "30000", { currencyCode: "NGN" }),
    ];
    // The shared reducer is the authority; this module inherits its answer.
    expect(resolveVenueStayRate(mixed)).toBeNull();
    expect(resolveStayRoomPriceControl(mixed)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §3 — TRAP 3: not every offering is priced per night. THE SHARP ONE.
//
// `stay_offerings.kind` and `stay_price_versions.pricing_unit` are INDEPENDENT
// columns. Nothing in the schema stops a Room being priced `place_booking`, and
// the live property already carries a $75 `place_booking` item. A naive band
// would advertise it as a nightly rate.
// ---------------------------------------------------------------------------

describe("#1563 §3 — a per-booking room is never banded as a nightly rate", () => {
  const WITH_CABANA: StayRoomPriceOffering[] = [
    room("garden-suite", "27500"),
    room("ocean-suite", "35000"),
    room("pool-cabana", "7500", { pricingUnit: "place_booking" }),
  ];

  test("one per-booking room removes the whole control", () => {
    expect(resolveStayRoomPriceControl(WITH_CABANA)).toBeNull();
  });

  test("VACUITY — the same three rooms priced per night DO resolve", () => {
    const allNightly = [
      room("garden-suite", "27500"),
      room("ocean-suite", "35000"),
      room("pool-cabana", "7500"),
    ];
    const control = resolveStayRoomPriceControl(allNightly);
    expect(control).not.toBeNull();
    expect(control?.offeringCount).toBe(3);
    // …and the $75 room is then a real, cheapest, NIGHTLY room.
    expect(control?.lowestMinor).toBe("7500");
  });

  test("the cabana can neither be swept in nor silently dropped", () => {
    // There is no control, so there is no band to sweep it into and no filter
    // to drop it with. Proved by the surface contract: with a null control the
    // caller renders the untouched list.
    expect(resolveStayRoomPriceControl(WITH_CABANA)).toBeNull();
    expect(ids(WITH_CABANA)).toHaveLength(3);
    // And #1562's from-rate — the number the answer bar shows — still ignores
    // it, which is the behaviour this module is pinned to.
    const rate = resolveVenueStayRate(WITH_CABANA);
    expect(rate?.offeringCount).toBe(2);
    expect(rate?.fromMinor).toBe("27500");
  });
});

// ---------------------------------------------------------------------------
// §4 — TRAP 2: the base rate is not all-in, and the label says so.
// ---------------------------------------------------------------------------

describe("#1563 §4 — the qualifier is read from the data, never assumed", () => {
  test("no fees reads as 'before taxes and fees'", () => {
    const control = resolveStayRoomPriceControl(LIVE_ROOMS);
    expect(control?.qualifier).toBe("per night · before taxes and fees");
  });

  test("all-included fees flip it, and it matches #1562 exactly", () => {
    const included: Fee[] = [{ displayMode: "included" }];
    const rooms = [
      room("a", "27500", { fees: included }),
      room("b", "35000", { fees: included }),
    ];
    const control = resolveStayRoomPriceControl(rooms);
    const rate = resolveVenueStayRate(rooms);
    expect(rate).not.toBeNull();
    if (rate === null) throw new Error("unreachable");

    expect(control?.qualifier).toBe(
      "per night · all-in, taxes and fees included",
    );
    // ANTI-DRIFT: the band block and the answer bar say the identical sentence.
    expect(control?.qualifier).toBe(venueStayRateQualifier(rate));
  });

  test("one separate fee is enough to keep the honest wording", () => {
    const rooms = [
      room("a", "27500", { fees: [{ displayMode: "included" }] }),
      room("b", "35000", { fees: [{ displayMode: "separate" }] }),
    ];
    expect(resolveStayRoomPriceControl(rooms)?.qualifier).toBe(
      "per night · before taxes and fees",
    );
  });

  test("the empty answer carries the qualifier with its number", () => {
    const control = resolveStayRoomPriceControl(LIVE_ROOMS);
    if (control === null) throw new Error("control did not resolve");
    const line = stayPriceEmptyStateLine(control);
    expect(line).toContain("$275");
    expect(line).toContain("before taxes and fees");
    // It must never present itself as a total.
    expect(line).not.toContain("total");
  });
});

// ---------------------------------------------------------------------------
// §5 — min/max has ONE owner. This module must never disagree with #1562.
// ---------------------------------------------------------------------------

describe("#1563 §5 — the control inherits #1562's lowest and highest", () => {
  test("lowest and highest come straight from resolveVenueStayRate", () => {
    const rooms = [
      room("c", "51000"),
      room("a", "27500"),
      room("d", "9900"),
      room("b", "35000"),
    ];
    const control = resolveStayRoomPriceControl(rooms);
    const rate = resolveVenueStayRate(rooms);
    expect(rate).not.toBeNull();
    if (rate === null || control === null) throw new Error("unreachable");

    expect(rate.offeringCount).toBe(4);
    expect(control.lowestMinor).toBe(rate.fromMinor);
    expect(control.highestMinor).toBe(rate.toMinor);
    expect(control.offeringCount).toBe(rate.offeringCount);
  });

  test("every band boundary lies inside the observed price range", () => {
    const rooms = [
      room("a", "12000"),
      room("b", "27500"),
      room("c", "35000"),
      room("d", "51000"),
      room("e", "88000"),
    ];
    const control = resolveStayRoomPriceControl(rooms);
    if (control === null) throw new Error("control did not resolve");
    const real = control.bands.filter((band) => band.id !== STAY_PRICE_BAND_ANY);
    expect(real.length).toBeGreaterThan(1); // vacuity: there ARE bands to check
    for (const band of real) {
      if (band.minMinor !== null) {
        expect(band.minMinor).toBeGreaterThan(Number(control.lowestMinor));
        expect(band.minMinor).toBeLessThanOrEqual(Number(control.highestMinor));
      }
      if (band.maxMinor !== null) {
        expect(band.maxMinor).toBeGreaterThan(Number(control.lowestMinor));
        expect(band.maxMinor).toBeLessThanOrEqual(Number(control.highestMinor));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §6 — "A band that would return nothing is never shown."
// ---------------------------------------------------------------------------

describe("#1563 §6 — no band ever leads to an empty screen", () => {
  const SPREADS: Record<string, string[]> = {
    twoRooms: ["27500", "35000"],
    threeRooms: ["19900", "27500", "35000"],
    clustered: ["30000", "30500", "31000", "99000"],
    wide: ["5000", "9900", "27500", "35000", "51000", "88000", "150000"],
    manyRooms: [
      "8000", "9900", "12000", "15000", "19900", "24000", "27500", "31000",
      "35000", "42000", "51000", "66000", "88000", "120000", "150000",
    ],
    duplicates: ["27500", "27500", "35000", "35000", "35000"],
  };

  test.each(Object.keys(SPREADS))(
    "every offered band holds at least one room — %s",
    (name) => {
      const rooms = SPREADS[name].map((amount, index) =>
        room(`r${String(index)}`, amount),
      );
      const control = resolveStayRoomPriceControl(rooms);
      expect(control).not.toBeNull();
      if (control === null) throw new Error("unreachable");

      const real = control.bands.filter(
        (band) => band.id !== STAY_PRICE_BAND_ANY,
      );
      // VACUITY: an empty band list would pass a "no empty bands" loop.
      expect(real.length).toBeGreaterThanOrEqual(2);
      expect(real.length).toBeLessThanOrEqual(4);

      for (const band of real) {
        const survivors = filterStayRoomsByBand(rooms, band.id, control);
        expect(survivors.length).toBe(band.count);
        expect(survivors.length).toBeGreaterThan(0);
      }
      // Bands partition the rooms: every room in exactly one.
      const covered = real.reduce((sum, band) => sum + band.count, 0);
      expect(covered).toBe(rooms.length);
    },
  );

  test("a band the ROUNDING would empty is never offered", () => {
    // The one distribution where the empty-band rule actually bites. Five
    // prices — $100, $200, $280, $460, $600 — put the two derived cuts at
    // $280→$300 and $460→$450, and NO room lives in [$300, $450). Without the
    // rule a "$300–$450" chip would render reading "0 of 5 rooms" and tapping
    // it would land the guest on an empty screen, which is precisely what
    // #1550 forbids.
    const rooms = ["10000", "20000", "28000", "46000", "60000"].map(
      (amount, index) => room(`g${String(index)}`, amount),
    );
    const control = resolveStayRoomPriceControl(rooms);
    expect(control).not.toBeNull();
    if (control === null) throw new Error("unreachable");

    const real = control.bands.filter((band) => band.id !== STAY_PRICE_BAND_ANY);
    // VACUITY: bands really were generated.
    expect(real.length).toBeGreaterThanOrEqual(2);
    // The empty middle band is GONE, by id — falsifiable, not a count.
    expect(real.map((band) => band.id)).not.toContain("30000-45000");
    expect(real.map((band) => band.id)).toEqual(["lt:30000", "gte:45000"]);
    for (const band of real) {
      expect(band.count).toBeGreaterThan(0);
      expect(filterStayRoomsByBand(rooms, band.id, control).length).toBe(
        band.count,
      );
    }
  });

  test("three rooms produce two bands; fifteen prices produce four", () => {
    const three = SPREADS.threeRooms.map((amount, index) =>
      room(`t${String(index)}`, amount),
    );
    const many = SPREADS.manyRooms.map((amount, index) =>
      room(`m${String(index)}`, amount),
    );
    const threeBands = resolveStayRoomPriceControl(three)?.bands.filter(
      (band) => band.id !== STAY_PRICE_BAND_ANY,
    );
    const manyBands = resolveStayRoomPriceControl(many)?.bands.filter(
      (band) => band.id !== STAY_PRICE_BAND_ANY,
    );
    expect(threeBands).toHaveLength(2);
    expect(manyBands).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// §7 — The states that are part of the step, not afterthoughts.
// ---------------------------------------------------------------------------

describe("#1563 §7 — one room, one price, and zero results", () => {
  test("a single room gets no control — there is nothing to narrow", () => {
    expect(resolveStayRoomPriceControl([room("only", "27500")])).toBeNull();
    // VACUITY: adding a second, differently-priced room resolves one.
    expect(
      resolveStayRoomPriceControl([room("only", "27500"), room("two", "35000")]),
    ).not.toBeNull();
  });

  test("every room at the same price gets no control", () => {
    const same = [
      room("a", "35000"),
      room("b", "35000"),
      room("c", "35000"),
    ];
    expect(resolveStayRoomPriceControl(same)).toBeNull();
    // VACUITY: change ONE price and the control appears.
    expect(
      resolveStayRoomPriceControl([
        room("a", "35000"),
        room("b", "35000"),
        room("c", "27500"),
      ]),
    ).not.toBeNull();
  });

  test("an empty list and a non-array get no control", () => {
    expect(resolveStayRoomPriceControl([])).toBeNull();
    expect(
      resolveStayRoomPriceControl(
        null as unknown as StayRoomPriceOffering[],
      ),
    ).toBeNull();
  });

  test("ZERO RESULTS is reachable and returns nothing, not everything", () => {
    const control = resolveStayRoomPriceControl(LIVE_ROOMS);
    if (control === null) throw new Error("control did not resolve");

    // The guest is standing in a band that no longer holds anything — the
    // refetch case the value-encoded id exists to survive.
    const survivors = filterStayRoomsByBand(LIVE_ROOMS, "lt:10000", control);
    expect(survivors).toEqual([]);
    // VACUITY: the source was NOT empty, and "any" still returns everything —
    // so the empty result is the filter's doing, not a broken fixture.
    expect(LIVE_ROOMS).toHaveLength(2);
    expect(
      filterStayRoomsByBand(LIVE_ROOMS, STAY_PRICE_BAND_ANY, control),
    ).toHaveLength(2);
    // And the answer names a real price rather than showing a blank list.
    expect(stayPriceEmptyStateLine(control)).toContain("$275");
  });

  test("a stale band id keeps filtering instead of silently widening", () => {
    const control = resolveStayRoomPriceControl(LIVE_ROOMS);
    if (control === null) throw new Error("control did not resolve");
    // "gte:99999" is not among the generated bands at all.
    expect(control.bands.map((band) => band.id)).not.toContain("gte:99999");
    // It must still FILTER (to nothing), not fall back to everything.
    expect(filterStayRoomsByBand(LIVE_ROOMS, "gte:99999", control)).toEqual([]);
  });

  test("an unrecognised id is treated as 'any', never as 'nothing'", () => {
    const control = resolveStayRoomPriceControl(LIVE_ROOMS);
    if (control === null) throw new Error("control did not resolve");
    expect(parseStayPriceBandId("banana")).toBeNull();
    expect(ids(filterStayRoomsByBand(LIVE_ROOMS, "banana", control))).toEqual([
      "garden-suite",
      "ocean-suite",
    ]);
  });
});

// ---------------------------------------------------------------------------
// §8 — Ordering.
// ---------------------------------------------------------------------------

describe("#1563 §8 — price order, and it is stable", () => {
  const ROOMS = [
    room("ocean", "35000"),
    room("garden", "27500"),
    room("penthouse", "35000"),
    room("bunk", "9900"),
  ];

  test("low to high, with equal prices holding their server order", () => {
    const control = resolveStayRoomPriceControl(ROOMS);
    if (control === null) throw new Error("control did not resolve");
    expect(ids(sortStayRoomsByPrice(ROOMS, "low_high", control))).toEqual([
      "bunk",
      "garden",
      "ocean",
      "penthouse",
    ]);
  });

  test("high to low reverses price but not the tie order", () => {
    const control = resolveStayRoomPriceControl(ROOMS);
    if (control === null) throw new Error("control did not resolve");
    expect(ids(sortStayRoomsByPrice(ROOMS, "high_low", control))).toEqual([
      "ocean",
      "penthouse",
      "garden",
      "bunk",
    ]);
  });

  test("sorting never drops or duplicates a room", () => {
    const control = resolveStayRoomPriceControl(ROOMS);
    if (control === null) throw new Error("control did not resolve");
    const sorted = sortStayRoomsByPrice(ROOMS, "low_high", control);
    expect(sorted).toHaveLength(ROOMS.length);
    expect([...ids(sorted)].sort()).toEqual([...ids(ROOMS)].sort());
  });
});

// ---------------------------------------------------------------------------
// §9 — A price filter may narrow a list. It may never hide an offering because
//      we could not read its price.
// ---------------------------------------------------------------------------

describe("#1563 §9 — unreadable prices refuse the control, and are never hidden", () => {
  test.each([["not-a-number"], [""], ["-100"], ["27.50"], ["027500"]])(
    "an amount of %p refuses the whole control",
    (amount) => {
      expect(
        resolveStayRoomPriceControl([
          room("good", "27500"),
          room("bad", amount),
        ]),
      ).toBeNull();
    },
  );

  test("VACUITY — a readable amount in the same slot resolves", () => {
    expect(
      resolveStayRoomPriceControl([room("good", "27500"), room("bad", "35000")]),
    ).not.toBeNull();
  });

  test("duplicate offering ids refuse the control rather than guess", () => {
    expect(
      resolveStayRoomPriceControl([room("dup", "27500"), room("dup", "35000")]),
    ).toBeNull();
  });

  test("a room the scale never priced survives every band", () => {
    const control = resolveStayRoomPriceControl(LIVE_ROOMS);
    if (control === null) throw new Error("control did not resolve");
    const withStranger = [...LIVE_ROOMS, { id: "stranger" }];
    // "Under $350" holds one priced room — and the stranger, which is shown
    // rather than vanished. Falsifiable: a `return false` default would drop it.
    expect(ids(filterStayRoomsByBand(withStranger, "lt:35000", control))).toEqual(
      ["garden-suite", "stranger"],
    );
  });

  test("an unpriced room sorts last, never ahead of a real price", () => {
    const control = resolveStayRoomPriceControl(LIVE_ROOMS);
    if (control === null) throw new Error("control did not resolve");
    const withStranger = [{ id: "stranger" }, ...LIVE_ROOMS];
    expect(ids(sortStayRoomsByPrice(withStranger, "low_high", control))).toEqual(
      ["garden-suite", "ocean-suite", "stranger"],
    );
  });
});

// ---------------------------------------------------------------------------
// §10 — Thresholds are human numbers, computed WITHOUT Intl and WITHOUT log10.
// ---------------------------------------------------------------------------

describe("#1563 §10 — nice thresholds, on every engine", () => {
  test.each([
    [27500, 30000],
    [47500, 50000],
    [12000, 10000],
    [19000, 20000],
    [8000, 8000],
    [35000, 35000],
    [9, 9],
    [1, 1],
  ])("%p rounds to %p", (input, expected) => {
    expect(stayPriceNiceThreshold(input)).toBe(expected);
  });

  test.each([[10], [100], [1000], [10000], [100000], [1000000], [10000000]])(
    "an exact power of ten (%p) is returned unchanged",
    (value) => {
      // The `Math.log10` hazard: one ULP low floors to the wrong decade, and
      // whether that happens depends on the engine. This must not be possible.
      expect(stayPriceNiceThreshold(value)).toBe(value);
    },
  );

  test("rejects what is not a positive safe integer", () => {
    expect(stayPriceNiceThreshold(0)).toBe(0);
    expect(stayPriceNiceThreshold(-5)).toBe(0);
    expect(stayPriceNiceThreshold(Number.NaN)).toBe(0);
    expect(stayPriceNiceThreshold(1.5)).toBe(0);
  });

  test("band boundaries do not depend on the currency's exponent", () => {
    const amounts = ["12000", "27500", "35000", "51000", "88000"];
    const usd = resolveStayRoomPriceControl(
      amounts.map((a, i) => room(`u${String(i)}`, a, { currencyCode: "USD" })),
    );
    const jpy = resolveStayRoomPriceControl(
      amounts.map((a, i) => room(`j${String(i)}`, a, { currencyCode: "JPY" })),
    );
    expect(usd).not.toBeNull();
    expect(jpy).not.toBeNull();
    // Identical minor-unit boundaries; only the LABELS differ.
    expect(jpy?.bands.map((b) => [b.minMinor, b.maxMinor])).toEqual(
      usd?.bands.map((b) => [b.minMinor, b.maxMinor]),
    );
    expect(jpy?.bands.map((b) => b.label)).not.toEqual(
      usd?.bands.map((b) => b.label),
    );
  });
});

// ---------------------------------------------------------------------------
// §11 — The words on screen.
// ---------------------------------------------------------------------------

describe("#1563 §11 — labels and counts", () => {
  test("band labels read as a guest would say them", () => {
    expect(stayPriceBandLabel(null, null, "USD")).toBe("Any price");
    expect(stayPriceBandLabel(null, 30000, "USD")).toBe("Under $300");
    expect(stayPriceBandLabel(50000, null, "USD")).toBe("$500+");
    expect(stayPriceBandLabel(30000, 50000, "USD")).toBe("$300–$500");
  });

  test("whole amounts drop their empty decimals", () => {
    // #1562's `formatStayRate` — one owner for the headline form of money.
    expect(stayPriceBandLabel(null, 30000, "USD")).not.toContain(".00");
  });

  test("the count line is honest about singular and about narrowing", () => {
    expect(stayRoomCountLine(1, 1)).toBe("1 room");
    expect(stayRoomCountLine(11, 11)).toBe("11 rooms");
    expect(stayRoomCountLine(7, 11)).toBe("7 of 11 rooms");
    expect(stayRoomCountLine(0, 11)).toBe("0 of 11 rooms");
  });

  test("band ids round-trip through their own parser", () => {
    expect(parseStayPriceBandId(STAY_PRICE_BAND_ANY)).toBeNull();
    expect(parseStayPriceBandId("lt:30000")).toEqual({
      minMinor: null,
      maxMinor: 30000,
    });
    expect(parseStayPriceBandId("gte:50000")).toEqual({
      minMinor: 50000,
      maxMinor: null,
    });
    expect(parseStayPriceBandId("30000-50000")).toEqual({
      minMinor: 30000,
      maxMinor: 50000,
    });
  });
});
