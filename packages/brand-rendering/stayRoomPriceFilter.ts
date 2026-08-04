/**
 * issue #1563 [room-price-filter], step 7 of #1550 — NARROWING A HOTEL BY WHAT
 * A GUEST CAN AFFORD. Seth's words: "No way to filter by price."
 *
 * NO NEW DATA. `usePublicStayDetail` already loads every live offering with
 * `price { amountMinor, currencyCode, pricingUnit }`, and `parsePublicStayDetail`
 * THROWS `stay_public_offering_invalid` unless every offering carries both
 * `amountMinor` and `currencyCode` as strings. This module is a reduction over
 * bytes already on the wire — no query, no column, no RPC.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THIS FILE OWNS BAND MEMBERSHIP. IT DOES NOT OWN MIN/MAX.
 * ───────────────────────────────────────────────────────────────────────────
 * #1562 shipped `resolveVenueStayRate` over these exact offerings to derive the
 * answer bar's from-rate. A price filter needs the same lowest/highest, the same
 * one-currency rule and the same "is this money" grammar, and TWO implementations
 * of that would drift into two different answers on one screen — the page saying
 * "from $275" beside a band list built on a different $275.
 *
 * So there is exactly ONE min/max in the product: `resolveVenueStayRate`. This
 * module CALLS it and derives bands from what it returns. All this file adds is
 * per-offering membership — which room falls in which band — and it proves it
 * agrees with the shared reducer rather than assuming it:
 *
 *     if (priced.length !== rate.offeringCount) return null;
 *
 * That single line is a PARITY GUARD, and it is doing three jobs at once:
 *
 *   (a) ANTI-DRIFT. If this file's per-offering parse ever accepts or rejects a
 *       row that `resolveVenueStayRate` does not, the counts diverge and the
 *       control DISAPPEARS rather than filtering on a scale the rest of the page
 *       disagrees with. Fail-closed, never fail-quiet.
 *
 *   (b) THE PER-BOOKING TRAP, structurally. `resolveVenueStayRate` counts ONLY
 *       `pricing_unit = 'room_night'` rows. `kind` and `pricing_unit` are
 *       INDEPENDENT columns — `stay_offerings.kind IN ('room','place')` and
 *       `stay_price_versions.pricing_unit IN ('room_night','place_booking',
 *       'place_unit','place_guest')` — with NOTHING constraining a Room to be
 *       priced per night (verified against the live schema,
 *       20270131013807_issue_1387_stay_inventory_schema.sql:92,301-304). The live
 *       property proves the shape is real: a $75 Pool Cabana priced
 *       `place_booking` sits beside a $275 and a $350 room priced `room_night`.
 *       So the moment ANY room in the list is not priced per night, this file
 *       counts it, the shared reducer does not, the counts diverge, and there is
 *       NO CONTROL. "Under $300 per night" can therefore never quietly swallow —
 *       or quietly exclude — a per-booking item, because when one is present the
 *       bands do not exist at all.
 *
 *   (c) VACUITY. `offeringCount` is #1562's own witness that the reduction
 *       actually saw rooms. Comparing against it means a test cannot pass on an
 *       empty fixture.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * MIXED CURRENCIES: NO CONTROL, AND THAT IS #1562'S ANSWER, NOT A NEW ONE
 * ───────────────────────────────────────────────────────────────────────────
 * `stay_price_versions.currency_code` is a column on the PRICE, not on the
 * venue, and `PublicStayDetail` carries no venue currency to fall back on. When
 * the rooms disagree, `resolveVenueStayRate` returns null and the from-rate cell
 * renders NOTHING rather than compare incomparable numbers. A filter has the
 * same problem in a sharper form: a band boundary is a single number, and a
 * sort is a single ordering — "$300+" across USD and EUR bands two different
 * scales under one label, and "low to high" claims €90 is cheaper than $100.
 * Both are inventions. So the whole control — bands AND sort — is absent, and
 * the list renders exactly as it does today. Consistent with #1562 by
 * construction: this file returns null precisely when that function does.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE BASE RATE IS NOT ALL-IN, AND THE LABEL MUST NOT PRETEND OTHERWISE
 * ───────────────────────────────────────────────────────────────────────────
 * Fees and taxes only resolve at quote. A band therefore filters the NIGHTLY
 * BASE RATE, not a total, and it must say so in the same breath — #1550's rule
 * that the qualifier lives in the same block as the number, never as a footnote
 * elsewhere. The qualifier string is not written here: it comes from
 * `venueStayRateQualifier`, the same function the answer bar uses, so the band
 * list and the headline price can only ever make the same claim about the same
 * money — including the "all-in · taxes and fees included" case, which that
 * function reads from `fees[].displayMode` rather than assuming.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * BANDS, NOT A SLIDER — AND NEVER ONE THAT LEADS TO AN EMPTY SCREEN
 * ───────────────────────────────────────────────────────────────────────────
 * #1550's approved decision: "Two to four price bands generated from the venue's
 * own rooms. A band that would return nothing is never shown." Eleven rooms are
 * not a continuum and a drag slider is miserable on a phone. Bands are therefore
 * DERIVED from the venue's own price distribution — three rooms produce two
 * bands, thirty produce four — and any band that would return nothing is dropped
 * before it can be rendered.
 *
 * Thresholds are rounded to human numbers ("$300", not "$287.50") entirely in
 * MINOR units, with no `Intl` anywhere in the maths. That is deliberate: a nice
 * round minor amount stays nice in major units at every currency exponent
 * (30000 reads as $300.00 at exponent 2, ¥30,000 at exponent 0 and 30.000 at
 * exponent 3), so the band boundaries are identical on every JS engine and ICU
 * build. `Intl` is touched only to FORMAT a label, through the one shared
 * money formatter.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * BAND IDENTITY IS A VALUE, NOT AN INDEX
 * ───────────────────────────────────────────────────────────────────────────
 * A band id encodes its own boundaries (`"lt:30000"`, `"30000-50000"`,
 * `"gte:50000"`), so filtering never depends on the band still being present in
 * the generated list. This is what makes ZERO RESULTS a real, reachable state
 * rather than a decorative one: `usePublicStayDetail` refetches, a room sells out
 * and drops from the payload, and the band the guest is standing in can empty
 * underneath them. An index-based selection would silently snap back to "show
 * everything" and hide that; a value-based one keeps filtering, returns nothing,
 * and lets the surface give a real answer with the real cheapest price and one
 * tap back.
 */
