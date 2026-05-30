// ORCH-0997 [friend-page cards → deck parity]
// Single producer of ExpandedCardData for the friend-profile holiday/birthday card
// rows. Replaces the pre-0997 ad-hoc inline object whose field names (`imageUrl`,
// flat `lat`/`lng`) did NOT match what ExpandedCardModal reads (`image`/`images`,
// `location.{lat,lng}`) — so the modal fell through to its grey "No images available"
// box and its location-derived UI no-opped (RC#2, proven 2026-05-29).
//
// Returning the value TYPED as ExpandedCardData makes the field-name drift a compile
// error if anyone reverts the mapping (regression-prevention, SPEC §10 / SC-7).
import type { ExpandedCardData } from '../../types/expandedCardTypes';
import type { CuratedStop } from '../../types/curatedExperience';
import type { HolidayCard } from '../../services/holidayCardsService';
import { PriceTierSlug, formatTierLabel } from '../../constants/priceTiers';
import { getCategoryIcon } from '../../utils/categoryUtils';

const VALID_TIERS: ReadonlySet<string> = new Set(['chill', 'comfy', 'bougie', 'lavish']);

function asPriceTier(v: string | null | undefined): PriceTierSlug | null {
  return v && VALID_TIERS.has(v) ? (v as PriceTierSlug) : null;
}

export interface HolidayCardMapOpts {
  travelMode?: string;
  currencySymbol: string;
  currencyRate: number;
}

/**
 * Map a paired-profile HolidayCard onto a complete ExpandedCardData so the friend
 * page opens ExpandedCardModal with the same fidelity as the swipeable deck.
 *
 * Honesty (Constitution #9): missing image → `image:''` + `images:[]` (the modal
 * renders its own honest empty state, never a fabricated photo); missing rating →
 * `0` (modal hides the chip); missing coords → `location:undefined` (no fake
 * distance). reviewCount/highlights/tags/matchFactors/socialStats are neutral
 * zero/empty — the source carries no such data and we never invent it.
 */
export function holidayCardToExpandedCardData(
  c: HolidayCard,
  opts: HolidayCardMapOpts,
): ExpandedCardData {
  const priceTier = asPriceTier(c.priceTier);
  const isCurated = c.cardType === 'curated';
  // stopsData is the same generate-curated-experiences output the deck renders;
  // guarded to an array before the CuratedStop assertion (never a blind cast).
  const stops: CuratedStop[] | undefined =
    isCurated && Array.isArray(c.stopsData) ? (c.stopsData as CuratedStop[]) : undefined;

  const base: ExpandedCardData = {
    id: c.id,
    placeId: c.googlePlaceId ?? undefined,
    title: c.title,
    category: c.category,
    categoryIcon: getCategoryIcon(c.category),
    description: c.description ?? '',
    fullDescription: c.description ?? '',
    image: c.imageUrl ?? '',
    images: c.imageUrl ? [c.imageUrl] : [],
    rating: c.rating ?? 0,
    reviewCount: 0,
    priceRange: priceTier
      ? formatTierLabel(priceTier, opts.currencySymbol, opts.currencyRate)
      : undefined,
    priceTier: priceTier ?? undefined,
    distance: null,
    travelMode: opts.travelMode,
    address: c.address ?? '',
    website: c.website ?? undefined,
    tagline: c.tagline ?? undefined,
    highlights: [],
    tags: [],
    matchScore: 0,
    matchFactors: { location: 0, budget: 0, category: 0, time: 0, popularity: 0 },
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    location: c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : undefined,
    // [META-ORCH-1009 Sub-B] Per-signal Gemini Q2 reasoning passthrough. D-8
    // verdict 2026-05-30: the paired-friend backends today do NOT populate
    // this field; passing it through is a no-op for the current pipeline but
    // makes the modal section automatically appear the moment the follow-up
    // Sub extends `get-person-hero-cards` / `get-paired-profile-cards` to
    // source reasoning from place_pool.ai_signal_scores. Undefined → modal
    // hides the section (graceful degrade).
    aiReasoningBySignal: c.aiReasoningBySignal,
  };

  if (!isCurated) return base;

  return {
    ...base,
    cardType: 'curated',
    stops,
    experienceType: c.experienceType ?? undefined,
    totalPriceMin: c.totalPriceMin ?? undefined,
    totalPriceMax: c.totalPriceMax ?? undefined,
    estimatedDurationMinutes: c.estimatedDurationMinutes ?? undefined,
    shoppingList: Array.isArray(c.shoppingList) ? (c.shoppingList as string[]) : undefined,
  };
}
