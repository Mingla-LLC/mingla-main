/**
 * Price Tier System — Single Source of Truth for ALL edge functions.
 *
 * 4-tier model mapped to Google Places API price levels:
 *   Chill  ($50 max)     = PRICE_LEVEL_FREE + PRICE_LEVEL_INEXPENSIVE
 *   Comfy  ($50–$150)    = PRICE_LEVEL_MODERATE
 *   Bougie ($150–$300)   = PRICE_LEVEL_EXPENSIVE
 *   Lavish ($300+)       = PRICE_LEVEL_VERY_EXPENSIVE
 *
 * Must stay in sync with app-mobile/src/constants/priceTiers.ts
 */

export type PriceTierSlug = 'chill' | 'comfy' | 'bougie' | 'lavish';

export interface PriceTier {
  slug: PriceTierSlug;
  label: string;
  rangeLabel: string;
  googleLevels: string[];
  min: number;
  max: number | null;
}

export const PRICE_TIERS: readonly PriceTier[] = [
  {
    slug: 'chill',
    label: 'Chill',
    rangeLabel: '$50 max',
    googleLevels: ['PRICE_LEVEL_FREE', 'PRICE_LEVEL_INEXPENSIVE'],
    min: 0,
    max: 50,
  },
  {
    slug: 'comfy',
    label: 'Comfy',
    rangeLabel: '$50 – $150',
    googleLevels: ['PRICE_LEVEL_MODERATE'],
    min: 50,
    max: 150,
  },
  {
    slug: 'bougie',
    label: 'Bougie',
    rangeLabel: '$150 – $300',
    googleLevels: ['PRICE_LEVEL_EXPENSIVE'],
    min: 150,
    max: 300,
  },
  {
    slug: 'lavish',
    label: 'Lavish',
    rangeLabel: '$300+',
    googleLevels: ['PRICE_LEVEL_VERY_EXPENSIVE'],
    min: 300,
    max: null,
  },
] as const;

export const GOOGLE_LEVEL_TO_TIER: Record<string, PriceTierSlug> = {};
for (const tier of PRICE_TIERS) {
  for (const level of tier.googleLevels) {
    GOOGLE_LEVEL_TO_TIER[level] = tier.slug;
  }
}

export const TIER_BY_SLUG: Record<PriceTierSlug, PriceTier> = {} as Record<PriceTierSlug, PriceTier>;
for (const tier of PRICE_TIERS) {
  TIER_BY_SLUG[tier.slug] = tier;
}

export function googleLevelToTierSlug(priceLevel: string | number | null | undefined): PriceTierSlug {
  if (priceLevel === null || priceLevel === undefined) return 'chill';
  if (typeof priceLevel === 'number') {
    const levels = ['PRICE_LEVEL_FREE', 'PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE', 'PRICE_LEVEL_EXPENSIVE', 'PRICE_LEVEL_VERY_EXPENSIVE'];
    return GOOGLE_LEVEL_TO_TIER[levels[priceLevel] ?? ''] ?? 'chill';
  }
  return GOOGLE_LEVEL_TO_TIER[priceLevel] ?? 'chill';
}

export function priceLevelToLabel(priceLevel: string | number | null | undefined): string {
  return TIER_BY_SLUG[googleLevelToTierSlug(priceLevel)].label;
}

export function priceLevelToRange(priceLevel: string | number | null | undefined): { min: number; max: number } {
  const tier = TIER_BY_SLUG[googleLevelToTierSlug(priceLevel)];
  return { min: tier.min, max: tier.max ?? 500 };
}

export function cardMatchesTiers(cardTier: PriceTierSlug, userTiers: PriceTierSlug[]): boolean {
  return userTiers.includes(cardTier);
}

/**
 * Derive a price tier from a dollar amount (uses the upper bound of the range).
 * Used when we have price_min/price_max but no Google priceLevel.
 */
export function priceTierFromAmount(priceMin: number, priceMax: number): PriceTierSlug {
  const amount = priceMax > 0 ? priceMax : priceMin;
  if (amount <= 0) return 'chill';
  for (const tier of PRICE_TIERS) {
    if (tier.max !== null && amount <= tier.max) return tier.slug;
  }
  return 'lavish';
}
