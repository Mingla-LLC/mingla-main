/**
 * Type definitions for Expanded Card Modal
 */

import { CuratedStop } from './curatedExperience';
import { PriceTierSlug } from '../constants/priceTiers';

export interface ExpandedCardData {
  id: string;
  placeId?: string;
  title: string;
  category: string;
  categoryIcon: string;
  description: string;
  fullDescription: string;
  image: string;
  images: string[];
  rating: number;
  reviewCount: number;
  priceRange: string;
  distance: string;
  travelTime: string;
  address: string;
  openingHours?:
    | string
    | {
        open_now?: boolean;
        weekday_text?: string[];
      }
    | null;
  phone?: string;
  website?: string;
  highlights: string[];
  tags: string[];
  matchScore: number;
  matchFactors: {
    location: number;
    budget: number;
    category: number;
    time: number;
    popularity: number;
  };
  socialStats: {
    views: number;
    likes: number;
    saves: number;
    shares: number;
  };

  // Location data for API calls
  location?: {
    lat: number;
    lng: number;
  };
  // Date/time for weather and timeline
  selectedDateTime?: Date | string;
  // Stroll-specific data
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
  // Picnic-specific data
  picnicData?: {
    picnic: {
      id: string;
      name: string;
      location: { lat: number; lng: number };
      address: string;
    };
    groceryStore: {
      id: string;
      name: string;
      location: { lat: number; lng: number };
      address: string;
      rating?: number;
      reviewCount?: number;
      imageUrl?: string | null;
      placeId: string;
      type: string;
      distance: number;
    };
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
  // Curated experience fields (multi-stop itinerary cards)
  cardType?: 'curated';
  stops?: CuratedStop[];
  tagline?: string;
  totalPriceMin?: number;
  totalPriceMax?: number;
  estimatedDurationMinutes?: number;
  pairingKey?: string;
  experienceType?: string;
  priceTier?: PriceTierSlug;
  tip?: string | null;
  // Night Out-specific data
  nightOutData?: {
    eventName: string;
    venueName: string;
    artistName: string;
    date: string;
    time: string;
    price: string;
    genre?: string;
    subGenre?: string;
    tags: string[];
    coordinates?: { lat: number; lng: number };
    ticketUrl: string;
    ticketStatus: string;
    seatMapUrl?: string;
  };
}

export interface WeatherData {
  temperature: number;
  condition: string;
  icon: string;
  description: string;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  uvIndex?: number;
  precipitation?: number;
  recommendation: string;
  hourlyForecast?: Array<{
    time: string;
    temperature: number;
    condition: string;
    icon: string;
    precipitation: number;
  }>;
}

export interface BusynessData {
  isBusy: boolean;
  busynessLevel: "Not Busy" | "Moderate" | "Busy" | "Very Busy";
  currentPopularity: number;
  popularTimes: Array<{
    day: string;
    times: Array<{ hour: string; popularity: number }>;
  }>;
  message: string;
  trafficInfo?: {
    currentTravelTime: string;
    trafficCondition: "Light" | "Moderate" | "Heavy";
  };
}

export interface BookingOption {
  provider: "opentable" | "eventbrite" | "viator" | "website" | "phone";
  available: boolean;
  url?: string;
  phone?: string;
  message: string;
  price?: string;
  timeSlots?: string[];
}

export interface TimelineStep {
  id: string;
  title: string;
  description: string;
  duration?: string;
  icon?: string;
  location?: string;
}

export interface TimelineData {
  category: string;
  totalDuration: string;
  costPerPerson: string;
  steps: TimelineStep[];
}

export interface ExpandedCardModalProps {
  visible: boolean;
  card: ExpandedCardData | null;
  onClose: () => void;
  onSave: (card: ExpandedCardData) => Promise<void> | void;
  onPurchase?: (card: ExpandedCardData, bookingOption: BookingOption) => void;
  onShare?: (card: ExpandedCardData) => void;
  userPreferences?: any;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
  isSaved?: boolean;
  currentMode?: string;
  onCardRemoved?: (cardId: string) => void; // Callback to remove card from deck
  onStrollDataFetched?: (
    card: ExpandedCardData,
    strollData: ExpandedCardData["strollData"],
  ) => Promise<void> | void; // Callback to persist stroll data to database
  onPicnicDataFetched?: (
    card: ExpandedCardData,
    picnicData: ExpandedCardData["picnicData"],
  ) => Promise<void> | void; // Callback to persist picnic data to database
}
