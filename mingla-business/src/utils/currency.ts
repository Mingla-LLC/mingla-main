/**
 * Currency formatters — single source of truth for GBP rendering across
 * mingla-business. ALL currency display passes through this util per
 * Constitution #10 (currency-aware UI).
 *
 * Lifted from inline copies in J-A7 BrandProfileView + J-A11
 * BrandPaymentsView during J-A12 Cycle-2 polish (D-INV-A10-2 watch-point
 * THRESHOLD HIT 2026-04-30 at 2 inline copies).
 *
 * DO NOT add ad-hoc `Intl.NumberFormat` calls for currency outside this
 * file. If a future cycle needs a different currency (USD, EUR, etc.),
 * extend this util with a parameterised function — do NOT inline a new
 * formatter in a component.
 */

/**
 * Format a numeric GBP value as a locale-aware currency string.
 * Always uses `en-GB` locale + GBP currency + max 2 fraction digits.
 *
 * Use for transaction line items, fee breakdowns, payout/refund rows,
 * and active balances — anywhere pence-level accuracy matters.
 *
 * @example formatGbp(156.20)  → "£156.20"
 * @example formatGbp(0)       → "£0.00"
 * @example formatGbp(8420)    → "£8,420.00"
 */
export const formatGbp = (value: number): string =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  }).format(value);

/**
 * Format a numeric GBP value rounded to whole pounds (no decimals).
 *
 * Use for KPI tiles and headline scan numbers — anywhere a glanceable
 * round figure is preferred over pence-level precision.
 *
 * @example formatGbpRound(24180)    → "£24,180"
 * @example formatGbpRound(156.20)   → "£156"
 * @example formatGbpRound(0)        → "£0"
 */
export const formatGbpRound = (value: number): string =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);

/**
 * Format a numeric count with thousands separators using en-GB locale.
 *
 * @example formatCount(1860) → "1,860"
 * @example formatCount(284)  → "284"
 */
export const formatCount = (value: number): string =>
  value.toLocaleString("en-GB");

/**
 * Format a numeric value in any ISO 4217 currency. Multi-currency aware
 * per Constitution #10 — used by V3 multi-country balance UIs that operate
 * in 12+ currencies (USD, GBP, EUR, CHF, CAD, BGN, CZK, DKK, HUF, ISK,
 * NOK, PLN, RON, SEK).
 *
 * Locale picks a sensible default for each currency (en-GB for GBP, en-US
 * for USD, etc.) so glyph + separator conventions match user expectations
 * without requiring the caller to pass a locale.
 *
 * Pass `minor=true` if `value` is already in minor units (pence/cents/öre);
 * the function divides by the currency's minor-unit factor before formatting.
 *
 * @example formatCurrency(156.20, "GBP")      → "£156.20"
 * @example formatCurrency(15620, "GBP", true) → "£156.20"
 * @example formatCurrency(99, "USD")          → "$99.00"
 * @example formatCurrency(8420, "EUR")        → "€8,420.00"
 */
export const formatCurrency = (
  value: number,
  currency: string,
  minor = false,
): string => {
  const code = currency.toUpperCase();
  const locale = LOCALE_BY_CURRENCY[code] ?? "en-GB";
  const major = minor ? value / minorUnitFactor(code) : value;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    maximumFractionDigits: 2,
  }).format(major);
};

/**
 * Round-headline variant of formatCurrency — no decimals, glanceable.
 *
 * @example formatCurrencyRound(24180, "GBP")  → "£24,180"
 * @example formatCurrencyRound(2418000, "GBP", true) → "£24,180"
 */
export const formatCurrencyRound = (
  value: number,
  currency: string,
  minor = false,
): string => {
  const code = currency.toUpperCase();
  const locale = LOCALE_BY_CURRENCY[code] ?? "en-GB";
  const major = minor ? value / minorUnitFactor(code) : value;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0,
  }).format(major);
};

/**
 * Sensible-default locale per currency. Avoids requiring callers to know
 * which locale to pair. Defaults to en-GB for unknown codes.
 */
const LOCALE_BY_CURRENCY: Record<string, string> = {
  GBP: "en-GB",
  USD: "en-US",
  CAD: "en-CA",
  EUR: "en-IE",
  CHF: "de-CH",
  BGN: "bg-BG",
  CZK: "cs-CZ",
  DKK: "da-DK",
  HUF: "hu-HU",
  ISK: "is-IS",
  NOK: "nb-NO",
  PLN: "pl-PL",
  RON: "ro-RO",
  SEK: "sv-SE",
};

/**
 * Minor-unit factor per ISO 4217. Most currencies use 100 (2 decimals);
 * notable exceptions include ISK and HUF (no minor unit in practice — Stripe
 * still uses 100 for HUF, but ISK is 1).
 *
 * Per Stripe docs:
 *   https://docs.stripe.com/currencies#zero-decimal
 */
function minorUnitFactor(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency) ? 1 : 100;
}

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);
