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
}): string {
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
