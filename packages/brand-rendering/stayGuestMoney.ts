import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";

export function formatStayMoney(
  amountMinor: string,
  currencyCode: string,
  locale?: string,
): string {
  if (!/^(0|[1-9]\d*)$/.test(amountMinor) || !/^[A-Z]{3}$/.test(currencyCode)) {
    return "Price unavailable";
  }
  const amount = Number(amountMinor);
  if (!Number.isSafeInteger(amount)) return `${currencyCode} ${amountMinor}`;
  const digits = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
  }).resolvedOptions().maximumFractionDigits ?? 2;
  // #4490 W3 fix 3 (W3-N24): "₦10,000.00", not "NGN 10,000.00" (spec 06
  // decision 14; the shared glyph rule, #3341).
  return withCurrencyGlyph(new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount / 10 ** digits), currencyCode);
}

/**
 * issue #1562 [hours-and-price] — the HEADLINE form of the same money.
 *
 * `formatStayMoney` above pins the fraction digits open because a checkout
 * total must show its cents: "$1,284.50" and "$1,284" are different promises,
 * and a line-item table that hides the difference is how a guest is surprised
 * at the card screen. The FIRST SCREEN has the opposite job — one number, read
 * in about a second, in the largest type on the page — and "$350.00 per night"
 * spends two characters of that second on two zeros that carry no information.
 * #1550's approved design draws `$350`.
 *
 * So this drops the fraction ONLY when it is exactly zero, and only ever for
 * display. Every other case keeps the currency's own digits, which is why a
 * ¥ amount (0 digits) and a KWD amount (3) both stay correct without this
 * function knowing anything about either — the exponent still comes from
 * `Intl`, exactly as `formatStayMoney` derives it, so the two can never
 * disagree about what a minor unit is worth.
 *
 * Same validation, same "never fake it" contract: a non-integer string or a
 * non-ISO currency yields "Price unavailable" rather than a plausible number.
 */
export function formatStayRate(
  amountMinor: string,
  currencyCode: string,
  locale?: string,
): string {
  if (!/^(0|[1-9]\d*)$/.test(amountMinor) || !/^[A-Z]{3}$/.test(currencyCode)) {
    return "Price unavailable";
  }
  const amount = Number(amountMinor);
  if (!Number.isSafeInteger(amount)) return `${currencyCode} ${amountMinor}`;
  const digits = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
  }).resolvedOptions().maximumFractionDigits ?? 2;
  const scale = 10 ** digits;
  const whole = amount % scale === 0;
  // #4490 W3 fix 3 (W3-N24): the Stay bar read "From NGN 10,000" on Hermes.
  return withCurrencyGlyph(new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: whole ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(amount / scale), currencyCode);
}