import { formatStayRate } from "./stayGuestMoney";
import {
  resolveVenueStayRate,
  venueStayRateQualifier,
  type VenueStayRateOffering,
} from "./venueStayRate";

/**
 * The minimum shape this module needs — structurally satisfied by
 * `PublicStayOffering` without importing it, and a superset of
 * `VenueStayRateOffering` so the same array can be handed to both reducers.
 */
export interface StayRoomPriceOffering extends VenueStayRateOffering {
  id: string;
}

/** The sentinel that means "no narrowing". Not a band; the absence of one. */
export const STAY_PRICE_BAND_ANY = "any";

/** Default direction. #1550: "Defaults to price, low to high." */
export type StayPriceSort = "low_high" | "high_low";

export interface StayPriceBand {
  /**
   * Encodes its own boundaries so a selection survives a refetch. One of
   * `"any"`, `"lt:<max>"`, `"<min>-<max>"`, `"gte:<min>"` — minor units.
   */
  id: string;
  /** "Any price" / "Under $300" / "$300–$500" / "$500+". */
  label: string;
  /** Inclusive lower bound in minor units; null on the first band. */
  minMinor: number | null;
  /** EXCLUSIVE upper bound in minor units; null on the last band. */
  maxMinor: number | null;
  /** How many of the venue's rooms fall in this band, right now. */
  count: number;
}

