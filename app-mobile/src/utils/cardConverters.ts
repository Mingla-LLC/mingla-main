/**
 * Card converter functions — transform raw edge function responses
 * into the canonical Recommendation type for the swipeable deck.
 *
 * Extracted from RecommendationsContext.tsx so they can be shared
 * across useDeckCards, RecommendationsContext, and deckService.
 */
import type { Recommendation } from '../types/recommendation';
import type { NatureCard } from '../services/natureCardsService';
import type { FirstMeetCard } from '../services/firstMeetCardsService';
import type { PicnicParkCard } from '../services/picnicParkCardsService';
import type { DrinkCard } from '../services/drinkCardsService';
import type { CasualEatsCard } from '../services/casualEatsCardsService';
import type { FineDiningCard } from '../services/fineDiningCardsService';
import type { WatchCard } from '../services/watchCardsService';
import type { CreativeArtsCard } from '../services/creativeArtsCardsService';
import type { PlayCard } from '../services/playCardsService';
import type { WellnessCard } from '../services/wellnessCardsService';
import type { GroceriesFlowersCard } from '../services/groceriesFlowersCardsService';
/** Inlined from deleted workBusinessCardsService.ts (dead code — called wrong endpoint) */
interface WorkBusinessCard {
  id: string;
  placeId: string;
  title: string;
  description: string;
  image: string;
  images: string[];
  rating: number;
  reviewCount: number;
  priceLevelLabel: string;
  priceMin: number;
  priceMax: number;
  address: string;
  openingHours: Record<string, string>;
  isOpenNow: boolean;
  website: string | null;
  lat: number;
  lng: number;
  placeType: string;
  placeTypeLabel: string;
  distanceKm: number;
  travelTimeMin: number;
  matchScore: number;
}
import { getCategoryIcon } from './categoryUtils';

export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
        const dedupeKey = (card as any).placeId ?? card.id;
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
    tagline: card.tagline,
    categoryLabel: card.categoryLabel || 'Experience',
    id: card.id,
    title: card.title,
    category: card.categoryLabel || 'Experience',
    categoryIcon: getCategoryIcon(card.categoryLabel || '') || 'compass-outline',
    lat: firstStop?.lat,
    lng: firstStop?.lng,
    timeAway: `${card.estimatedDurationMinutes ?? 0} min`,
    description: card.tagline ?? '',
    budget: `$${card.totalPriceMin ?? 0}–$${card.totalPriceMax ?? 0}`,
    rating: avgRating,
    image: firstImage,
    images: allImages.length > 0 ? allImages : [firstImage || ''],
    priceRange: `$${card.totalPriceMin ?? 0}–$${card.totalPriceMax ?? 0}`,
    distance: firstStop ? `${firstStop.distanceFromUserKm ?? 0} km` : '0 km',
    travelTime: firstStop ? `${firstStop.travelTimeFromUserMin ?? 0} min` : '0 min',
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

/** Converts a NatureCard from the discover-nature edge function into a Recommendation */
export function natureToRecommendation(card: NatureCard): Recommendation {
  const priceText =
    card.priceMin === 0 && card.priceMax === 0
      ? 'Free'
      : `$${card.priceMin}–$${card.priceMax}`;

  return {
    id: card.id,
    title: card.title,
    category: 'Nature',
    categoryIcon: 'leaf',
    lat: card.lat,
    lng: card.lng,
    timeAway: `${card.travelTimeMin} min`,
    description: card.description,
    budget: priceText,
    rating: card.rating,
    image: card.image,
    images: card.images.length > 0 ? card.images : [card.image].filter(Boolean),
    priceRange: priceText,
    distance: `${card.distanceKm} km`,
    travelTime: `${card.travelTimeMin} min`,
    experienceType: 'nature',
    highlights: [card.placeTypeLabel],
    fullDescription: card.description,
    address: card.address,
    openingHours: Object.keys(card.openingHours).length > 0
      ? {
          open_now: card.isOpenNow,
          weekday_text: Object.entries(card.openingHours).map(
            ([day, hours]) =>
              `${day.charAt(0).toUpperCase() + day.slice(1)}: ${hours}`
          ),
        }
      : card.isOpenNow != null
        ? { open_now: card.isOpenNow }
        : null,
    tags: [card.placeType, card.placeTypeLabel],
    matchScore: card.matchScore,
    reviewCount: card.reviewCount,
    website: card.website,
    placeId: card.placeId,
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    matchFactors: {
      location: 0.5,
      budget: 0.5,
      category: 1.0,
      time: 0.5,
      popularity: card.rating > 4 ? 0.8 : 0.5,
    },
  };
}

