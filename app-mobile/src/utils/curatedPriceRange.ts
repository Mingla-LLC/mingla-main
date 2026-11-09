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
 * #4347 — an AI-curated plan's price.
 *
 * Decision 2 (2026-11-08) assumed an AI plan's stop amounts were fixed USD tier
 * constants and showed only a SPEND LEVEL. They are not: `generate-curated-
 * experiences` fills `priceMin` / `priceMax` from Google's per-person range,
 * which is in the PLACE's currency (₦100,000 at a Lagos restaurant). Read as
 * dollars, every paid Lagos stop was "Upscale".
 *
 * Round 2 (Seth, 2026-11-09): stops now carry `priceCurrency` and Google's
 * `priceLevel`, and the plan shows a real estimate when it honestly can:
 *
 *   - a stop is PRICED when it has a currency and a start price > 0;
 *   - a stop is FREE only when Google says PRICE_LEVEL_FREE;
 *   - otherwise it is UNKNOWN, and an unknown stop in a category where people
 *     pay (dining, drinks, films, play…) makes a total dishonest.
 *
 * The plan estimate is the sum of the priced stops' start prices ("From ≈ ₦100K
 * pp"), only when at least one stop is priced, every priced stop shares one
 * currency, and no paying-category stop is unknown. Otherwise the plan falls
 * back to the SPEND LEVEL, now taken from Google's level rather than from the
 * amounts. Cards built before round 2 carry neither field and keep the old
 * level rule until they refresh. Brand experiences are real money and never
 * come through here.
 */
export type SpendLevel = 'free' | 'budget' | 'moderate' | 'upscale';

export interface SpendStop {
  priceMin?: number | null;
  priceMax?: number | null;
  priceOpenEnded?: boolean | null;
  /** #4347 r2 — ISO code of priceMin/priceMax; absent on cards built before round 2. */
  priceCurrency?: string | null;
  /** #4347 r2 — Google's level ("PRICE_LEVEL_MODERATE"); absent/null when unknown. */
  priceLevel?: string | null;
  /** The stop's Mingla category (comboCategory is mirrored into placeType). */
  placeType?: string | null;
  comboCategory?: string | null;
}

/** Categories where a visit normally costs money, so a missing price matters. */
const PAYING_CATEGORIES: ReadonlySet<string> = new Set([
  'brunch',
  'casual_food',
  'brunch_lunch_casual',
  'upscale_fine_dining',
  'fine_dining',
  'drinks_and_music',
  'drinks',
  'icebreakers',
  'movies',
  'theatre',
  'movies_theatre',
  'play',
]);

const CURRENCY_CODE = /^[A-Z]{3}$/;

const LEVEL_RANK: Readonly<Record<string, SpendLevel>> = {
  PRICE_LEVEL_FREE: 'free',
  PRICE_LEVEL_INEXPENSIVE: 'budget',
  PRICE_LEVEL_MODERATE: 'moderate',
  PRICE_LEVEL_EXPENSIVE: 'upscale',
  PRICE_LEVEL_VERY_EXPENSIVE: 'upscale',
};
const LEVEL_ORDER: readonly SpendLevel[] = ['free', 'budget', 'moderate', 'upscale'];

export type StopPriceView =
  | { readonly kind: 'priced'; readonly min: number; readonly max: number; readonly openEnded: boolean; readonly currency: string }
  | { readonly kind: 'free' }
  | { readonly kind: 'unknown'; readonly paying: boolean };

/** Whether a stop came from a round-2 builder (it says what its amounts are). */
function carriesPriceIdentity(stop: SpendStop): boolean {
  return 'priceCurrency' in stop || 'priceLevel' in stop;
}

/** One stop's price, as honestly as its data allows. */
export function stopPriceView(stop: SpendStop): StopPriceView {
  const currency = typeof stop.priceCurrency === 'string' && CURRENCY_CODE.test(stop.priceCurrency) ? stop.priceCurrency : null;
  const min = finiteAmount(stop.priceMin);
  if (currency !== null && min > 0) {
    const max = finiteAmount(stop.priceMax);
    const openEnded = stop.priceOpenEnded === true || max < min;
    return { kind: 'priced', min, max: openEnded ? min : max, openEnded, currency };
  }
  if (stop.priceLevel === 'PRICE_LEVEL_FREE') return { kind: 'free' };
  const category = stop.comboCategory ?? stop.placeType ?? '';
  return { kind: 'unknown', paying: PAYING_CATEGORIES.has(category) };
}

export interface PlanEstimate {
  /** Sum of the priced stops' start prices, in `currency` major units. */
  readonly min: number;
  readonly currency: string;
}

/**
 * The plan's "From ≈ X pp" estimate, or null when it would not be honest (no
 * priced stop, mixed currencies, or a paying stop with no price).
 */
export function curatedPlanEstimate(stops: readonly SpendStop[]): PlanEstimate | null {
  if (!Array.isArray(stops) || stops.length === 0) return null;
  let min = 0;
  let currency: string | null = null;
  for (const stop of stops) {
    const view = stopPriceView(stop);
    if (view.kind === 'unknown' && view.paying) return null;
    if (view.kind !== 'priced') continue;
    if (currency !== null && currency !== view.currency) return null;
    currency = view.currency;
    min += view.min;
  }
  return currency === null ? null : { min, currency };
}

export function curatedSpendLevel(stops: readonly SpendStop[]): SpendLevel | null {
  if (!Array.isArray(stops) || stops.length === 0) return null;
  if (stops.some(carriesPriceIdentity)) {
    // Round 2: the level is Google's, never inferred from local-currency amounts.
    let top = -1;
    for (const stop of stops) {
      const level = typeof stop.priceLevel === 'string' ? LEVEL_RANK[stop.priceLevel] : undefined;
      if (level !== undefined) top = Math.max(top, LEVEL_ORDER.indexOf(level));
    }
    return top < 0 ? null : LEVEL_ORDER[top];
  }
  // [TRANSITIONAL] cards built before round 2 (no priceCurrency / priceLevel):
  // the old amount rule, so a cached deck keeps its word until it refreshes.
  // Exit: remove once no persisted deck predates the round-2 OTA.
  let top = 0;
  for (const stop of stops) {
    top = Math.max(top, finiteAmount(stop.priceMin), finiteAmount(stop.priceMax));
  }
  if (top <= 0) return 'free';
  if (top <= 50) return 'budget';
  if (top <= 150) return 'moderate';
  return 'upscale';
}
