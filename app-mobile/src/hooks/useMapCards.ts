import { useQuery } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { Recommendation } from '../types/recommendation';
import { useAppStore } from '../store/appStore';
import { curatedExperiencesService } from '../services/curatedExperiencesService';

// All 12 Mingla categories — must match edge function's MINGLA_CATEGORY_PLACE_TYPES keys
const ALL_CATEGORIES = [
  'Nature & Views', 'First Meet', 'Picnic Park', 'Drink',
  'Casual Eats', 'Fine Dining', 'Watch', 'Live Performance',
  'Creative & Arts', 'Play', 'Wellness', 'Flowers',
];

// All curated experience types
// Top 3 most relevant curated types — reduces API calls from 6 to 3
const CURATED_TYPES = ['adventurous', 'romantic', 'first-date'] as const;

function transformCard(card: any): Recommendation {
  // Curated cards: extract image + lat/lng from first stop
  const firstStop = card.stops?.[0];
  const curatedImage = firstStop?.imageUrl || firstStop?.imageUrls?.[0] || null;
  const curatedLat = firstStop?.lat;
  const curatedLng = firstStop?.lng;
  const toMapStop = (stop: any, fallbackId: string) => ({
    id: stop?.placeId || stop?.placePoolId || stop?.id || fallbackId,
    placeId: stop?.placeId,
    name: stop?.placeName || stop?.name || 'Stop',
    location: { lat: stop?.lat, lng: stop?.lng },
    address: stop?.address || '',
    rating: stop?.rating,
    reviewCount: stop?.reviewCount,
    imageUrl: stop?.imageUrl || stop?.imageUrls?.[0] || null,
    type: stop?.role || stop?.placeType || 'stop',
    openingHours: stop?.openingHours || stop?.opening_hours || null,
    isOpenNow: stop?.isOpenNow ?? null,
  });

  return {
    id: card.id,
    title: card.title || card.name || 'Experience',
    category: card.category || card.categoryLabel || 'Experience',
    categoryIcon: card.categoryIcon || 'compass-outline',
    lat: card.lat ?? card.location?.lat ?? curatedLat,
    lng: card.lng ?? card.location?.lng ?? curatedLng,
    timeAway: card.travelTime || '',
    description: card.description || card.briefDescription || card.tagline || '',
    budget: card.priceRange || '',
    rating: card.rating || 0,
    image: card.heroImage || card.image || card.images?.[0] || curatedImage || '',
    images: card.images || (card.heroImage ? [card.heroImage] : curatedImage ? [curatedImage] : []),
    priceRange: card.priceRange || '',
    distance: card.distance || '',
    travelTime: card.travelTime || '',
    experienceType: card.experienceType || card.category || '',
    highlights: card.highlights || [],
    fullDescription: card.description || card.fullDescription || '',
    address: card.address || card.stops?.[0]?.address || '',
    openingHours: card.openingHours || null,
    tags: card.highlights || [],
    matchScore: card.matchScore || 0,
    reviewCount: card.reviewCount || 0,
    website: card.website || null,
    phone: card.phone || null,
    placeId: card.placeId || card.place_id,
    priceTier: card.priceTier,
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    matchFactors: card.matchFactors || { location: 85, budget: 85, category: 85, time: 85, popularity: 85 },
    strollData: card.strollData || (card.stops && card.stops.length > 0 ? {
      anchor: toMapStop(card.stops[0], card.id),
      companionStops: card.stops.slice(1).map((s: any, i: number) => toMapStop(s, `${card.id}-${i + 1}`)),
      route: {
        duration: card.estimatedDurationMinutes || 120,
        startLocation: { lat: card.stops[0].lat, lng: card.stops[0].lng },
        endLocation: { lat: card.stops[card.stops.length - 1].lat, lng: card.stops[card.stops.length - 1].lng },
      },
      timeline: card.stops.map((s: any, i: number) => ({
        step: i + 1,
        type: s.role || 'Activity',
        title: s.placeName || s.name || 'Stop',
        location: { lat: s.lat, lng: s.lng },
        description: s.aiDescription || '',
        duration: s.estimatedDurationMinutes || 30,
      })),
    } : undefined),
    oneLiner: card.oneLiner || card.tagline || null,
    tip: card.tip || null,
    // Preserve raw stops from edge function for expanded card modal
    _rawStops: card.stops || undefined,
  } as any;
}

