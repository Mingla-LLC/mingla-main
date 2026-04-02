/**
 * Price Tier System — Mobile-side single source of truth.
 *
 * 4-tier model mapped to Google Places API price levels:
 *   Chill  ($50 max)     = PRICE_LEVEL_FREE + PRICE_LEVEL_INEXPENSIVE
 *   Comfy  ($50–$150)    = PRICE_LEVEL_MODERATE
 *   Bougie ($150–$300)   = PRICE_LEVEL_EXPENSIVE
 *   Lavish ($300+)       = PRICE_LEVEL_VERY_EXPENSIVE
 *
 * Must stay in sync with supabase/functions/_shared/priceTiers.ts
 */

export type PriceTierSlug = 'any' | 'chill' | 'comfy' | 'bougie' | 'lavish';

export interface PriceTier {
  slug: PriceTierSlug;
  label: string;
  rangeLabel: string;
  googleLevels: string[];
  min: number;
  max: number | null;
  icon: string;
  color: string;
}

export const PRICE_TIERS: readonly PriceTier[] = [
  { slug: 'any', label: 'Any', rangeLabel: 'All prices', googleLevels: [], min: 0, max: null, icon: 'cash-outline', color: '#eb7825' },
  { slug: 'chill', label: 'Chill', rangeLabel: '$50 max', googleLevels: ['PRICE_LEVEL_FREE', 'PRICE_LEVEL_INEXPENSIVE'], min: 0, max: 50, icon: 'leaf-outline', color: '#10B981' },
  { slug: 'comfy', label: 'Comfy', rangeLabel: '$50 – $150', googleLevels: ['PRICE_LEVEL_MODERATE'], min: 50, max: 150, icon: 'cafe-outline', color: '#3B82F6' },
  { slug: 'bougie', label: 'Bougie', rangeLabel: '$150 – $300', googleLevels: ['PRICE_LEVEL_EXPENSIVE'], min: 150, max: 300, icon: 'sparkles-outline', color: '#8B5CF6' },
  { slug: 'lavish', label: 'Lavish', rangeLabel: '$300+', googleLevels: ['PRICE_LEVEL_VERY_EXPENSIVE'], min: 300, max: null, icon: 'diamond-outline', color: '#F59E0B' },
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

export function tierLabel(slug: PriceTierSlug): string {
  return TIER_BY_SLUG[slug]?.label ?? 'Chill';
}

export function tierRangeLabel(slug: PriceTierSlug, currencySymbol: string = '$', rate: number = 1): string {
  const tier = TIER_BY_SLUG[slug];
  if (!tier) return '';
  if (tier.max === null) {
    return `${currencySymbol}${Math.round(tier.min * rate).toLocaleString('en-US')}+`;
  }
  if (tier.min === 0) {
    return `${currencySymbol}${Math.round(tier.max * rate).toLocaleString('en-US')} max`;
  }
  return `${currencySymbol}${Math.round(tier.min * rate).toLocaleString('en-US')} – ${currencySymbol}${Math.round(tier.max * rate).toLocaleString('en-US')}`;
}

export function formatTierLabel(slug: PriceTierSlug, currencySymbol: string = '$', rate: number = 1): string {
  const tier = TIER_BY_SLUG[slug];
  if (!tier) return 'Chill';
  return `${tier.label} · ${tierRangeLabel(slug, currencySymbol, rate)}`;
}

/**
 * Derive a price tier from a dollar amount (uses the upper bound of the range).
 * Used when we have price_min/price_max but no Google priceLevel.
 * Logic: use max if available, otherwise min. Match against tier brackets.
 */
export function priceTierFromAmount(priceMin: number, priceMax: number): PriceTierSlug {
  // Use the higher bound to determine tier; if both are 0, it's chill (free)
  const amount = priceMax > 0 ? priceMax : priceMin;
  if (amount <= 0) return 'chill';
  for (const tier of PRICE_TIERS) {
    if (tier.max !== null && amount <= tier.max) return tier.slug;
  }
  return 'lavish';
}