/** Converts a FirstMeetCard from the discover-first-meet edge function into a Recommendation */
export function firstMeetToRecommendation(card: FirstMeetCard): Recommendation {
  const priceText =
    card.priceMin === 0 && card.priceMax === 0
      ? 'Free'
      : `$${card.priceMin}–$${card.priceMax}`;

  return {
    id: card.id,
    title: card.title,
    category: 'First Meet',
    categoryIcon: 'chatbubbles-outline',
    lat: card.lat,
    lng: card.lng,
    timeAway: `${card.travelTimeMin} min`,
    description: card.description,
    budget: priceText,
    rating: card.rating,
    image: card.image,
    images: card.images.length > 0 ? card.images : [card.image].filter(Boolean),
    priceRange: priceText,
    distance: `${card.distanceKm} km`,
    travelTime: `${card.travelTimeMin} min`,
    experienceType: 'first_meet',
    highlights: [card.placeTypeLabel],
    fullDescription: card.description,
    address: card.address,
    openingHours: Object.keys(card.openingHours).length > 0
      ? {
          open_now: card.isOpenNow,
          weekday_text: Object.entries(card.openingHours).map(
            ([day, hours]) =>
              `${day.charAt(0).toUpperCase() + day.slice(1)}: ${hours}`
          ),
        }
      : card.isOpenNow != null
        ? { open_now: card.isOpenNow }
        : null,
    tags: [card.placeType, card.placeTypeLabel],
    matchScore: card.matchScore,
    reviewCount: card.reviewCount,
    website: card.website,
    placeId: card.placeId,
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    matchFactors: {
      location: 0.5,
      budget: 0.5,
      category: 1.0,
      time: 0.5,
      popularity: card.rating > 4 ? 0.8 : 0.5,
    },
  };
}

/** Converts a PicnicParkCard from the discover-picnic-park edge function into a Recommendation */
export function picnicParkToRecommendation(card: PicnicParkCard): Recommendation {
  const priceText =
    card.priceMin === 0 && card.priceMax === 0
      ? 'Free'
      : `$${card.priceMin}–$${card.priceMax}`;

  return {
    id: card.id,
    title: card.title,
    category: 'Picnic Park',
    categoryIcon: 'basket-outline',
    lat: card.lat,
    lng: card.lng,
    timeAway: `${card.travelTimeMin} min`,
    description: card.description,
    budget: priceText,
    rating: card.rating,
    image: card.image,
    images: card.images.length > 0 ? card.images : [card.image].filter(Boolean),
    priceRange: priceText,
    distance: `${card.distanceKm} km`,
    travelTime: `${card.travelTimeMin} min`,
    experienceType: 'picnic_park',
    highlights: [card.placeTypeLabel],
    fullDescription: card.description,
    address: card.address,
    openingHours: Object.keys(card.openingHours).length > 0
      ? {
          open_now: card.isOpenNow,
          weekday_text: Object.entries(card.openingHours).map(
            ([day, hours]) =>
              `${day.charAt(0).toUpperCase() + day.slice(1)}: ${hours}`
          ),
        }
      : card.isOpenNow != null
        ? { open_now: card.isOpenNow }
        : null,
    tags: [card.placeType, card.placeTypeLabel],
    matchScore: card.matchScore,
    reviewCount: card.reviewCount,
    website: card.website,
    placeId: card.placeId,
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    matchFactors: {
      location: 0.5,
      budget: 0.5,
      category: 1.0,
      time: 0.5,
      popularity: card.rating > 4 ? 0.8 : 0.5,
    },
  };
}

