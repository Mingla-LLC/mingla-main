/**
 * #4265 — curated plan price totals. Pure (no imports) so the rule runs under
 * the Deno unit lane.
 *
 * The place pool stores an open-ended price ("$100+") as `price_max = null`.
 * `generate-curated-experiences` now builds such a stop as max = min and flags
 * it `priceOpenEnded` (plan total: `totalPriceOpenEnded`) — see its
 * curatedPrice.ts. Cards built before that fix (still persisted on devices)
 * carry max 0 under a real min, which printed "$100.00–$0.00". Either signal —
 * the explicit flag, or a max BELOW the min — makes a span open-ended: its min
 * counts toward both ends and the total reads as "from" ("$100+"), never a
 * made-up ceiling (Constitution 9).
 */

export interface PriceSpan {
  min: number;
  max: number;
  /** The server's explicit open-ended flag (priceOpenEnded / totalPriceOpenEnded). */
  openEnded?: boolean | null;
}

export interface PriceTotal {
  min: number;
  max: number;
  /** True when at least one span had no known max. */
  openEnded: boolean;
}

function finiteAmount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function sumPriceSpans(spans: readonly PriceSpan[]): PriceTotal {
  let min = 0;
  let max = 0;
  let openEnded = false;
  for (const span of spans) {
    const lo = finiteAmount(span.min);
    const hi = finiteAmount(span.max);
    min += lo;
    if (span.openEnded === true || hi < lo) {
      openEnded = true;
      max += lo;
    } else {
      max += hi;
    }
  }
  return { min, max, openEnded };
}

/** "$min–$max", or "$min+" when the max is unknown (flagged, or below the min). */
export function curatedTotalPriceRange(
  totalPriceMin: number | null | undefined,
  totalPriceMax: number | null | undefined,
  totalPriceOpenEnded?: boolean | null,
): string {
  const total = sumPriceSpans([
    { min: totalPriceMin ?? 0, max: totalPriceMax ?? 0, openEnded: totalPriceOpenEnded },
  ]);
  return total.openEnded ? `$${total.min}+` : `$${total.min}–$${total.max}`;
}
