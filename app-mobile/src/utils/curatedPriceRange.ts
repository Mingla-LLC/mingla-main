/**
 * #4265 — curated plan price totals. Pure (no imports) so the rule runs under
 * the Deno unit lane.
 *
 * The place pool stores an open-ended price ("$100+") as `price_max = null`.
 * `generate-curated-experiences` and the replace-stop alternatives now build
 * such a stop as max = min and flag it `priceOpenEnded` (plan total:
 * `totalPriceOpenEnded`) — see supabase/functions/_shared/curatedPrice.ts.
 * Shared plans carry both flags (contentShare allowlists). Cards built before
 * that fix (still persisted on devices)
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

/**
 * #4347 Decision 2 — an AI-curated plan's SPEND LEVEL.
 *
 * The stop prices of an AI plan are not money: `admin-seed-places` writes fixed
 * USD tier constants (0/50/150/300/500) from Google's price level. Converting
 * them would print an exact-looking figure in naira or euros that nobody
 * charges. So an AI plan shows how expensive it is, never how much: the
 * priciest visible stop decides the level (a plan is as upscale as its most
 * upscale stop). Brand experiences are real money and never come through here.
 */
export type SpendLevel = 'free' | 'budget' | 'moderate' | 'upscale';

export interface SpendStop {
  priceMin?: number | null;
  priceMax?: number | null;
}

export function curatedSpendLevel(stops: readonly SpendStop[]): SpendLevel | null {
  if (!Array.isArray(stops) || stops.length === 0) return null;
  let top = 0;
  for (const stop of stops) {
    top = Math.max(top, finiteAmount(stop.priceMin), finiteAmount(stop.priceMax));
  }
  if (top <= 0) return 'free';
  // The tier ceilings the constants come from: chill ≤ 50, comfy ≤ 150.
  if (top <= 50) return 'budget';
  if (top <= 150) return 'moderate';
  return 'upscale';
}