/** Converts a DrinkCard from the discover-drink edge function into a Recommendation */
export function drinkToRecommendation(card: DrinkCard): Recommendation {
  const priceText =
    card.priceMin === 0 && card.priceMax === 0
      ? 'Free'
      : `$${card.priceMin}–$${card.priceMax}`;

  return {
    id: card.id,
    title: card.title,
    category: 'Drink',
    categoryIcon: 'wine-outline',
    lat: card.lat,
    lng: card.lng,
    timeAway: `${card.travelTimeMin} min`,
    description: card.description,
    budget: priceText,
    rating: card.rating,
    image: card.image,
    images: card.images.length > 0 ? card.images : [card.image].filter(Boolean),
    priceRange: priceText,
    distance: `${card.distanceKm} km`,
    travelTime: `${card.travelTimeMin} min`,
    experienceType: 'drink',
    highlights: [card.placeTypeLabel],
    fullDescription: card.description,
    address: card.address,
    openingHours: Object.keys(card.openingHours).length > 0
      ? {
          open_now: card.isOpenNow,
          weekday_text: Object.entries(card.openingHours).map(
            ([day, hours]) =>
              `${day.charAt(0).toUpperCase() + day.slice(1)}: ${hours}`
          ),
        }
      : card.isOpenNow != null
        ? { open_now: card.isOpenNow }
        : null,
    tags: [card.placeType, card.placeTypeLabel],
    matchScore: card.matchScore,
    reviewCount: card.reviewCount,
    website: card.website,
    placeId: card.placeId,
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    matchFactors: {
      location: 0.5,
      budget: 0.5,
      category: 1.0,
      time: 0.5,
      popularity: card.rating > 4 ? 0.8 : 0.5,
    },
  };
}

/** Converts a CasualEatsCard from the discover-casual-eats edge function into a Recommendation */
export function casualEatsToRecommendation(card: CasualEatsCard): Recommendation {
  const priceText =
    card.priceMin === 0 && card.priceMax === 0
      ? 'Free'
      : `$${card.priceMin}–$${card.priceMax}`;

  return {
    id: card.id,
    title: card.title,
    category: 'Casual Eats',
    categoryIcon: 'fast-food-outline',
    lat: card.lat,
    lng: card.lng,
    timeAway: `${card.travelTimeMin} min`,
    description: card.description,
    budget: priceText,
    rating: card.rating,
    image: card.image,
    images: card.images.length > 0 ? card.images : [card.image].filter(Boolean),
    priceRange: priceText,
    distance: `${card.distanceKm} km`,
    travelTime: `${card.travelTimeMin} min`,
    experienceType: 'casual_eats',
    highlights: [card.placeTypeLabel],
    fullDescription: card.description,
    address: card.address,
    openingHours: Object.keys(card.openingHours).length > 0
      ? {
          open_now: card.isOpenNow,
          weekday_text: Object.entries(card.openingHours).map(
            ([day, hours]) =>
              `${day.charAt(0).toUpperCase() + day.slice(1)}: ${hours}`
          ),
        }
      : card.isOpenNow != null
        ? { open_now: card.isOpenNow }
        : null,
    tags: [card.placeType, card.placeTypeLabel],
    matchScore: card.matchScore,
    reviewCount: card.reviewCount,
    website: card.website,
    placeId: card.placeId,
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    matchFactors: {
      location: 0.5,
      budget: 0.5,
      category: 1.0,
      time: 0.5,
      popularity: card.rating > 4 ? 0.8 : 0.5,
    },
  };
}

/** Converts a FineDiningCard from the discover-fine-dining edge function into a Recommendation */
export function fineDiningToRecommendation(card: FineDiningCard): Recommendation {
  const priceText =
    card.priceMin === 0 && card.priceMax === 0
      ? 'Free'
      : `$${card.priceMin}–$${card.priceMax}`;

  return {
    id: card.id,
    title: card.title,
    category: 'Fine Dining',
    categoryIcon: 'restaurant-outline',
    lat: card.lat,
    lng: card.lng,
    timeAway: `${card.travelTimeMin} min`,
    description: card.description,
    budget: priceText,
    rating: card.rating,
    image: card.image,
    images: card.images.length > 0 ? card.images : [card.image].filter(Boolean),
    priceRange: priceText,
    distance: `${card.distanceKm} km`,
    travelTime: `${card.travelTimeMin} min`,
    experienceType: 'fine_dining',
    highlights: [card.placeTypeLabel],
    fullDescription: card.description,
    address: card.address,
    openingHours: Object.keys(card.openingHours).length > 0
      ? {
          open_now: card.isOpenNow,
          weekday_text: Object.entries(card.openingHours).map(
            ([day, hours]) =>
              `${day.charAt(0).toUpperCase() + day.slice(1)}: ${hours}`
          ),
        }
      : card.isOpenNow != null
        ? { open_now: card.isOpenNow }
        : null,
    tags: [card.placeType, card.placeTypeLabel],
    matchScore: card.matchScore,
    reviewCount: card.reviewCount,
    website: card.website,
    placeId: card.placeId,
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    matchFactors: {
      location: 0.5,
      budget: 0.5,
      category: 1.0,
      time: 0.5,
      popularity: card.rating > 4 ? 0.8 : 0.5,
    },
  };
}

