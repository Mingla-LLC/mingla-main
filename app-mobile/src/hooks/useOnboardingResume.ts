import { useState, useEffect } from 'react'
import * as Location from 'expo-location'
import { PreferencesService } from '../services/preferencesService'
import { loadOnboardingData } from '../utils/onboardingPersistence'
import { getDefaultCountryCode } from '../constants/countries'
import { getDefaultLanguageCode } from '../constants/languages'
import { logger } from '../utils/logger'
import {
  OnboardingData,
  OnboardingStep,
  SubStep,
  DEFAULT_PRICE_TIERS,
  DEFAULT_TRAVEL_TIME,
  DEFAULT_TRANSPORT,
  DEFAULT_CATEGORIES,
} from '../types/onboarding'

// Shape of the profile fields this hook reads.
// Defined here to avoid importing the full Profile type (prevents circular deps).
interface ResumeProfile {
  id: string
  phone?: string | null
  onboarding_step?: number | null
  gender?: string | null
  birthday?: string | null
  country?: string | null
  preferred_language?: string | null
}

export interface OnboardingResumeData {
  isReady: boolean
  initialStep: OnboardingStep
  initialData: OnboardingData
  phonePreVerified: boolean
  hasGpsPermission: boolean
  resumeSubStep: SubStep | null
}

const BASE_INITIAL_DATA: OnboardingData = {
  phoneNumber: '',
  phoneCountryCode: 'US',
  phoneVerified: false,
  userGender: null,
  userBirthday: null,
  userCountry: 'US',
  userPreferredLanguage: 'en',
  selectedIntents: [],
  locationGranted: false,
  coordinates: null,
  cityName: null,
  useGpsLocation: false,
  manualLocation: null,
  selectedCategories: [...DEFAULT_CATEGORIES],
  selectedPriceTiers: DEFAULT_PRICE_TIERS,
  travelMode: DEFAULT_TRANSPORT,
  travelTimeMinutes: DEFAULT_TRAVEL_TIME,
  invitePath: null,
  personName: null,
  personBirthday: null,
  personGender: null,
  audioClipUri: null,
  audioClipDuration: null,
  audioClipStoragePath: null,
  addedFriends: [],
  createdSessions: [],
  skippedFriends: false,
  selectedSyncFriends: [],
  audioClipsByFriend: {},
  currentAudioFriendIndex: 0,
}

export function useOnboardingResume(userId: string, profile: ResumeProfile): OnboardingResumeData {
  const [isReady, setIsReady] = useState(false)
  const [initialStep, setInitialStep] = useState<OnboardingStep>(1)
  const [initialData, setInitialData] = useState<OnboardingData>({
    ...BASE_INITIAL_DATA,
    phoneCountryCode: getDefaultCountryCode(),
  })
  const [phonePreVerified, setPhonePreVerified] = useState(false)
  const [hasGpsPermission, setHasGpsPermission] = useState(false)
  const [resumeSubStep, setResumeSubStep] = useState<SubStep | null>(null)

  useEffect(() => {
    async function load() {
      try {
        // 1. Restore crash-resume data from AsyncStorage
        const persisted = await loadOnboardingData()
        const base: OnboardingData = {
          ...BASE_INITIAL_DATA,
          phoneCountryCode: getDefaultCountryCode(),
          ...(persisted ?? {}),
        }

        // 2. Always sync phoneVerified from DB — AsyncStorage may be stale
        //    (previous account, backup restore, or failed cleanup).
        //    profiles.phone is the ONLY authority.
        const phoneAlreadyVerified = !!profile.phone
        base.phoneVerified = phoneAlreadyVerified

        // 3. Compute which step to resume at
        const savedStep = profile.onboarding_step

        if (savedStep && savedStep >= 1 && savedStep <= 5) {
          if (phoneAlreadyVerified && savedStep === 1) {
            const hasIdentityData = !!profile.gender && !!profile.birthday && !!profile.country
            if (hasIdentityData) {
              setInitialStep(2)
            } else {
              setInitialStep(1)
              setResumeSubStep('gender_identity')
            }
          } else {
            setInitialStep(savedStep as OnboardingStep)
          }
        } else if (phoneAlreadyVerified) {
          const hasIdentityData = !!profile.gender && !!profile.birthday && !!profile.country
          if (hasIdentityData) {
            setInitialStep(2)
          } else {
            setInitialStep(1)
            setResumeSubStep('gender_identity')
          }
        }

        // 4. Restore identity data from profile if phone already verified
        if (phoneAlreadyVerified) {
          setPhonePreVerified(true)
          base.phoneVerified = true
          base.userGender = profile.gender || null
          base.userBirthday = profile.birthday ? new Date(profile.birthday) : null
          base.userCountry = profile.country || base.phoneCountryCode || 'US'
          base.userPreferredLanguage = profile.preferred_language || getDefaultLanguageCode()
        }

        // 5. Restore preferences from Supabase
        const prefs = await PreferencesService.getUserPreferences(userId)
        if (prefs) {
          const prefsAny = prefs as Record<string, unknown>
          const restoredUseGps = prefsAny.use_gps_location === true

          base.selectedCategories = prefs.categories?.length ? prefs.categories : DEFAULT_CATEGORIES
          base.selectedPriceTiers = (prefsAny.price_tiers as string[])?.length ? (prefsAny.price_tiers as string[]) : DEFAULT_PRICE_TIERS
          base.travelMode = (prefs.travel_mode as typeof DEFAULT_TRANSPORT) || DEFAULT_TRANSPORT
          base.travelTimeMinutes = prefs.travel_constraint_value ?? DEFAULT_TRAVEL_TIME
          base.selectedIntents = (prefsAny.intents as string[]) || []
          base.locationGranted = restoredUseGps
          base.useGpsLocation = restoredUseGps
          base.manualLocation = (prefsAny.custom_location as string) || null

          // 6. Verify GPS permission is still granted on device (OS can revoke it)
          if (restoredUseGps) {
            const { status } = await Location.getForegroundPermissionsAsync()
            if (status === 'granted') {
              setHasGpsPermission(true)
            }
          }
        }

        setInitialData(base)
      } catch (e) {
        logger.error('useOnboardingResume load error', { error: String(e) })
        // Non-fatal: setIsReady(true) below always runs
      }

      setIsReady(true)
    }

    load()
  }, [userId, profile.id])  // Both are guaranteed non-null by OnboardingLoader

  return { isReady, initialStep, initialData, phonePreVerified, hasGpsPermission, resumeSubStep }
}
