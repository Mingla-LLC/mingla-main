import { LucideIcon } from 'lucide-react';

export interface MatchFactors {
  location: number;
  budget: number;
  category: number;
  time: number;
  popularity: number;
}

export interface SocialStats {
  views: number;
  likes: number;
  saves: number;
  shares: number;
}

export interface PurchaseOption {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  includes: string[];
  duration?: string;
  popular?: boolean;
  savings?: string;
}

export interface Recommendation {
  id: string;
  title: string;
  category: string;
  categoryIcon: React.ComponentType<{ className?: string }>;
  timeAway: string;
  description: string;
  budget: string;
  rating: number;
  image: string;
  images: string[];
  travelTime: string;
  distance: string;
  experienceType: string;
  priceRange: string;
  pricePerPerson?: number;
  highlights: string[];
  fullDescription: string;
  address: string;
  openingHours: string;
  phoneNumber?: string;
  website?: string;
  tags: string[];
  matchScore: number;
  matchFactors: MatchFactors;
  socialStats: SocialStats;
  reviewCount: number;
  purchaseOptions?: PurchaseOption[];
  timeline?: any;
  sipChillData?: any;
  screenRelaxData?: any;
  casualEatsData?: any;
  diningExperiencesData?: any;
  playMoveData?: any;
  creativeHandsOnData?: any;
  wellnessDatesData?: any;
  freestyleData?: any;
  picnicsData?: any;
  takeAStrollData?: any;
  weather?: any;
  busyLevel?: any;
  creator?: {
    type: 'curator' | 'business' | 'platform';
    name?: string;
    businessName?: string;
  };
}

export interface SwipeableCardsProps {
  userPreferences?: any;
  currentMode?: string;
  onCardLike?: (card: any) => void;
  accountPreferences?: any;
  onAddToCalendar: (experienceData: any) => void;
  onShareCard?: (card: any) => void;
  onPurchaseComplete?: (experienceData: any, purchaseOption: any) => void;
  removedCardIds?: string[];
  generateNewMockCard?: () => any;
  onboardingData?: any;
  curatorCards?: any[];
  onModeChange?: (mode: 'solo' | string) => void;
  boardsSessions?: any[];
}