/** Converts a WatchCard from the discover-watch edge function into a Recommendation */
export function watchToRecommendation(card: WatchCard): Recommendation {
  const priceText =
    card.priceMin === 0 && card.priceMax === 0
      ? 'Free'
      : `$${card.priceMin}–$${card.priceMax}`;

  return {
    id: card.id,
    title: card.title,
    category: 'Watch',
    categoryIcon: 'film-outline',
    lat: card.lat,
    lng: card.lng,
    timeAway: `${card.travelTimeMin} min`,
    description: card.description,
    budget: priceText,
    rating: card.rating,
    image: card.image,
    images: card.images.length > 0 ? card.images : [card.image].filter(Boolean),
    priceRange: priceText,
    distance: `${card.distanceKm} km`,
    travelTime: `${card.travelTimeMin} min`,
    experienceType: 'watch',
    highlights: [card.placeTypeLabel],
    fullDescription: card.description,
    address: card.address,
    openingHours: Object.keys(card.openingHours).length > 0
      ? {
          open_now: card.isOpenNow,
          weekday_text: Object.entries(card.openingHours).map(
            ([day, hours]) =>
              `${day.charAt(0).toUpperCase() + day.slice(1)}: ${hours}`
          ),
        }
      : card.isOpenNow != null
        ? { open_now: card.isOpenNow }
        : null,
    tags: [card.placeType, card.placeTypeLabel],
    matchScore: card.matchScore,
    reviewCount: card.reviewCount,
    website: card.website,
    placeId: card.placeId,
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    matchFactors: {
      location: 0.5,
      budget: 0.5,
      category: 1.0,
      time: 0.5,
      popularity: card.rating > 4 ? 0.8 : 0.5,
    },
  };
}

/** Converts a CreativeArtsCard from the discover-creative-arts edge function into a Recommendation */
export function creativeArtsToRecommendation(card: CreativeArtsCard): Recommendation {
  const priceText =
    card.priceMin === 0 && card.priceMax === 0
      ? 'Free'
      : `$${card.priceMin}–$${card.priceMax}`;

  return {
    id: card.id,
    title: card.title,
    category: 'Creative & Arts',
    categoryIcon: 'color-palette-outline',
    lat: card.lat,
    lng: card.lng,
    timeAway: `${card.travelTimeMin} min`,
    description: card.description,
    budget: priceText,
    rating: card.rating,
    image: card.image,
    images: card.images.length > 0 ? card.images : [card.image].filter(Boolean),
    priceRange: priceText,
    distance: `${card.distanceKm} km`,
    travelTime: `${card.travelTimeMin} min`,
    experienceType: 'creative_arts',
    highlights: [card.placeTypeLabel],
    fullDescription: card.description,
    address: card.address,
    openingHours: Object.keys(card.openingHours).length > 0
      ? {
          open_now: card.isOpenNow,
          weekday_text: Object.entries(card.openingHours).map(
            ([day, hours]) =>
              `${day.charAt(0).toUpperCase() + day.slice(1)}: ${hours}`
          ),
        }
      : card.isOpenNow != null
        ? { open_now: card.isOpenNow }
        : null,
    tags: [card.placeType, card.placeTypeLabel],
    matchScore: card.matchScore,
    reviewCount: card.reviewCount,
    website: card.website,
    placeId: card.placeId,
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    matchFactors: {
      location: 0.5,
      budget: 0.5,
      category: 1.0,
      time: 0.5,
      popularity: card.rating > 4 ? 0.8 : 0.5,
    },
  };
}

