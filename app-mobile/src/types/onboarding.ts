// ─── State Machine ───

export type OnboardingStep = 1 | 2 | 3 | 4 | 5

export type Step1SubStep = 'welcome' | 'phone' | 'otp'
export type Step2SubStep = 'value_prop' | 'intents'
export type Step3SubStep = 'location'
export type Step4SubStep =
  | 'celebration'
  | 'manual_location'  // only shown when GPS was denied/skipped
  | 'categories'
  | 'budget'
  | 'transport'
  | 'travel_time'
export type Step5SubStep =
  | 'pitch'
  | 'pathA_birthday'
  | 'pathA_gender'
  | 'pathA_audio'
  | 'pathA_contact'
  | 'pathB_name'
  | 'pathB_birthday'
  | 'pathB_gender'
  | 'pathB_audio'
  | 'skip'

export type SubStep =
  | Step1SubStep
  | Step2SubStep
  | Step3SubStep
  | Step4SubStep
  | Step5SubStep

export interface OnboardingNavState {
  step: OnboardingStep
  subStep: SubStep
}

// ─── Collected Data ───

export interface OnboardingData {
  // Step 1
  phoneNumber: string       // E.164 format
  phoneCountryCode: string  // ISO 3166-1 alpha-2 (e.g., 'US')
  phoneVerified: boolean

  // Step 2
  selectedIntents: string[]  // intent IDs: 'adventurous', 'first-date', etc.

  // Step 3
  locationGranted: boolean
  coordinates: { lat: number; lng: number } | null
  cityName: string | null
  useGpsLocation: boolean

  // Step 4
  manualLocation: string | null  // city name typed by user (when GPS denied)
  selectedCategories: string[]   // display names: 'Nature', 'Drink', etc.
  budgetMax: number | null       // converted preset value or custom amount; null = not yet selected
  travelMode: 'walking' | 'biking' | 'transit' | 'driving'
  travelTimeMinutes: number      // 15, 30, 45, or 60

  // Step 5
  invitePath: 'invite' | 'add' | 'skip' | null
  personName: string | null
  personBirthday: Date | null
  personGender: string | null
  audioClipUri: string | null
  audioClipDuration: number | null
  contactMethod: 'phone' | 'username' | null
  contactValue: string | null
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
  { id: 'friendly', label: 'Friendly', icon: 'people-outline', description: 'Plans with your people', color: '#3B82F6' },
  { id: 'group-fun', label: 'Group Fun', icon: 'people-circle-outline', description: 'The more the merrier', color: '#8B5CF6' },
  { id: 'picnic-dates', label: 'Picnic Dates', icon: 'basket-outline', description: 'Sun, snacks, good times', color: '#10B981' },
  { id: 'take-a-stroll', label: 'Take a Stroll', icon: 'walk-outline', description: 'Wander with purpose', color: '#14B8A6' },
] as const

// ─── Budget Presets ───

export const BUDGET_PRESETS = [25, 50, 100, 150] as const
export const DEFAULT_BUDGET = null

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

// ─── Default Categories (from DB default) ───

export const DEFAULT_CATEGORIES = ['Nature', 'Casual Eats', 'Drink']
