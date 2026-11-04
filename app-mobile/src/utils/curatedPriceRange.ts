/**
 * #4265 — curated plan price totals. Pure (no imports) so the rule runs under
 * the Deno unit lane.
 *
 * A stop price whose max is BELOW its min has no known max: the place pool
 * stores an open-ended price ("$100+") as `price_max = null`, and
 * `generate-curated-experiences` writes that as `priceMax: card.price_max ?? 0`
 * (index.ts:820) and sums it into `totalPriceMax` (index.ts:878). Printed as a
 * range that read "$100.00–$0.00". Such a span is open-ended: its min counts
 * toward both ends and the total reads as "from" ("$100+"), never a made-up
 * ceiling (Constitution 9).
 */

export interface PriceSpan {
  min: number;
  max: number;
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
    if (hi < lo) {
      openEnded = true;
      max += lo;
    } else {
      max += hi;
    }
  }
  return { min, max, openEnded };
}

/** "$min–$max", or "$min+" when the max is unknown (below the min). */
export function curatedTotalPriceRange(
  totalPriceMin: number | null | undefined,
  totalPriceMax: number | null | undefined,
): string {
  const total = sumPriceSpans([
    { min: totalPriceMin ?? 0, max: totalPriceMax ?? 0 },
  ]);
  return total.openEnded ? `$${total.min}+` : `$${total.min}–$${total.max}`;
}
