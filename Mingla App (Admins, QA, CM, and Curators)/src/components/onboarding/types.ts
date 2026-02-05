// Onboarding Flow Type Definitions

import { LucideIcon } from 'lucide-react';

export interface OnboardingData {
  userProfile: UserProfile;
  intents: Intent[];
  vibes: Vibe[];
  location: string;
  locationDetails: LocationDetails | null;
  travelMode: TravelMode;
  budgetMin: number | '';
  budgetMax: number | '';
  budgetPreset: string;
  constraintType: 'time' | 'distance';
  timeConstraint: number | '';
  distanceConstraint: number | '';
  datePreference: DatePreference;
  timeSlot: TimeSlot | '';
  customDate: string;
  exactTime: string;
  invitedFriends: Friend[];
}

export interface UserProfile {
  firstName: string;
  lastName: string;
  email: string;
  profilePhoto: string | null;
}

export interface LocationDetails {
  address: string;
  city: string;
  state: string;
  coordinates: {
    lat: number;
    lng: number;
  };
}

export type DatePreference = 'now' | 'today' | 'weekend' | 'custom' | '';
export type TimeSlot = 'brunch' | 'afternoon' | 'dinner' | 'latenight';

export interface Intent {
  id: string;
  title: string;
  icon: LucideIcon;
  emoji: string;
  description: string;
  allowedCategories?: string[]; // If undefined, all categories are allowed
}

export interface Vibe {
  id: string;
  name: string;
  icon: LucideIcon;
  emoji: string;
  description: string;
}

export type TravelMode = 'walking' | 'biking' | 'transit' | 'driving';

export interface TravelModeOption {
  id: TravelMode;
  label: string;
  icon: LucideIcon;
  speed: string;
  description: string;
  color: string;
}

export interface Friend {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatar: string | null;
}

export interface OnboardingFlowProps {
  onComplete: (data: OnboardingData) => void;
  onBackToSignIn?: () => void;
}

export interface StepProps {
  data: OnboardingData;
  onUpdate: (updates: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

export interface ProgressProps {
  currentStep: number;
  totalSteps: number;
}