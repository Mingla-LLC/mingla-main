// priceDecimals — #3645 [a price never shows a single decimal digit].
//
// The ONE place that decides how many decimals a displayed price carries.
//
// WHY: the offering pages asked Intl for "0 to 2" decimals so a whole price
// reads "₦5,000" rather than "₦5,000.00". The same options turn ₦1,515,772.50
// into "₦1,515,772.5" (and £10.50 into "£10.5"), which reads as a broken
// price. The trip and experience headline asked for "0" decimals instead, so a
// price ending in .50 was rounded UP and showed more than the buyer is charged.
//
// RULE (the one packages/brand-rendering/stayGuestMoney.ts already uses for
// stays): a whole amount shows no decimals; anything else shows the currency's
// own full decimals. The full decimals are Intl's default for the currency, so
// this returns no override for them: yen (0 digits) never gains decimals and a
// 3-digit currency keeps all three, without a currency table here.
//
// HOW: spread the result into the options of the formatter that is already
// there. The call stays `withCurrencyGlyph(new Intl.NumberFormat(...).format(
// amount), currency)` so the naira glyph rule (#3341 / #3372) and each
// surface's locale are untouched. Display only: nothing charged or computed
// reads this.
//
// Pure module: no React, no RN, no app imports (I-MOR-0827-PACKAGE-ISOLATION).
// Import it by its deep specifier (`@mingla/offering-rendering/priceDecimals`).

// FLOAT NOISE: a total summed in floats is rarely a clean integer (15 tickets
// at 8.20 is 122.99999999999999), so "whole" is decided AFTER rounding to the
// currency's own minor unit, and Intl does that rounding. An amount within
// half a penny of a whole number asks only for "no minimum decimals": Intl
// rounds it to the currency's digits and drops the zeros, so pounds show
// "£123" while a 3-digit currency still shows "KWD 122.996". That close to a
// whole number the rounded amount can never end in a single decimal.

const WHOLE: Intl.NumberFormatOptions = Object.freeze({
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const WHOLE_IF_IT_ROUNDS_TO_ONE: Intl.NumberFormatOptions = Object.freeze({
  minimumFractionDigits: 0,
});
const CURRENCY_DEFAULT: Intl.NumberFormatOptions = Object.freeze({});

/** Half of the smallest unit of a 2-digit currency, in major units. */
const HALF_A_PENNY = 0.005;

/**
 * Fraction-digit options for a displayed price in MAJOR units.
 *
 * @example priceDecimals(5000)      → no decimals        ("₦5,000")
 * @example priceDecimals(15 * 8.2)  → whole once rounded ("£123")
 * @example priceDecimals(1515772.5) → currency's default ("₦1,515,772.50")
 * @example priceDecimals(10.5)      → currency's default ("£10.50", "¥11")
 */
export const priceDecimals = (amountMajor: number): Intl.NumberFormatOptions => {
  if (Number.isInteger(amountMajor)) return WHOLE;
  return Math.abs(amountMajor - Math.round(amountMajor)) <= HALF_A_PENNY
    ? WHOLE_IF_IT_ROUNDS_TO_ONE
    : CURRENCY_DEFAULT;
};

/**
 * Decimals for the plain-text fallback used when Intl rejects a currency code:
 * none for an amount that is whole once rounded to two decimals, two
 * otherwise. Never one.
 */
export const priceFallbackDecimals = (amountMajor: number): 0 | 2 =>
  Number.isInteger(Number(amountMajor.toFixed(2))) ? 0 : 2;
