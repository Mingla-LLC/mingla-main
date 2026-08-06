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
  description: string;
  budget: string;
  // [#1669] OPTIONAL. 763 servable place-pool rows have `rating IS NULL`, and a
  // required `number` here forced deckService to stamp `?? 0` on every one of
  // them — a fabricated zero that then travelled into the expanded card and
  // into the rows we persist. Every reader already guards with `!= null && > 0`.
  rating?: number;
  image: string;
  images: string[];
  priceRange: string;
  priceRangeStatus?:
    | "active"
    | "legacy_unresolved"
    | "reconciliation_required"
    | "unset"
    | null;
  sourceMinMinor?: number | null;
  sourceMaxMinor?: number | null;
  sourceCurrencyCode?: string | null;
  sourceMinorUnitExponent?: number | null;
  displayMinMinor?: number | null;
  displayMaxMinor?: number | null;
  displayCurrencyCode?: string | null;
  displayMinorUnitExponent?: number | null;
  priceIsApproximate?: boolean;
  fxSnapshotId?: string | null;
  fxProvider?: string | null;
  fxProviderUpdatedAt?: string | null;
  fxFreshness?:
    | "fresh"
    | "stale_soft"
    | "expired"
    | "not_needed"
    | "unavailable"
    | null;
  // ORCH-0659/0660: honest null when distance/travel-time can't be computed
  // (missing user GPS, missing place lat/lng). UI hides the badge on null
  // — never fabricate "nearby" or "0 min".
  distance: string | null;
  travelTime: string | null;
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
    | {
        openNow?: boolean;
        periods?: unknown[];
        nextOpenTime?: string;
        nextCloseTime?: string;
        weekdayDescriptions?: string[];
      }
    | { lines?: string[] }
    | string[]
    | null;
  utcOffsetMinutes?: number | null;
  utc_offset_minutes?: number | null;
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
