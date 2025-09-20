// API Contract Types for Recommendations System

export interface RecommendationsRequest {
  budget: {
    min: number;
    max: number;
    perPerson: boolean;
  };
  categories: string[];
  timeWindow: {
    kind: 'Now' | 'Tonight' | 'ThisWeekend' | 'Custom';
    start?: string | null;
    end?: string | null;
    timeOfDay?: string;
  };
  travel: {
    mode: 'WALKING' | 'DRIVING' | 'TRANSIT';
    constraint: {
      type: 'TIME' | 'DISTANCE';
      maxMinutes?: number;
      maxDistance?: number;
    };
  };
  origin: {
    lat: number;
    lng: number;
  };
  units: 'metric' | 'imperial';
}

export interface RecommendationCard {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  priceLevel: number;
  estimatedCostPerPerson: number;
  startTime: string;
  durationMinutes: number;
  imageUrl: string;
  address: string;
  location: {
    lat: number;
    lng: number;
  };
  route: {
    mode: 'WALKING' | 'DRIVING' | 'TRANSIT';
    etaMinutes: number;
    distanceText: string;
    mapsDeepLink: string;
  };
  source: {
    provider: 'google_places' | 'eventbrite';
    placeId?: string;
    eventId?: string;
  };
  copy: {
    oneLiner: string;
    tip: string;
  };
  actions: {
    invite: boolean;
    save: boolean;
    share: boolean;
  };
  rating?: number;
  reviewCount?: number;
  openingHours?: {
    isOpen: boolean;
    openNow: boolean;
    periods?: Array<{
      open: { day: number; time: string };
      close: { day: number; time: string };
    }>;
  };
}

export interface RecommendationsResponse {
  cards: RecommendationCard[];
  meta?: {
    totalResults: number;
    processingTimeMs: number;
    sources: {
      googlePlaces: number;
      eventbrite: number;
    };
    llmUsed: boolean;
  };
}

// Internal types for data processing
export interface BaseCandidateData {
  id: string;
  name: string;
  category: string;
  location: { lat: number; lng: number };
  address: string;
  imageUrl?: string;
}

export interface PlaceCandidate extends BaseCandidateData {
  priceLevel?: number;
  rating?: number;
  reviewCount?: number;
  placeId?: string;
  openingHours?: any;
  source: 'google_places';
}

export interface EventCandidate extends BaseCandidateData {
  startTime: string;
  endTime?: string;
  price?: number;
  eventId: string;
  source: 'eventbrite';
}

export type Candidate = PlaceCandidate | EventCandidate;

export interface EnrichedCandidate extends BaseCandidateData {
  // Extend with all possible fields from both place and event candidates
  priceLevel?: number;
  rating?: number;
  reviewCount?: number;
  placeId?: string;
  openingHours?: any;
  startTime?: string;
  endTime?: string;
  price?: number;
  eventId?: string;
  source: 'google_places' | 'eventbrite';
  
  // Enrichment fields
  travel?: {
    durationMinutes: number;
    distanceText: string;
    mode: string;
  };
  score?: number;
  estimatedCost?: number;
  copy?: {
    oneLiner: string;
    tip: string;
  };
}