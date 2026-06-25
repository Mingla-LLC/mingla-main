import { useState, useEffect } from 'react'
import * as Location from 'expo-location'
import { supabase } from '../services/supabase'
import { PreferencesService } from '../services/preferencesService'
import { loadOnboardingData } from '../utils/onboardingPersistence'
import { getDefaultCountryCode } from '../constants/countries'
import { getDefaultLanguageCode } from '../constants/languages'
import { logger } from '../utils/logger'
import {
  OnboardingData,
  OnboardingStep,
  SubStep,
  DEFAULT_TRAVEL_TIME,
  DEFAULT_TRANSPORT,
  DEFAULT_CATEGORIES,
} from '../types/onboarding'
import { normalizeCategoryArray } from '../utils/categoryUtils'


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
  first_name?: string | null
  last_name?: string | null
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
  firstName: '',
  lastName: '',
  isAppleSignIn: false,
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
  dateOption: 'this_weekend',
  selectedDates: [],
  travelMode: DEFAULT_TRANSPORT,
  travelTimeMinutes: DEFAULT_TRAVEL_TIME,
  addedFriends: [],
  pairActions: [],
  skippedFriends: false,
  createdSessions: [],
  collabActionTaken: false,
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

        // ORCH-1228 (Apple Guideline 4) — detect Sign in with Apple from the
        // Supabase auth session. The Authentication Services framework already
        // supplies the name/email, so a SIWA user must NOT be blocked on a
        // mandatory name (or email) entry screen. We read the session's
        // app_metadata.provider AND the identities[] array (robust: identities is
        // populated even when a SIWA session was later linked to other providers).
        try {
          const { data: { session } } = await supabase.auth.getSession()
          const authUser = session?.user
          const provider = (authUser?.app_metadata as { provider?: string } | undefined)?.provider
          const providers = (authUser?.app_metadata as { providers?: string[] } | undefined)?.providers
          const identityProviders = (authUser?.identities ?? []).map((i) => i.provider)
          base.isAppleSignIn =
            provider === 'apple' ||
            (Array.isArray(providers) && providers.includes('apple')) ||
            identityProviders.includes('apple')
        } catch (siwaErr) {
          // Non-fatal: if the session read fails, fall back to the standard
          // (blocking) name gate. Never let this stall onboarding.
          console.warn('[useOnboardingResume] SIWA detection failed', String(siwaErr))
        }

        // Pre-fill name from profile (e.g. Apple Sign-In provides name automatically).
        // Apple only returns the name on the FIRST sign-in, so first/last may be
        // partially present; pre-fill whatever exists without clobbering a
        // crash-resume value.
        if (profile.first_name && !base.firstName) {
          base.firstName = profile.first_name || ''
          base.lastName = profile.last_name || ''
        }

        // 3. Compute which step to resume at
        const savedStep = profile.onboarding_step

        if (savedStep && savedStep >= 1 && savedStep <= 7) {
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

        // 5. Restore preferences from Supabase (with timeout to prevent infinite freeze)
        const PREFS_TIMEOUT_MS = 8_000
        const prefs = await Promise.race([
          PreferencesService.getUserPreferences(userId),
          new Promise<null>((resolve) => {
            setTimeout(() => {
              console.warn('[useOnboardingResume] getUserPreferences timed out, proceeding with defaults')
              resolve(null)
            }, PREFS_TIMEOUT_MS)
          }),
        ])
        if (prefs) {
          const restoredUseGps = prefs.use_gps_location === true

          base.selectedCategories = prefs.categories?.length ? normalizeCategoryArray(prefs.categories) : DEFAULT_CATEGORIES
          base.travelMode = (prefs.travel_mode as typeof DEFAULT_TRANSPORT) || DEFAULT_TRANSPORT
          base.travelTimeMinutes = prefs.travel_constraint_value ?? DEFAULT_TRAVEL_TIME
          base.selectedIntents = prefs.intents ?? []
          if (prefs.date_option) {
            base.dateOption = prefs.date_option
          }
          if (Array.isArray((prefs as any).selected_dates)) {
            base.selectedDates = (prefs as any).selected_dates
          }
          base.locationGranted = restoredUseGps
          base.useGpsLocation = restoredUseGps
          base.manualLocation = prefs.custom_location ?? null

          // 6. Verify GPS permission is still granted on device (OS can revoke it)
          if (restoredUseGps) {
            try {
              const { status } = await Location.getForegroundPermissionsAsync()
              if (status === 'granted') {
                setHasGpsPermission(true)
              }
            } catch (gpsErr) {
              // Non-fatal: some Android versions throw here. GPS defaults to false.
              console.warn('[useOnboardingResume] getForegroundPermissionsAsync failed', String(gpsErr))
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
