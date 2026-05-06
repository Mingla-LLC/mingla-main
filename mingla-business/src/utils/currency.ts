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
 * Format a major-unit amount in any ISO 4217 currency (Constitution #10).
 *
 * @param value — major units (e.g. pounds, dollars), not cents
 * @param currency — 3-letter ISO code (e.g. GBP, USD)
 */
export function formatMoneyMajor(value: number, currency: string): string {
  const code = currency.trim().toUpperCase().slice(0, 3);
  if (code.length !== 3) {
    return formatGbp(value);
  }
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return formatGbp(value);
  }
}

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