/** Converts a PlayCard from the discover-play edge function into a Recommendation */
export function playToRecommendation(card: PlayCard): Recommendation {
  const priceText =
    card.priceMin === 0 && card.priceMax === 0
      ? 'Free'
      : `$${card.priceMin}–$${card.priceMax}`;

  return {
    id: card.id,
    title: card.title,
    category: 'Play',
    categoryIcon: 'game-controller-outline',
    lat: card.lat,
    lng: card.lng,
    timeAway: `${card.travelTimeMin} min`,
    description: card.description,
    budget: priceText,
    rating: card.rating,
    image: card.image,
    images: card.images.length > 0 ? card.images : [card.image].filter(Boolean),
    priceRange: priceText,
    distance: `${card.distanceKm} km`,
    travelTime: `${card.travelTimeMin} min`,
    experienceType: 'play',
    highlights: [card.placeTypeLabel],
    fullDescription: card.description,
    address: card.address,
    openingHours: Object.keys(card.openingHours).length > 0
      ? {
          open_now: card.isOpenNow,
          weekday_text: Object.entries(card.openingHours).map(
            ([day, hours]) =>
              `${day.charAt(0).toUpperCase() + day.slice(1)}: ${hours}`
          ),
        }
      : card.isOpenNow != null
        ? { open_now: card.isOpenNow }
        : null,
    tags: [card.placeType, card.placeTypeLabel],
    matchScore: card.matchScore,
    reviewCount: card.reviewCount,
    website: card.website,
    placeId: card.placeId,
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    matchFactors: {
      location: 0.5,
      budget: 0.5,
      category: 1.0,
      time: 0.5,
      popularity: card.rating > 4 ? 0.8 : 0.5,
    },
  };
}

/** Converts a WellnessCard from the discover-wellness edge function into a Recommendation */
export function wellnessToRecommendation(card: WellnessCard): Recommendation {
  const priceText =
    card.priceMin === 0 && card.priceMax === 0
      ? 'Free'
      : `$${card.priceMin}–$${card.priceMax}`;

  return {
    id: card.id,
    title: card.title,
    category: 'Wellness',
    categoryIcon: 'body-outline',
    lat: card.lat,
    lng: card.lng,
    timeAway: `${card.travelTimeMin} min`,
    description: card.description,
    budget: priceText,
    rating: card.rating,
    image: card.image,
    images: card.images.length > 0 ? card.images : [card.image].filter(Boolean),
    priceRange: priceText,
    distance: `${card.distanceKm} km`,
    travelTime: `${card.travelTimeMin} min`,
    experienceType: 'wellness',
    highlights: [card.placeTypeLabel],
    fullDescription: card.description,
    address: card.address,
    openingHours: Object.keys(card.openingHours).length > 0
      ? {
          open_now: card.isOpenNow,
          weekday_text: Object.entries(card.openingHours).map(
            ([day, hours]) =>
              `${day.charAt(0).toUpperCase() + day.slice(1)}: ${hours}`
          ),
        }
      : card.isOpenNow != null
        ? { open_now: card.isOpenNow }
        : null,
    tags: [card.placeType, card.placeTypeLabel],
    matchScore: card.matchScore,
    reviewCount: card.reviewCount,
    website: card.website,
    placeId: card.placeId,
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    matchFactors: {
      location: 0.5,
      budget: 0.5,
      category: 1.0,
      time: 0.5,
      popularity: card.rating > 4 ? 0.8 : 0.5,
    },
  };
}

