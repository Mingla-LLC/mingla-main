import { useQuery } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { Recommendation } from '../types/recommendation';
import { useAppStore } from '../store/appStore';

// All 12 Mingla categories — must match edge function's MINGLA_CATEGORY_PLACE_TYPES keys
const ALL_CATEGORIES = [
  'Nature & Views', 'First Meet', 'Picnic Park', 'Drink',
  'Casual Eats', 'Fine Dining', 'Watch', 'Live Performance',
  'Creative & Arts', 'Play', 'Wellness', 'Flowers',
];

// All curated experience types
const CURATED_TYPES = [
  'adventurous', 'first-date', 'romantic', 'group-fun', 'picnic-dates', 'take-a-stroll',
] as const;

function transformCard(card: any): Recommendation {
  // Curated cards: extract image + lat/lng from first stop
  const firstStop = card.stops?.[0];
  const curatedImage = firstStop?.imageUrl || firstStop?.imageUrls?.[0] || null;
  const curatedLat = firstStop?.lat;
  const curatedLng = firstStop?.lng;

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
      anchor: {
        id: card.stops[0].placeId || card.stops[0].placePoolId || card.id,
        name: card.stops[0].placeName || card.title,
        location: { lat: card.stops[0].lat, lng: card.stops[0].lng },
        address: card.stops[0].address || '',
      },
      companionStops: card.stops.slice(1).map((s: any) => ({
        id: s.placeId || s.placePoolId || s.id,
        name: s.placeName || s.name || 'Stop',
        location: { lat: s.lat, lng: s.lng },
        address: s.address || '',
        rating: s.rating,
        reviewCount: s.reviewCount,
        imageUrl: s.imageUrl || s.imageUrls?.[0] || null,
        placeId: s.placeId,
        type: s.role || 'stop',
      })),
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

  return useQuery<Recommendation[]>({
    queryKey: ['map-cards', location?.latitude?.toFixed(2), location?.longitude?.toFixed(2)],
    queryFn: async () => {
      if (!location) return [];

      // Fetch single cards + ALL curated types in parallel
      const curatedBody = (type: string) => ({
        experienceType: type,
        location: { lat: location.latitude, lng: location.longitude },
        budgetMin: 0,
        budgetMax: 1000,
        travelMode: 'driving',
        travelConstraintType: 'time',
        travelConstraintValue: 30,
        limit: 10,
        skipDescriptions: true,
        batchSeed: 0,
      });

      const [singleResult, ...curatedResults] = await Promise.allSettled([
        supabase.functions.invoke('discover-cards', {
          body: {
            categories: ALL_CATEGORIES,
            location: { lat: location.latitude, lng: location.longitude },
            limit: 200,
            batchSeed: 0,
            travelMode: 'driving',
            travelConstraintType: 'time',
            travelConstraintValue: 30,
          },
        }),
        ...CURATED_TYPES.map(type =>
          supabase.functions.invoke('generate-curated-experiences', { body: curatedBody(type) })
        ),
      ]);

      const allCards: Recommendation[] = [];

      // Process single cards
      if (singleResult.status === 'fulfilled' && singleResult.value.data?.cards) {
        for (const card of singleResult.value.data.cards) {
          allCards.push(transformCard(card));
        }
      }

      // Process curated cards — response may be { cards: [...] } or direct array
      for (const result of curatedResults) {
        if (result.status === 'fulfilled') {
          const responseData = result.value.data;
          const curatedCards = responseData?.cards || (Array.isArray(responseData) ? responseData : []);
          for (const card of curatedCards) {
            if (card.stops && card.stops.length > 0) {
              allCards.push(transformCard(card));
            }
          }
        }
      }

      return allCards;
    },
    enabled: !!user?.id && !!location,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });
}
