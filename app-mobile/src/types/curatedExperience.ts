export interface CuratedStop {
  stopNumber: number;
  stopLabel: 'Start Here' | 'Then' | 'End With';
  placeId: string;
  placeName: string;
  placeType: string;
  address: string;
  rating: number;
  reviewCount: number;
  imageUrl: string;
  priceLevelLabel: string;
  priceMin: number;
  priceMax: number;
  openingHours: Record<string, string>;
  isOpenNow: boolean;
  website: string | null;
  lat: number;
  lng: number;
  distanceFromUserKm: number;
  travelTimeFromUserMin: number;
  travelTimeFromPreviousStopMin: number | null;
  travelModeFromPreviousStop: string | null;
}

export interface CuratedExperienceCard {
  id: string;
  cardType: 'curated';
  experienceType: 'solo_adventure';
  pairingKey: string;
  title: string;
  tagline: string;
  stops: CuratedStop[];
  totalPriceMin: number;
  totalPriceMax: number;
  estimatedDurationMinutes: number;
  matchScore: number;
}
