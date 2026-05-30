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
  // ORCH-1019 F-7: runtime value is the raw Google Places v1 object passed
  // through verbatim by generate-curated-experiences (index.ts:567) →
  // signalRankFetch. The old Record<string,string> was a type lie that let
  // SavedTab's bespoke openingHours[dayName] lookup typecheck while missing
  // at runtime. Read ONLY via extractWeekdayText() (openingHoursUtils.ts) —
  // never index a day key directly. Union also admits legacy persisted shapes.
  openingHours:
    | {
        openNow?: boolean;
        periods?: unknown[];
        weekdayDescriptions?: string[];
        nextOpenTime?: string;
        nextCloseTime?: string;
      }
    | Record<string, string>   // legacy lowercase-day-record rows still in prod data
    | string[]
    | string
    | null;
  // ORCH-1019 F-2: per-stop venue UTC offset (Google Places v1
  // utcOffsetMinutes via place_pool.utc_offset_minutes). The canonical reader
  // evaluates open/closed in venue-local time when present.
  utcOffsetMinutes?: number | null;
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
  rankSignal?: string;     // ORCH-0985: vibe signal this stop was ranked by (e.g. 'romantic'); used by Replace to order alternatives
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