export interface StayRoomPriceControl {
  /** Every band, "Any price" first. Never fewer than three entries total. */
  bands: StayPriceBand[];
  /** From `venueStayRateQualifier` — the SAME sentence the answer bar shows. */
  qualifier: string;
  /** The cheapest room, straight from `resolveVenueStayRate`. */
  lowestMinor: string;
  /** The dearest room, or null when every room costs the same. */
  highestMinor: string | null;
  currencyCode: string;
  /** How many rooms the scale covers — the "of 11" in "7 of 11 rooms". */
  offeringCount: number;
  /**
   * offeringId → amount in minor units. Membership only; the shared reducer
   * owns min/max. A room absent from this map is never hidden by a filter.
   */
  amountByOfferingId: Map<string, number>;
}

/** Same grammar `formatStayMoney` and `resolveVenueStayRate` validate against. */
const MINOR_AMOUNT = /^(0|[1-9]\d*)$/;

/**
 * A human threshold, computed entirely in minor units. Rounds to the nearest
 * half-magnitude step — 27,500 → 30,000; 47,500 → 50,000; 12,000 → 10,000 —
 * which is what turns a raw percentile into a number a guest recognises.
 * Always returns a positive integer for a positive integer input.
 */
export function stayPriceNiceThreshold(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) return 0;
  // The magnitude is found by INTEGER multiplication, never `Math.log10`.
  // `Math.log10(1000)` is not guaranteed to be exactly 3 on every engine, and
  // one ULP low floors to 2 — which would silently round every four-figure
  // price to the wrong decade on some builds and not others. A band boundary
  // that depends on the ICU build is a bug that only appears in CI.
  let magnitude = 1;
  while (magnitude * 10 <= value) magnitude *= 10;
  // A single-digit minor amount is already as round as a number gets.
  if (magnitude === 1) return value;
  const step = magnitude / 2; // an exact integer for every magnitude >= 10
  const rounded = Math.round(value / step) * step;
  return rounded > 0 ? rounded : magnitude;
}

/**
 * How many bands a given spread of prices deserves. #1550: "Three rooms produce
 * two bands; thirty produce four." Driven by DISTINCT prices, not room count —
 * eleven rooms at two prices are two prices.
 */
function bandCountFor(distinctPrices: number): number {
  if (distinctPrices <= 4) return 2;
  if (distinctPrices <= 11) return 3;
  return 4;
}

function parseAmount(offering: StayRoomPriceOffering): number | null {
  if (offering === null || typeof offering !== "object") return null;
  if (typeof offering.id !== "string" || offering.id.length === 0) return null;
  const price = offering.price;
  if (price === null || price === undefined) return null;
  if (typeof price.amountMinor !== "string") return null;
  if (!MINOR_AMOUNT.test(price.amountMinor)) return null;
  const amount = Number(price.amountMinor);
  if (!Number.isSafeInteger(amount)) return null;
  return amount;
}

/**
 * The band control for a Stay's ROOMS, or null when there is no honest scale to
 * band them on. Null is a first-class outcome: the surface renders the list
 * exactly as it does today, which is the design's own rule for absent data.
 *
 * Returns null when ANY of these hold — see the docblock for why each one is a
 * refusal rather than a guess:
 *   · the rooms disagree on currency (via `resolveVenueStayRate`)
 *   · any room is not priced per night (via the parity guard)
 *   · any room carries an unreadable amount
 *   · every room costs the same, or there is only one room
 *   · fewer than two bands survive the empty-band rule
 */
