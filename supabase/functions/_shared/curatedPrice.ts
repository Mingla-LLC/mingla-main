/**
 * #4265 — curated plan prices, built honestly at the source. Pure (no imports)
 * so the Deno unit lane can load it without the HTTP server or the database.
 *
 * The place pool stores an open-ended price ("$100+") as `price_max = null`.
 * The builder used to write that as `priceMax: card.price_max ?? 0` and sum it
 * into `totalPriceMax`, so a "$100+" stop became min 100 / max 0 and a plan
 * read "$150–$100". An unknown max is never 0: the stop's max falls back to its
 * min and the stop (and any plan total that includes it) is flagged
 * open-ended, so clients print "from" ("$100+") instead of a made-up ceiling
 * (Constitution 9).
 *
 * Wire shape is backward compatible: `priceMin` / `priceMax` /
 * `totalPriceMin` / `totalPriceMax` stay numbers; `priceOpenEnded` and
 * `totalPriceOpenEnded` are optional booleans emitted only when true.
 */

export interface StopPrice {
  priceMin: number;
  priceMax: number;
  priceOpenEnded?: true;
}

export interface PlanPriceTotal {
  totalPriceMin: number;
  totalPriceMax: number;
  totalPriceOpenEnded?: true;
}

function finiteAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A stop's price from a place_pool row's `price_min` / `price_max`. */
export function buildStopPrice(priceMin: unknown, priceMax: unknown): StopPrice {
  const min = finiteAmount(priceMin) ?? 0;
  const max = finiteAmount(priceMax);
  // No max, or a max below the min, means the ceiling is unknown. A stop with
  // neither number keeps its 0/0 (unknown price is not an open-ended price).
  if (min > 0 && (max === null || max < min)) {
    return { priceMin: min, priceMax: min, priceOpenEnded: true };
  }
  return { priceMin: min, priceMax: max ?? min };
}

/** A plan total: sums of the stops, open-ended when any stop is. */
export function sumStopPrices(stops: ReadonlyArray<Partial<StopPrice>>): PlanPriceTotal {
  let totalPriceMin = 0;
  let totalPriceMax = 0;
  let openEnded = false;
  for (const stop of stops) {
    const min = finiteAmount(stop.priceMin) ?? 0;
    const rawMax = finiteAmount(stop.priceMax);
    // Defensive for rows built before this fix (max 0 under a real min).
    const stopOpen = stop.priceOpenEnded === true || (min > 0 && (rawMax === null || rawMax < min));
    totalPriceMin += min;
    totalPriceMax += stopOpen ? min : (rawMax ?? min);
    if (stopOpen) openEnded = true;
  }
  return openEnded
    ? { totalPriceMin, totalPriceMax, totalPriceOpenEnded: true }
    : { totalPriceMin, totalPriceMax };
}

/**
 * #4347 round 2 — what a stop's amounts ARE. `priceMin` / `priceMax` come from
 * Google's per-person range, which is in the PLACE's currency (₦100,000 at a
 * Lagos restaurant), so they never travel without the code. `priceLevel` lets
 * a client tell a free place ("PRICE_LEVEL_FREE") from one Google gave no range
 * for. Both are null when unknown — never a guessed default (Constitution 9).
 */
export interface StopPriceIdentity {
  priceCurrency: string | null;
  priceLevel: string | null;
}

const CURRENCY_CODE = /^[A-Z]{3}$/;
const GOOGLE_PRICE_LEVEL = /^PRICE_LEVEL_[A-Z_]+$/;

/** A place_pool `price_range_currency` value, or null when it is not an ISO code. */
export function rangeCurrency(value: unknown): string | null {
  return typeof value === 'string' && CURRENCY_CODE.test(value) ? value : null;
}

/** The stop's currency + Google level, from a shaped place row. */
export function stopPriceIdentity(row: { price_currency?: unknown; price_level?: unknown }): StopPriceIdentity {
  return {
    priceCurrency: rangeCurrency(row.price_currency),
    priceLevel: typeof row.price_level === 'string' && GOOGLE_PRICE_LEVEL.test(row.price_level) ? row.price_level : null,
  };
}
