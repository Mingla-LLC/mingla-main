/**
 * Type definitions for Expanded Card Modal
 */

export interface ExpandedCardData {
  id: string;
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
  openingHours?: string;
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
  selectedDateTime?: Date;
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
  busynessLevel: 'Not Busy' | 'Moderate' | 'Busy' | 'Very Busy';
  currentPopularity: number;
  popularTimes: Array<{
    day: string;
    times: Array<{ hour: string; popularity: number }>;
  }>;
  message: string;
  trafficInfo?: {
    currentTravelTime: string;
    trafficCondition: 'Light' | 'Moderate' | 'Heavy';
  };
}

export interface BookingOption {
  provider: 'opentable' | 'eventbrite' | 'viator' | 'website' | 'phone';
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
  onSave?: (card: ExpandedCardData) => void;
  onSchedule?: (card: ExpandedCardData) => void;
  onPurchase?: (card: ExpandedCardData, bookingOption: BookingOption) => void;
  onShare?: (card: ExpandedCardData) => void;
  userPreferences?: any;
}