export function resolveStayRoomPriceControl(
  rooms: readonly StayRoomPriceOffering[],
): StayRoomPriceControl | null {
  if (!Array.isArray(rooms)) return null;
  if (rooms.length === 0) return null;

  // THE SINGLE OWNER of lowest/highest/currency/all-in. Not re-derived here.
  const rate = resolveVenueStayRate(rooms);
  if (rate === null) return null;

  const amountByOfferingId = new Map<string, number>();
  const priced: number[] = [];
  for (const room of rooms) {
    const amount = parseAmount(room);
    if (amount === null) return null;
    // A duplicate id would make membership ambiguous — refuse rather than pick.
    if (amountByOfferingId.has(room.id)) return null;
    amountByOfferingId.set(room.id, amount);
    priced.push(amount);
  }

  // THE PARITY GUARD. See the docblock: anti-drift, the per-booking trap, and
  // the vacuity witness, in one line.
  if (priced.length !== rate.offeringCount) return null;

  const distinct = Array.from(new Set(priced)).sort((a, b) => a - b);
  if (distinct.length < 2) return null;

  const total = distinct.length;
  const target = bandCountFor(total);
  const lowest = distinct[0];
  const highest = distinct[total - 1];

  const cuts: number[] = [];
  for (let i = 1; i < target; i += 1) {
    const index = Math.min(
      Math.max(Math.round((i * total) / target), 1),
      total - 1,
    );
    const raw = distinct[index];
    const nice = stayPriceNiceThreshold(raw);
    // A cut at or below the cheapest room empties the first band; a cut above
    // the dearest empties the last. Neither may ever be offered — so when
    // ROUNDING pushes the boundary out of range, fall back to the venue's own
    // raw price, which cannot: `index >= 1` makes it strictly above the cheapest
    // and it is drawn from the list so it cannot exceed the dearest.
    //
    // This is what a tightly-clustered hotel needs. Rooms at $300, $305, $310
    // and $990 round their cut down to $300 — onto the cheapest room — and
    // dropping it would leave that venue with NO filter at all despite a real
    // spread. It gets "Under $310" and "$310+" instead: a less round number,
    // but one of its own prices, and a working control.
    const cut = nice > lowest && nice <= highest ? nice : raw;
    if (cuts.includes(cut)) continue;
    cuts.push(cut);
  }
  cuts.sort((a, b) => a - b);
  if (cuts.length === 0) return null;

  const currencyCode = rate.currencyCode;
  const bands: StayPriceBand[] = [];
  for (let i = 0; i <= cuts.length; i += 1) {
    const minMinor = i === 0 ? null : cuts[i - 1];
    const maxMinor = i === cuts.length ? null : cuts[i];
    const count = priced.filter(
      (amount) =>
        (minMinor === null || amount >= minMinor) &&
        (maxMinor === null || amount < maxMinor),
    ).length;
    // "A band that would return nothing is never shown."
    if (count === 0) continue;
    bands.push({
      id: stayPriceBandId(minMinor, maxMinor),
      label: stayPriceBandLabel(minMinor, maxMinor, currencyCode),
      minMinor,
      maxMinor,
      count,
    });
  }
  // One band containing everything is not a filter — it is the list.
  if (bands.length < 2) return null;

  return {
    bands: [
      {
        id: STAY_PRICE_BAND_ANY,
        label: "Any price",
        minMinor: null,
        maxMinor: null,
        count: priced.length,
      },
      ...bands,
    ],
    qualifier: venueStayRateQualifier(rate),
    lowestMinor: rate.fromMinor,
    highestMinor: rate.toMinor,
    currencyCode,
    offeringCount: rate.offeringCount,
    amountByOfferingId,
  };
}

/** The value-encoded identity described in the docblock. */
export function stayPriceBandId(
  minMinor: number | null,
  maxMinor: number | null,
): string {
  if (minMinor === null && maxMinor === null) return STAY_PRICE_BAND_ANY;
  if (minMinor === null) return `lt:${String(maxMinor)}`;
  if (maxMinor === null) return `gte:${String(minMinor)}`;
  return `${String(minMinor)}-${String(maxMinor)}`;
}

/**
 * The chip's words. Bands are half-open `[min, max)`, so a room priced exactly
 * at a boundary belongs to the band ABOVE it — which is why the top band reads
 * "$350+" and the one below it "Under $350": at the boundary the two labels
 * cannot both be true, and this way round the guest is never shown a room that
 * costs more than the band they tapped.
 */
