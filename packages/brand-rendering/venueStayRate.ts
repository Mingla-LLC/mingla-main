/**
 * issue #1562 [hours-and-price], step 6 of #1550 — WHAT A HOTEL COSTS.
 *
 * #1561 measured a Stay at 3 of 4 on the five-second test and named the missing
 * point: PRICE. Its answer-bar price slot is a total `Record<VenuePricingModel,
 * …>` whose `nightlyFrom` arm returned null behind a `[TRANSITIONAL]` marker
 * naming this issue as the exit condition. This module is that exit condition.
 *
 * NO NEW DATA, and that is checkable. `pg_public_stay_details`
 * (`20270131013820_issue_1390_stay_guest_reads.sql`) already returns, for every
 * offering whose `status = 'live'`, a `price { amountMinor, currencyCode,
 * pricingUnit }` and a `fees[]` carrying `displayMode`. `parsePublicStayDetail`
 * already THROWS `stay_public_offering_invalid` unless every offering has both
 * `amountMinor` and `currencyCode` as strings. No query, no column, no RPC is
 * added here — this file is a reduction over bytes already on the wire.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE THREE THINGS THIS GETS RIGHT THAT A NAIVE `Math.min` WOULD NOT
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 1. NOT EVERY OFFERING IS A NIGHT. `stay_price_versions.pricing_unit` is one
 *    of `room_night | place_booking | place_unit | place_guest`. The live
 *    Miami property carries a $75 Pool Cabana priced `place_booking` beside a
 *    $275 Garden Suite and a $350 Ocean Suite priced `room_night`. A min over
 *    ALL offerings would publish "from $75 per night" for a cabana that is not
 *    a night and not a room — a fabricated fact (Constitution #9) rendered in
 *    the largest type on the page. Only `room_night` forms a nightly rate.
 *
 * 2. CURRENCY IS PER-OFFERING, NOT PER-VENUE. `stay_price_versions.currency_
 *    code` is a column on the PRICE, and `PublicStayDetail` carries no venue
 *    currency to fall back on. When the nightly offerings do not agree on one
 *    currency there is no honest single number: a min across USD and EUR
 *    compares two different things and a "majority currency" invents a venue
 *    fact nobody stated. So the rate resolves to NULL and the cell disappears —
 *    the design's own stated rule for absent data, and the same rule #1561
 *    already ships for a venue with no price at all.
 *
 * 3. `amountMinor` IS A STRING. It arrives as `bigint::text` precisely so a
 *    large minor amount cannot lose precision crossing JSON. It is validated
 *    against the same integer grammar `formatStayMoney` uses, and an offering
 *    that fails it is DROPPED rather than coerced — `Number("")` is 0, and a
 *    zero would silently become the cheapest room in the building.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE QUALIFIER IS PART OF THE NUMBER, NOT A FOOTNOTE
 * ───────────────────────────────────────────────────────────────────────────
 * Mingla prices all-in. A from-rate is not all-in, and #1550 approved showing
 * one anyway with the tension owned rather than hidden. `allIn` below is the
 * data half of that: it is READ FROM THE ROWS, never assumed.
 *
 *   allIn ⇔ the offerings that formed the rate carry at least one live fee AND
 *           every one of those fees has `displayMode === "included"`.
 *
 * The `at least one` is load-bearing and deliberately conservative. `stay_fee_
 * versions.display_mode` defaults to `'separate'` and `included` fees are
 * excluded from the quote's fee/tax totals (`20270131013811…sql:952-958`
 * filters `NOT included_in_base`), so an all-`included` offering's base price
 * IS its total. But an offering with NO fee rows at all is not evidence that
 * tax is included — it is evidence that nobody has configured a fee yet. Those
 * two look identical to `every()` on an empty array, which returns true. Saying
 * "taxes and fees included" on the strength of an empty array would be exactly
 * the fabrication this codebase forbids, so zero fees reads as the honest
 * "before taxes and fees".
 *
 * NO RUNTIME IMPORTS beyond the one pure money formatter.
 */
import { formatStayRate } from "./stayGuestMoney";

/**
 * The minimum shape this module needs. Structurally satisfied by
 * `PublicStayOffering` without importing it, which keeps the reduction usable
 * from a test fixture and from either app without dragging the whole Stay
 * guest model into the answer bar's dependency graph.
 */
export interface VenueStayRateOffering {
  price: {
    amountMinor: string;
    currencyCode: string;
    pricingUnit: string;
  };
  fees: readonly { displayMode: "included" | "separate" }[];
}

export interface VenueStayRate {
  /** The lowest nightly rate, in minor units, exactly as it arrived. */
  fromMinor: string;
  /** The highest, when it differs from the lowest. Null ⇒ one rate only. */
  toMinor: string | null;
  currencyCode: string;
  /** Read from `fees[].displayMode` — never assumed. See the docblock. */
  allIn: boolean;
  /**
   * How many nightly offerings formed this rate. A vacuity witness: a test can
   * assert the reduction actually saw rooms rather than passing because the
   * fixture happened to be empty.
   */
  offeringCount: number;
}

