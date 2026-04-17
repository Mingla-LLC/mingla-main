/**
 * Card converter functions — transform raw edge function responses
 * into the canonical Recommendation type for the swipeable deck.
 *
 * Extracted from RecommendationsContext.tsx so they can be shared
 * across useDeckCards, RecommendationsContext, and deckService.
 */
import type { Recommendation } from '../types/recommendation';
import { getCategoryIcon } from './categoryUtils';

/**
 * Normalize a datetime string to ISO format ("Z" suffix).
 * Returns the original string unchanged if parsing fails — prevents
 * RangeError crashes from corrupt input reaching new Date().
 */
export function normalizeDateTime(dt: string): string {
  const d = new Date(dt);
  return Number.isNaN(d.getTime()) ? dt : d.toISOString();
}

/**
 * Round-robin interleave multiple card arrays.
 * Given [[N1,N2,N3], [A1,A2,A3]], produces [N1,A1,N2,A2,N3,A3].
 * Handles unequal lengths gracefully — exhausted arrays are skipped.
 */
export function roundRobinInterleave(pillResults: Recommendation[][]): Recommendation[] {
  const result: Recommendation[] = [];
  const seen = new Set<string>();
  const maxLen = Math.max(0, ...pillResults.map(p => p.length));

  for (let round = 0; round < maxLen; round++) {
    for (let p = 0; p < pillResults.length; p++) {
      if (round < pillResults[p].length) {
        const card = pillResults[p][round];
        const dedupeKey = card.placeId || card.id;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          result.push(card);
        }
      }
    }
  }
  return result;
}

/** Converts a CuratedExperienceCard into a Recommendation so SwipeableCards can render it */
export function curatedToRecommendation(card: any): Recommendation {
  const stops = card.stops ?? [];
  const firstStop = stops[0];
  const avgRating =
    stops.length > 0
      ? stops.reduce((s: number, st: any) => s + (st.rating ?? 0), 0) / stops.length
      : 0;
  const firstImage = firstStop?.imageUrl || '';
  const allImages = stops.map((s: any) => s.imageUrl).filter(Boolean);

  return {
    // Preserve curated card identity so ExpandedCardModal can detect it
    cardType: 'curated' as const,
    // Preserve original curated fields for CuratedPlanView and TimelineSection
    stops: card.stops,
    totalPriceMin: card.totalPriceMin,
    totalPriceMax: card.totalPriceMax,
    estimatedDurationMinutes: card.estimatedDurationMinutes,
    pairingKey: card.pairingKey,
    priceTier: card.stops?.[0]?.priceTier ?? 'comfy',
    tagline: card.tagline,
    categoryLabel: card.categoryLabel || 'Experience',
    id: card.id,
    title: card.title,
    category: card.categoryLabel || 'Experience',
    categoryIcon: getCategoryIcon(card.categoryLabel || '') || 'compass-outline',
    lat: firstStop?.lat,
    lng: firstStop?.lng,
    timeAway: firstStop && (firstStop.travelTimeFromUserMin ?? 0) > 0 ? `${Math.round(firstStop.travelTimeFromUserMin)} min` : '',
    description: card.tagline ?? '',
    budget: `$${card.totalPriceMin ?? 0}–$${card.totalPriceMax ?? 0}`,
    rating: avgRating,
    image: firstImage,
    images: allImages.length > 0 ? allImages : [firstImage || ''],
    priceRange: `$${card.totalPriceMin ?? 0}–$${card.totalPriceMax ?? 0}`,
    distance: firstStop && (firstStop.distanceFromUserKm ?? 0) > 0 ? `${firstStop.distanceFromUserKm.toFixed(1)} km` : '',
    travelTime: firstStop && (firstStop.travelTimeFromUserMin ?? 0) > 0 ? `${Math.round(firstStop.travelTimeFromUserMin)} min` : '',
    experienceType: card.experienceType ?? 'adventurous',
    highlights: stops.map((s: any) => s.placeName),
    fullDescription: card.tagline ?? '',
    address: firstStop?.address ?? '',
    openingHours: null,
    tags: stops.map((s: any) => s.placeType),
    matchScore: card.matchScore ?? 50,
    reviewCount: stops.reduce((s: number, st: any) => s + (st.reviewCount ?? 0), 0),
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    matchFactors: { location: 0.5, budget: 0.5, category: 0.5, time: 0.5, popularity: 0.5 },
    shoppingList: card.shoppingList ?? undefined,
    // Preserve curated data for expanded view
    strollData: {
      anchor: {
        id: firstStop?.placeId ?? '',
        name: firstStop?.placeName ?? '',
        location: { lat: firstStop?.lat ?? 0, lng: firstStop?.lng ?? 0 },
        address: firstStop?.address ?? '',
      },
      companionStops: stops.slice(1).map((s: any) => ({
        id: s.placeId ?? '',
        name: s.placeName ?? '',
        location: { lat: s.lat ?? 0, lng: s.lng ?? 0 },
        address: s.address ?? '',
        rating: s.rating,
        reviewCount: s.reviewCount,
        imageUrl: s.imageUrl,
        placeId: s.placeId ?? '',
        type: s.placeType ?? '',
      })),
      route: {
        duration: card.estimatedDurationMinutes ?? 0,
        startLocation: { lat: firstStop?.lat ?? 0, lng: firstStop?.lng ?? 0 },
        endLocation: {
          lat: stops[stops.length - 1]?.lat ?? 0,
          lng: stops[stops.length - 1]?.lng ?? 0,
        },
      },
      timeline: stops.map((s: any, i: number) => ({
        step: i + 1,
        type: s.placeType ?? '',
        title: s.placeName ?? '',
        location: { lat: s.lat ?? 0, lng: s.lng ?? 0 },
        description: `${s.stopLabel}: ${s.placeName}`,
        duration: 60,
      })),
    },
  } as Recommendation;
}

/** Compute a lightweight hash from preference fields to detect changes */
export function computePrefsHash(prefs: any): string {
  if (!prefs) return '';
  const key = [
    Array.isArray(prefs.intents) ? [...prefs.intents].sort().join(',') : '',
    Array.isArray(prefs.categories) ? [...prefs.categories].sort().join(',') : '',
    prefs.travel_mode ?? '',
    prefs.travel_constraint_type ?? '',
    prefs.travel_constraint_value ?? '',
    prefs.date_option ?? '',
    // Normalize to ISO string so "Z" vs "+00:00" don't produce different hashes
    prefs.datetime_pref ? normalizeDateTime(prefs.datetime_pref) : '',
    prefs.custom_location ?? '',
    prefs.use_gps_location ?? '',
  ].join('|');
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