/**
 * Fetch ALL cards for the map — single cards + curated experiences.
 */
export function useMapCards(
  location: { latitude: number; longitude: number } | null,
) {
  const user = useAppStore(s => s.user);

  const locKey = location ? `${location.latitude.toFixed(2)}.${location.longitude.toFixed(2)}` : '';

  // Wave 1: Single cards (fast — pool query, ~500ms)
  const singlesQuery = useQuery<Recommendation[]>({
    queryKey: ['map-cards-singles', locKey],
    queryFn: async () => {
      if (!location) return [];
      const { data, error } = await supabase.functions.invoke('discover-cards', {
        body: {
          categories: ALL_CATEGORIES,
          location: { lat: location.latitude, lng: location.longitude },
          limit: 200,
          batchSeed: 0,
          travelMode: 'driving',
          travelConstraintType: 'time',
          travelConstraintValue: 30,
        },
      });
      if (error) {
        console.warn('[useMapCards] Singles fetch error:', error);
        throw error;
      }
      const singles = (data?.cards || []).map(transformCard);
      console.log(`[useMapCards] Singles: ${singles.length} cards loaded`);
      return singles;
    },
    enabled: !!user?.id && !!location,
    staleTime: 2 * 60_000,  // 2 minutes — content reads from our DB
    gcTime: 60 * 60_000,
  });

  // Wave 2: Curated routes (slower — AI generation, ~2-5s)
  const curatedQuery = useQuery<Recommendation[]>({
    queryKey: ['map-cards-curated', locKey],
    queryFn: async () => {
      if (!location) return [];
      const curatedBody = (type: (typeof CURATED_TYPES)[number]) => ({
        experienceType: type,
        location: { lat: location.latitude, lng: location.longitude },
        travelMode: 'driving',
        travelConstraintType: 'time' as const,
        travelConstraintValue: 30,
        limit: 10,
        skipDescriptions: true,
        batchSeed: 0,
      });

      console.log(`[useMapCards] Fetching curated types: ${CURATED_TYPES.join(', ')}`);
      const results = await Promise.allSettled(
        CURATED_TYPES.map(type =>
          curatedExperiencesService.generateCuratedExperiences(curatedBody(type))
        )
      );

      const cards: Recommendation[] = [];
      CURATED_TYPES.forEach((type, i) => {
        const result = results[i];
        if (result.status === 'fulfilled') {
          const curatedCards = result.value;
          console.log(`[useMapCards] Curated "${type}": ${curatedCards.length} cards returned`);
          for (const card of curatedCards) {
            if (card.stops && card.stops.length > 0) {
              cards.push(transformCard(card));
            }
          }
        } else {
          console.warn(`[useMapCards] Curated "${type}" FAILED:`, (result as any).reason?.message || result);
        }
      });
      console.log(`[useMapCards] Total curated cards with stops: ${cards.length}`);
      return cards;
    },
    enabled: !!user?.id && !!location,
    staleTime: 2 * 60_000,  // 2 minutes — content reads from our DB
    gcTime: 60 * 60_000,
  });

  // Merge both waves — singles appear first, curated adds later
  const singles = singlesQuery.data || [];
  const curated = curatedQuery.data || [];
  const data = singles.length > 0 || curated.length > 0
    ? [...singles, ...curated]
    : [];

  return {
    data,
    isLoading: singlesQuery.isLoading, // only show loading for fast wave
  };
}
