/**
 * Canonical Recommendation type used across the entire card pipeline.
 *
 * Regular cards have the base fields.
 * Nature cards add: website, phone, placeId, complex openingHours.
 * Curated cards add: strollData + cardType discriminator (via runtime cast).
 *
 * This is the SINGLE source of truth — imported by CardsCacheContext,
 * RecommendationsContext, and re-exported from RecommendationsContext
 * for consumer compatibility.
 */
export interface Recommendation {
  id: string;
  title: string;
  category: string;
  categoryIcon: string;
  lat?: number;
  lng?: number;
  timeAway: string;
  description: string;
  budget: string;
  rating: number;
  image: string;
  images: string[];
  priceRange: string;
  distance: string;
  travelTime: string;
  experienceType: string;
  highlights: string[];
  fullDescription: string;
  address: string;
  openingHours:
    | string
    | {
        open_now?: boolean;
        weekday_text?: string[];
      }
    | null;
  tags: string[];
  matchScore: number;
  reviewCount: number;
  website?: string | null;
  phone?: string | null;
  placeId?: string;
  priceTier?: string;
  socialStats: {
    views: number;
    likes: number;
    saves: number;
    shares: number;
  };
  matchFactors: {
    location: number;
    budget: number;
    category: number;
    time: number;
    popularity: number;
  };
  travelMode?: string;
  oneLiner?: string | null;
  tip?: string | null;
  shoppingList?: string[];
  strollData?: {
    anchor: {
      id: string;
      name: string;
      location: { lat: number; lng: number };
      address: string;
    };
    companionStops: Array<{
      id: string;
      name: string;
      location: { lat: number; lng: number };
      address: string;
      rating?: number;
      reviewCount?: number;
      imageUrl?: string | null;
      placeId: string;
      type: string;
    }>;
    route: {
      duration: number;
      startLocation: { lat: number; lng: number };
      endLocation: { lat: number; lng: number };
    };
    timeline: Array<{
      step: number;
      type: string;
      title: string;
      location: any;
      description: string;
      duration: number;
    }>;
  };
}