/** The only pricing unit that is a night. */
const NIGHTLY_UNIT = "room_night";

/** Same grammar `formatStayMoney` validates against — one owner for "is this money". */
const MINOR_AMOUNT = /^(0|[1-9]\d*)$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;

/**
 * The nightly from-rate over a Stay's live offerings, or null when there is no
 * honest single answer. Null is a first-class outcome, not a failure: the
 * answer bar drops the cell and shrinks, which is what the design says absent
 * data must do.
 */
export function resolveVenueStayRate(
  offerings: readonly VenueStayRateOffering[],
): VenueStayRate | null {
  const nightly: { amount: number; minor: string; currency: string }[] = [];
  const fees: { displayMode: "included" | "separate" }[] = [];
  // Wire boundary: `offerings` is whatever `parsePublicStayDetail` produced,
  // and a fixture or an older payload can hand this a non-array. Guarding here
  // is what keeps "no honest rate" from becoming "the page crashed".
  if (!Array.isArray(offerings)) return null;
  for (const offering of offerings) {
    if (offering === null || typeof offering !== "object") continue;
    const price = offering.price;
    if (price === null || price === undefined) continue;
    if (price.pricingUnit !== NIGHTLY_UNIT) continue;
    if (typeof price.amountMinor !== "string") continue;
    if (typeof price.currencyCode !== "string") continue;
    if (!MINOR_AMOUNT.test(price.amountMinor)) continue;
    if (!CURRENCY_CODE.test(price.currencyCode)) continue;
    const amount = Number(price.amountMinor);
    if (!Number.isSafeInteger(amount)) continue;
    nightly.push({
      amount,
      minor: price.amountMinor,
      currency: price.currencyCode,
    });
    if (Array.isArray(offering.fees)) {
      for (const fee of offering.fees) fees.push(fee);
    }
  }
  if (nightly.length === 0) return null;
  // Per-offering currency: one currency or no claim. See the docblock.
  const currency = nightly[0].currency;
  if (nightly.some((entry) => entry.currency !== currency)) return null;

  let lowest = nightly[0];
  let highest = nightly[0];
  for (const entry of nightly) {
    if (entry.amount < lowest.amount) lowest = entry;
    if (entry.amount > highest.amount) highest = entry;
  }
  return {
    fromMinor: lowest.minor,
    toMinor: highest.amount > lowest.amount ? highest.minor : null,
    currencyCode: currency,
    allIn:
      fees.length > 0 && fees.every((fee) => fee.displayMode === "included"),
    offeringCount: nightly.length,
  };
}

/**
 * THE QUALIFIER. It exists as its own function so that the answer-bar cell and
 * the Overview lede cannot drift into saying different things about the same
 * number, and so a test can assert the "reads itself from the data" claim
 * directly rather than through a rendered string.
 */
export function venueStayRateQualifier(rate: VenueStayRate): string {
  return rate.allIn
    ? "per night · all-in, taxes and fees included"
    : "per night · before taxes and fees";
}

/** "$275" / "₦27,500" — the number a stranger reads, minus empty decimals. */
export function venueStayRateValue(rate: VenueStayRate): string {
  return formatStayRate(rate.fromMinor, rate.currencyCode);
}

/**
 * The Overview lede's sentence: the FULL range, which the one-number answer
 * cell cannot carry. Same qualifier, same resolver, so the two can only ever
 * agree.
 */
export function venueStayRateRangeLine(rate: VenueStayRate): string {
  const from = formatStayRate(rate.fromMinor, rate.currencyCode);
  const qualifier = venueStayRateQualifier(rate);
  if (rate.toMinor === null) return `Rooms from ${from} · ${qualifier}`;
  const to = formatStayRate(rate.toMinor, rate.currencyCode);
  return `Rooms ${from}–${to} · ${qualifier}`;
}

/**
 * MITIGATION 2, the honest number taking over. The moment a guest picks dates
 * the Reservations tab quotes a REAL total — base + every separate fee + every
 * tax, computed server-side (`stay_quotes`, `20270131013811…sql`). This is the
 * view of it the first screen shows, and it deliberately occupies the SAME
 * price slot at the SAME size as the from-rate rather than appearing somewhere
 * new: the guest does not get ambushed by a bigger number three screens later,
 * because the number in front of them changed the moment it could be known.
 */
export interface VenueStayQuoteView {
  totalMinor: string;
  currencyCode: string;
}

/** The quoted total, or null when the quote is unusable (never a guess). */
export function venueStayQuoteValue(
  quote: VenueStayQuoteView | null,
): string | null {
  if (quote === null) return null;
  if (typeof quote.totalMinor !== "string") return null;
  if (typeof quote.currencyCode !== "string") return null;
  if (!MINOR_AMOUNT.test(quote.totalMinor)) return null;
  if (!CURRENCY_CODE.test(quote.currencyCode)) return null;
  return formatStayRate(quote.totalMinor, quote.currencyCode);
}
