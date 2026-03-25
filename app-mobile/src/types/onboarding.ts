// ─── State Machine ───

export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6 | 7

export type Step1SubStep = 'welcome' | 'phone' | 'otp' | 'gender_identity' | 'details'
export type Step2SubStep = 'value_prop' | 'intents'
export type Step3SubStep = 'location'
export type Step4SubStep =
  | 'celebration'
  | 'manual_location'  // only shown when GPS was denied/skipped
  | 'categories'
  | 'budget'
  | 'transport'
  | 'travel_time'

// CHANGED: Step 5 now only has 'friends_and_pairing'
export type Step5SubStep = 'friends_and_pairing'

// NEW: Step 6
export type Step6SubStep = 'collaborations'

// NEW: Step 7
export type Step7SubStep = 'consent' | 'getting_experiences'

export type SubStep =
  | Step1SubStep
  | Step2SubStep
  | Step3SubStep
  | Step4SubStep
  | Step5SubStep
  | Step6SubStep
  | Step7SubStep

export interface OnboardingNavState {
  step: OnboardingStep
  subStep: SubStep
}

// ─── Collected Data ───

import { PriceTierSlug } from '../constants/priceTiers';

export const DEFAULT_PRICE_TIERS: PriceTierSlug[] = ['comfy', 'bougie'];

export interface AddedFriend {
  type: 'existing' | 'invited'
  userId?: string
  username?: string
  phoneE164: string
  displayName: string
  avatarUrl?: string | null
  friendshipStatus: 'none' | 'pending_sent' | 'pending_received' | 'friends'
}

export interface CreatedSession {
  name: string
  participants: AddedFriend[]
}

// NEW: Pair request data tracked during onboarding
export interface OnboardingPairAction {
  type: 'sent' | 'accepted' | 'queued'
  targetUserId?: string
  targetPhoneE164?: string
  targetDisplayName: string
  tier: 1 | 2 | 3
  requestId?: string
  pairingId?: string
  inviteId?: string
}

export interface OnboardingData {
  // Step 1
  // Step 1 — Name (collected on welcome screen)
  firstName: string
  lastName: string

  phoneNumber: string       // E.164 format
  phoneCountryCode: string  // ISO 3166-1 alpha-2 (e.g., 'US')
  phoneVerified: boolean

  // Step 1 — Identity & Details (after OTP)
  userGender: string | null            // gender identity value from GENDER_OPTIONS
  userBirthday: Date | null            // date of birth
  userCountry: string                  // ISO 3166-1 alpha-2 (defaults to phoneCountryCode)
  userPreferredLanguage: string        // ISO 639-1 (defaults to device locale)

  // Step 2
  selectedIntents: string[]  // intent IDs: 'adventurous', 'first-date', etc.

  // Step 3
  locationGranted: boolean
  coordinates: { lat: number; lng: number } | null
  cityName: string | null
  useGpsLocation: boolean

  // Step 4
  manualLocation: string | null  // city name typed by user (when GPS denied)
  selectedCategories: string[]   // slug IDs: 'nature', 'drink', etc.
  selectedPriceTiers: PriceTierSlug[]  // selected price tier slugs
  travelMode: 'walking' | 'biking' | 'transit' | 'driving'
  travelTimeMinutes: number      // 15, 30, 45, or 60

  // Step 5 — Friends & Pairing
  addedFriends: AddedFriend[]
  pairActions: OnboardingPairAction[]  // tracks pair requests sent/accepted
  skippedFriends: boolean

  // Step 6 — Collaborations
  createdSessions: CreatedSession[]
}

// ─── Country Data ───

export interface CountryData {
  code: string       // ISO 3166-1 alpha-2 (e.g., 'US')
  name: string       // 'United States'
  dialCode: string   // '+1'
  flag: string       // emoji
}

// ─── Gender Options ───

export const GENDER_OPTIONS = [
  'man',
  'woman',
  'non-binary',
  'transgender',
  'genderqueer',
  'genderfluid',
  'agender',
  'prefer-not-to-say',
] as const

export const GENDER_DISPLAY_LABELS: Record<string, string> = {
  'man': 'Man',
  'woman': 'Woman',
  'non-binary': 'Non-binary',
  'transgender': 'Transgender',
  'genderqueer': 'Genderqueer',
  'genderfluid': 'Genderfluid',
  'agender': 'Agender',
  'prefer-not-to-say': 'Prefer not to say',
}

// ─── Intent Options (matches existing codebase) ───

export const ONBOARDING_INTENTS = [
  { id: 'adventurous', label: 'Adventurous', icon: 'compass-outline', description: 'Explore the unexpected', color: '#F59E0B' },
  { id: 'first-date', label: 'First Dates', icon: 'heart-outline', description: 'Nail the first impression', color: '#EC4899' },
  { id: 'romantic', label: 'Romantic', icon: 'heart-circle-outline', description: 'Turn up the spark', color: '#EF4444' },
  { id: 'group-fun', label: 'Group Fun', icon: 'people-circle-outline', description: 'The more the merrier', color: '#8B5CF6' },
  { id: 'picnic-dates', label: 'Picnic Dates', icon: 'basket-outline', description: 'Sun, snacks, good times', color: '#10B981' },
  { id: 'take-a-stroll', label: 'Take a Stroll', icon: 'walk-outline', description: 'Wander with purpose', color: '#14B8A6' },
] as const

// ─── Budget Presets (deprecated — kept for backward compat, use PRICE_TIERS) ───
// BUDGET_PRESETS and DEFAULT_BUDGET removed — see constants/priceTiers.ts

// ─── Travel Time Presets ───

export const TRAVEL_TIME_PRESETS = [15, 30, 45, 60] as const
export const DEFAULT_TRAVEL_TIME = 30

// ─── Transport Modes ───

export const TRANSPORT_MODES = [
  { value: 'walking' as const, label: 'Walking', icon: 'walk-outline' },
  { value: 'biking' as const, label: 'Biking', icon: 'bicycle-outline' },
  { value: 'transit' as const, label: 'Transit', icon: 'bus-outline' },
  { value: 'driving' as const, label: 'Driving', icon: 'car-outline' },
] as const

export const DEFAULT_TRANSPORT = 'walking'

// ─── Default Categories ───
// Synced with PostgreSQL default in supabase/migrations/20260228000001_update_categories.sql
// If you change this list, update the DB default too (and vice versa).
export const DEFAULT_CATEGORIES = ['nature', 'casual_eats', 'drink']
