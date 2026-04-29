import { PriceTierSlug } from '../constants/priceTiers';

export interface CuratedStop {
  stopNumber: number;
  stopLabel: 'Start Here' | 'Then' | 'End With' | 'Explore' | 'Optional';
  placeId: string;
  placeName: string;
  placeType: string;
  address: string;
  rating: number;
  reviewCount: number;
  imageUrl: string;
  imageUrls?: string[];  // Multiple photos for scrollable gallery (up to 5)
  priceLevelLabel: string;
  priceTier: PriceTierSlug;
  priceMin: number;
  priceMax: number;
  openingHours: Record<string, string>;
  // ORCH-0677 D-3: widened to allow honest absence (`null`) when the source
  // data does not include `openNow`. Constitution #9 — never fabricate `true`.
  isOpenNow: boolean | null;
  website: string | null;
  lat: number;
  lng: number;
  distanceFromUserKm: number;
  travelTimeFromUserMin: number;
  travelTimeFromPreviousStopMin: number | null;
  travelModeFromPreviousStop: string | null;
  aiDescription: string;
  estimatedDurationMinutes: number;
  optional?: boolean;
  dismissible?: boolean;
  role?: string;
  comboCategory?: string;  // Mingla category slug from the combo that selected this stop (e.g., 'fine_dining')
}

// ORCH-0677 RC-2: surfaced by `generate-curated-experiences` when the response
// has zero cards. Mobile uses this to route to EMPTY UI state instead of
// staying on INITIAL_LOADING. Optional — legacy edge fn responses omit it.
export type CuratedEmptyReason = 'pool_empty' | 'no_viable_anchor' | 'pipeline_error';
export interface CuratedSummary {
  emptyReason: CuratedEmptyReason;
  candidateAnchorCount: number;
  failedAnchorCount: number;
}

export interface CuratedExperienceCard {
  id: string;
  cardType: 'curated';
  experienceType: string;
  pairingKey: string;
  title: string;
  tagline: string;
  categoryLabel?: string;
  stops: CuratedStop[];
  totalPriceMin: number;
  totalPriceMax: number;
  estimatedDurationMinutes: number;
  matchScore: number;
  shoppingList?: string[];  // AI-generated picnic shopping checklist (picnic-dates only)
  teaserText?: string | null;  // AI-generated teaser for locked display (free users)
  _locked?: boolean;           // Server-set flag when card is gated for free users
}