/** Converts a GroceriesFlowersCard from the discover-experiences edge function into a Recommendation */
export function groceriesFlowersToRecommendation(card: GroceriesFlowersCard): Recommendation {
  const priceText =
    card.priceMin === 0 && card.priceMax === 0
      ? 'Free'
      : `$${card.priceMin}–$${card.priceMax}`;

  return {
    id: card.id,
    title: card.title,
    category: 'Groceries & Flowers',
    categoryIcon: 'cart-outline',
    lat: card.lat,
    lng: card.lng,
    timeAway: `${card.travelTimeMin} min`,
    description: card.description,
    budget: priceText,
    rating: card.rating,
    image: card.image,
    images: card.images.length > 0 ? card.images : [card.image].filter(Boolean),
    priceRange: priceText,
    distance: `${card.distanceKm} km`,
    travelTime: `${card.travelTimeMin} min`,
    experienceType: 'groceries_flowers',
    highlights: [card.placeTypeLabel],
    fullDescription: card.description,
    address: card.address,
    openingHours: Object.keys(card.openingHours).length > 0
      ? {
          open_now: card.isOpenNow,
          weekday_text: Object.entries(card.openingHours).map(
            ([day, hours]) =>
              `${day.charAt(0).toUpperCase() + day.slice(1)}: ${hours}`
          ),
        }
      : card.isOpenNow != null
        ? { open_now: card.isOpenNow }
        : null,
    tags: [card.placeType, card.placeTypeLabel],
    matchScore: card.matchScore,
    reviewCount: card.reviewCount,
    website: card.website,
    placeId: card.placeId,
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    matchFactors: {
      location: 0.5,
      budget: 0.5,
      category: 1.0,
      time: 0.5,
      popularity: card.rating > 4 ? 0.8 : 0.5,
    },
  };
}

/** Converts a WorkBusinessCard from the discover-experiences edge function into a Recommendation */
export function workBusinessToRecommendation(card: WorkBusinessCard): Recommendation {
  const priceText =
    card.priceMin === 0 && card.priceMax === 0
      ? 'Free'
      : `$${card.priceMin}–$${card.priceMax}`;

  return {
    id: card.id,
    title: card.title,
    category: 'Work & Business',
    categoryIcon: 'briefcase-outline',
    lat: card.lat,
    lng: card.lng,
    timeAway: `${card.travelTimeMin} min`,
    description: card.description,
    budget: priceText,
    rating: card.rating,
    image: card.image,
    images: card.images.length > 0 ? card.images : [card.image].filter(Boolean),
    priceRange: priceText,
    distance: `${card.distanceKm} km`,
    travelTime: `${card.travelTimeMin} min`,
    experienceType: 'work_business',
    highlights: [card.placeTypeLabel],
    fullDescription: card.description,
    address: card.address,
    openingHours: Object.keys(card.openingHours).length > 0
      ? {
          open_now: card.isOpenNow,
          weekday_text: Object.entries(card.openingHours).map(
            ([day, hours]) =>
              `${day.charAt(0).toUpperCase() + day.slice(1)}: ${hours}`
          ),
        }
      : card.isOpenNow != null
        ? { open_now: card.isOpenNow }
        : null,
    tags: [card.placeType, card.placeTypeLabel],
    matchScore: card.matchScore,
    reviewCount: card.reviewCount,
    website: card.website,
    placeId: card.placeId,
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    matchFactors: {
      location: 0.5,
      budget: 0.5,
      category: 1.0,
      time: 0.5,
      popularity: card.rating > 4 ? 0.8 : 0.5,
    },
  };
}

/** Compute a lightweight hash from preference fields to detect changes */
export function computePrefsHash(prefs: any): string {
  if (!prefs) return '';
  const key = [
    Array.isArray(prefs.categories) ? [...prefs.categories].sort().join(',') : '',
    prefs.budget_min ?? '',
    prefs.budget_max ?? '',
    prefs.travel_mode ?? '',
    prefs.travel_constraint_type ?? '',
    prefs.travel_constraint_value ?? '',
    prefs.date_option ?? '',
    prefs.time_slot ?? '',
    prefs.datetime_pref ?? '',
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

/** Well-known intent IDs — used to separate intents from category names */
export const INTENT_IDS = new Set([
  'adventurous', 'first-date', 'romantic', 'friendly', 'group-fun',
  'picnic-dates', 'take-a-stroll',
]);

/** Separate a mixed categories array into intents and actual categories */
export function separateIntentsAndCategories(categories: string[]): {
  intents: string[];
  categories: string[];
} {
  const intents: string[] = [];
  const cats: string[] = [];
  for (const c of categories) {
    if (INTENT_IDS.has(c)) {
      intents.push(c);
    } else {
      cats.push(c);
    }
  }
  return { intents, categories: cats };
}

