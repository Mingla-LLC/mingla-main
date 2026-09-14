// currencyGlyph — #3341 [naira symbol].
//
// The ONE place that decides which glyph a currency shows when the platform
// formatter falls back to its ISO code.
//
// WHY: `Intl.NumberFormat(..., { style: "currency", currency: "NGN" })` prints
// "NGN 25,000" in most locales (en-US, en-GB, the device default), and Hermes
// on iOS can do the same even for en-NG. Other currencies print their symbol
// ($, £, €), so naira read as broken next to them — on the public event page,
// the Business app and checkout alike.
//
// HOW: format as before, then swap the ISO code for the glyph. That works the
// same on every engine and locale, and it is a no-op when the engine already
// printed the glyph. Display only: stored prices and currency codes never
// change, and a null/blank code never gains a symbol (#962 / #1014).
//
// Pure module: no React, no RN, no app imports (I-MOR-0827-PACKAGE-ISOLATION).
// Import it by its deep specifier (`@mingla/offering-rendering/currencyGlyph`),
// not the barrel, so partially-mocked barrels in tests stay untouched.

/**
 * Currencies whose Intl "symbol" display commonly falls back to the ISO code,
 * mapped to the glyph their own users read. Add a row here — never a second
 * copy of this table.
 */
export const LOCAL_CURRENCY_GLYPHS: Readonly<Record<string, string>> =
  Object.freeze({
    NGN: "₦",
  });

// Plain, no-break and narrow no-break spaces — Intl uses all three.
const GAP = "[\\s\\u00a0\\u202f]*";

/**
 * Replace a currency's ISO code with its local glyph inside an already
 * formatted amount.
 *
 * @example withCurrencyGlyph("NGN 25,000", "NGN")   → "₦25,000"
 * @example withCurrencyGlyph("-NGN 5,000.50", "NGN") → "-₦5,000.50"
 * @example withCurrencyGlyph("25 000,00 NGN", "NGN") → "25 000,00 ₦"
 * @example withCurrencyGlyph("₦25,000", "NGN")      → "₦25,000" (unchanged)
 * @example withCurrencyGlyph("$25", "USD")          → "$25" (no glyph row)
 */
export const withCurrencyGlyph = (
  formatted: string,
  currency: string | null | undefined,
): string => {
  const code = currency?.trim().toUpperCase() ?? "";
  if (code.length === 0) return formatted;
  const glyph = LOCAL_CURRENCY_GLYPHS[code];
  if (glyph === undefined || !formatted.includes(code)) return formatted;
  return (
    formatted
      // Code BEFORE the number ("NGN 25,000", "NGN -5", "(NGN 5)"): the glyph
      // hugs the number, like "$25".
      .replace(new RegExp(`${code}${GAP}(?=[-\\u2212+]?[\\d.,])`, "g"), glyph)
      // Code AFTER the number ("25 000 NGN"): keep the locale's spacing.
      .replace(new RegExp(code, "g"), glyph)
  );
};