export function stayPriceBandLabel(
  minMinor: number | null,
  maxMinor: number | null,
  currencyCode: string,
): string {
  if (minMinor === null && maxMinor === null) return "Any price";
  if (minMinor === null) {
    return `Under ${formatStayRate(String(maxMinor), currencyCode)}`;
  }
  if (maxMinor === null) {
    return `${formatStayRate(String(minMinor), currencyCode)}+`;
  }
  const from = formatStayRate(String(minMinor), currencyCode);
  const to = formatStayRate(String(maxMinor), currencyCode);
  return `${from}–${to}`;
}

/** The boundaries a band id stands for, or null when it is not a band id. */
export function parseStayPriceBandId(
  bandId: string,
): { minMinor: number | null; maxMinor: number | null } | null {
  if (typeof bandId !== "string") return null;
  if (bandId === STAY_PRICE_BAND_ANY) return null;
  const under = /^lt:(\d+)$/.exec(bandId);
  if (under !== null) {
    return { minMinor: null, maxMinor: Number(under[1]) };
  }
  const over = /^gte:(\d+)$/.exec(bandId);
  if (over !== null) {
    return { minMinor: Number(over[1]), maxMinor: null };
  }
  const between = /^(\d+)-(\d+)$/.exec(bandId);
  if (between !== null) {
    return { minMinor: Number(between[1]), maxMinor: Number(between[2]) };
  }
  return null;
}

/**
 * The rooms a band contains. Driven by the PARSED ID, never by the band still
 * being present in `control.bands` — that is what lets a selection survive a
 * refetch and produce an honest empty answer instead of silently widening back
 * to everything.
 *
 * A room absent from `amountByOfferingId` is KEPT. A price filter may narrow a
 * list; it may never make an offering the venue is selling disappear because we
 * could not read its price. (Unreachable while a control exists — the control
 * refuses to resolve unless every room parsed — but the direction of the
 * failure is chosen deliberately, and tested.)
 */
export function filterStayRoomsByBand<T extends { id: string }>(
  rooms: readonly T[],
  bandId: string,
  control: StayRoomPriceControl,
): T[] {
  const bounds = parseStayPriceBandId(bandId);
  if (bounds === null) return [...rooms];
  return rooms.filter((room) => {
    const amount = control.amountByOfferingId.get(room.id);
    if (amount === undefined) return true;
    if (bounds.minMinor !== null && amount < bounds.minMinor) return false;
    if (bounds.maxMinor !== null && amount >= bounds.maxMinor) return false;
    return true;
  });
}

/**
 * Price order. Stable: equal prices keep the order the server sent, and a room
 * with no readable price is never reordered ahead of one that has a price — it
 * sinks to the end rather than pretending to be free.
 */
export function sortStayRoomsByPrice<T extends { id: string }>(
  rooms: readonly T[],
  direction: StayPriceSort,
  control: StayRoomPriceControl,
): T[] {
  return rooms
    .map((room, index) => ({ room, index }))
    .sort((left, right) => {
      const leftAmount = control.amountByOfferingId.get(left.room.id);
      const rightAmount = control.amountByOfferingId.get(right.room.id);
      if (leftAmount === undefined && rightAmount === undefined) {
        return left.index - right.index;
      }
      if (leftAmount === undefined) return 1;
      if (rightAmount === undefined) return -1;
      if (leftAmount !== rightAmount) {
        return direction === "low_high"
          ? leftAmount - rightAmount
          : rightAmount - leftAmount;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.room);
}

/** "7 of 11 rooms" — the live count. Singular when the venue has one room. */
export function stayRoomCountLine(shown: number, total: number): string {
  const noun = total === 1 ? "room" : "rooms";
  if (shown === total) return `${String(total)} ${noun}`;
  return `${String(shown)} of ${String(total)} ${noun}`;
}

/**
 * The zero-results answer. Never a blank list: it names the band the guest is
 * standing in, states the real cheapest price on the page, and the surface
 * renders one tap back beside it.
 */
export function stayPriceEmptyStateLine(
  control: StayRoomPriceControl,
): string {
  const lowest = formatStayRate(control.lowestMinor, control.currencyCode);
  return `The cheapest room here is ${lowest} ${control.qualifier}.`;
}
