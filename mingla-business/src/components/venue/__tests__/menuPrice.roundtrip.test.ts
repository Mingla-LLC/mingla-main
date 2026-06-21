/**
 * ORCH-1186-C — menu price round-trip + display (fails-on-revert anchor for SC-4).
 *
 * Asserts the currency-aware draft → cents → display round-trip the MenuItemSheet
 * + VenueMenuModule + public MenuTab rely on:
 *   - USD "12.50" → price_cents 1250, redisplay "$12.50"
 *   - JPY "1250"  → price_cents 1250 (zero-decimal), redisplay "¥1,250"
 *   - blank price → null, public page shows NO price (formatMenuPrice → null)
 *
 * Reverting minorFromMajor to a currency-blind `* 100` flips the JPY case → FAIL.
 *
 * `formatMenuPrice` is package-local in packages/brand-rendering/PublicBrandPage.tsx
 * (cross-package boundary — the package must not import mingla-business utils), so
 * this test replicates it verbatim. Reverting the package helper to a GBP-default
 * / hardcoded-currency form would diverge from this asserted contract.
 */

import {
  majorFromMinor,
  minorFromMajor,
  formatCurrency,
} from "../../../utils/currency";

// Verbatim mirror of packages/brand-rendering/PublicBrandPage.tsx#formatMenuPrice
// (currency-aware minor-unit factor — zero-decimal currencies use factor 1).
const MENU_ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX",
  "VND", "VUV", "XAF", "XOF", "XPF",
]);
const menuMinorFactor = (currency: string): number =>
  MENU_ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100;
const formatMenuPrice = (
  priceCents: number | null,
  currency: string,
): string | null => {
  if (priceCents === null) return null;
  const major = priceCents / menuMinorFactor(currency);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
};

// Parse a typed major-unit draft into integer minor units (the MenuItemSheet
// commit path: blank/negative → null = "price on request").
const draftToCents = (draft: string, currency: string): number | null => {
  const trimmed = draft.replace(/,/g, "").trim();
  if (trimmed.length === 0) return null;
  const major = Number.parseFloat(trimmed);
  if (!Number.isFinite(major) || major < 0) return null;
  return minorFromMajor(major, currency);
};

describe("ORCH-1186-C menu price round-trip (SC-4)", () => {
  it("T-SVC-1 — USD 12.50 → 1250 cents, redisplays $12.50", () => {
    const cents = draftToCents("12.50", "USD");
    expect(cents).toBe(1250);
    // Builder display (formatCurrency) and public display (formatMenuPrice).
    expect(formatCurrency(1250, "USD", true)).toBe("$12.50");
    expect(formatMenuPrice(1250, "USD")).toBe("$12.50");
    // Hydrate round-trip: cents → major draft.
    expect(majorFromMinor(1250, "USD")).toBe(12.5);
  });

  it("T-SVC-2 — JPY 1250 → 1250 cents (zero-decimal), redisplays ¥1,250", () => {
    const cents = draftToCents("1250", "JPY");
    // Zero-decimal currency: minor factor is 1, so 1250 major → 1250 cents.
    expect(cents).toBe(1250);
    const display = formatMenuPrice(1250, "JPY");
    // ¥1,250 with NO decimals (Intl handles zero-decimal currencies).
    expect(display).toMatch(/1,250/);
    expect(display).not.toMatch(/\.00/);
    // Hydrate round-trip: zero-decimal stays integer.
    expect(majorFromMinor(1250, "JPY")).toBe(1250);
  });

  it("T-SVC-3 — blank price → null; public page renders NO price (never $0)", () => {
    expect(draftToCents("", "USD")).toBeNull();
    expect(draftToCents("   ", "USD")).toBeNull();
    expect(formatMenuPrice(null, "USD")).toBeNull();
    // A real zero is still a valid price ($0.00), NOT "price on request".
    expect(formatMenuPrice(0, "USD")).toBe("$0.00");
  });

  it("currency is honored, never GBP-defaulted (SC-9)", () => {
    expect(formatMenuPrice(1000, "EUR")).toMatch(/€/);
    expect(formatMenuPrice(1000, "NGN")).not.toMatch(/£/);
  });
});
