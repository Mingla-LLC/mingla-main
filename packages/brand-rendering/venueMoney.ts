/**
 * #1559 [shared-venue-screen] — the venue page's money formatting, moved to
 * its ONE owner so both surfaces format a price the same way.
 *
 * These two functions were `mingla-business/src/utils/currencyFormatter.ts`
 * only. The public venue page's typical-spend lede calls `formatSourceRange`,
 * and #1560 points the consumer app at the same renderer — a package cannot
 * import app `src/` (I-MOR-0827-PACKAGE-ISOLATION), so the owner moves here and
 * `currencyFormatter.ts` re-exports. Behaviour is byte-identical: the bodies
 * below are the originals, unmodified.
 *
 * Currency-aware by construction (Constitution #10): the exponent is supplied
 * by the caller from the row's own `minor_unit_exponent`, never assumed to be 2,
 * so zero-decimal currencies (JPY, KRW) render correctly.
 */

import {
  LOCAL_CURRENCY_GLYPHS,
  withCurrencyGlyph,
} from "@mingla/offering-rendering/currencyGlyph";

export function formatMinorCurrency(
  amountMinor: number,
  currencyCode: string,
  exponent: number,
  locale?: string,
): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(amountMinor / 10 ** exponent);
}

export function formatSourceRange(input: {
  minMinor: number;
  maxMinor: number | null;
  currencyCode: string;
  exponent: number;
  locale?: string;
  /**
   * #4490 W3 fix 4 (W3-N31): "venue" is the GUEST venue page's typical spend
   * (see `venueSpendRange` below); absent ("source") is the original text,
   * which the host's claim step shows on purpose.
   */
  display?: "source" | "venue";
}): string {
  if (input.display === "venue") {
    const venue = venueSpendRange(input);
    if (venue !== null) return venue;
  }
  const min = formatMinorCurrency(
    input.minMinor,
    input.currencyCode,
    input.exponent,
    input.locale,
  );
  if (input.maxMinor === null) return `${min}+ · ${input.currencyCode}`;
  const max = formatMinorCurrency(
    input.maxMinor,
    input.currencyCode,
    input.exponent,
    input.locale,
  );
  return `${min}–${max} · ${input.currencyCode}`;
}

/**
 * #4490 W3 fix 4 (W3-N31) — the GUEST venue page's typical spend ("Typically
 * ₦20,000–₦150,000 a head", "Typical spend · ₦20,000–₦150,000").
 *
 * Hermes (and en-US on V8) print Naira as its code, so `formatSourceRange`
 * read "NGN 20,000.00–NGN 150,000.00 · NGN" next to a page that says
 * "₦4,000" everywhere else. A currency with a local glyph (the one table in
 * `currencyGlyph`, today only NGN; spec 06 decision 14) reads like the rest of
 * the venue page: the glyph, whole amounts without ".00", and no trailing code
 * (the glyph already names it). Null for every other currency, which then
 * prints exactly as before, so "£25.00–£60.00 · GBP" does not change. The
 * host's claim step calls without `display` and is unchanged.
 */
function venueSpendRange(input: {
  minMinor: number;
  maxMinor: number | null;
  currencyCode: string;
  exponent: number;
}): string | null {
  const code = input.currencyCode.trim().toUpperCase();
  if (LOCAL_CURRENCY_GLYPHS[code] === undefined) return null;
  const amount = (minor: number): string => {
    if (!Number.isSafeInteger(minor) || minor < 0) return "—";
    const whole = minor % 10 ** input.exponent === 0;
    try {
      return withCurrencyGlyph(
        new Intl.NumberFormat("en", {
          style: "currency",
          currency: code,
          currencyDisplay: "narrowSymbol",
          minimumFractionDigits: whole ? 0 : input.exponent,
          maximumFractionDigits: whole ? 0 : input.exponent,
        }).format(minor / 10 ** input.exponent),
        code,
      );
    } catch {
      return withCurrencyGlyph(formatMinorCurrency(minor, code, input.exponent), code);
    }
  };
  const min = amount(input.minMinor);
  return input.maxMinor === null ? `${min}+` : `${min}–${amount(input.maxMinor)}`;
}

/**
 * "₦4,000" for whole amounts, "₦4,000.50" otherwise. Falls back to the plain
 * formatter when the engine has no narrow symbol for the currency.
 */
export function formatVenueMoney(
  minor: number,
  currencyCode: string,
  exponent: number,
): string {
  if (!Number.isSafeInteger(minor) || minor < 0) return "—";
  const whole = minor % 10 ** exponent === 0;
  // W3 fix 3 (W3-N24): Hermes has no narrow naira symbol and prints
  // "NGN 4,000"; the shared glyph rule (#3341) makes it "₦4,000" on every
  // engine (spec 06 decision 14: Naira shows ₦). A no-op on V8.
  try {
    return withCurrencyGlyph(
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: currencyCode,
        currencyDisplay: "narrowSymbol",
        minimumFractionDigits: whole ? 0 : exponent,
        maximumFractionDigits: whole ? 0 : exponent,
      }).format(minor / 10 ** exponent),
      currencyCode,
    );
  } catch {
    return withCurrencyGlyph(formatMinorCurrency(minor, currencyCode, exponent), currencyCode);
  }
}
