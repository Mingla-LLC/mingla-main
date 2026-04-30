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
 * Format a numeric count with thousands separators using en-GB locale.
 *
 * @example formatCount(1860) → "1,860"
 * @example formatCount(284)  → "284"
 */
export const formatCount = (value: number): string =>
  value.toLocaleString("en-GB");
