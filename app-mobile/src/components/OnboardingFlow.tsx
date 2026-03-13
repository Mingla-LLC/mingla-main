import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  Animated,
  Easing,
  StyleSheet,
  Dimensions,
  Linking,
  Platform,
  AccessibilityInfo,
  ActivityIndicator,
  Switch,
  ScrollView,
} from 'react-native'
import * as Location from 'expo-location'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import DateTimePicker from '@react-native-community/datetimepicker'
import { useQueryClient } from '@tanstack/react-query'

import { useAppStore } from '../store/appStore'
import { useOnboardingStateMachine } from '../hooks/useOnboardingStateMachine'
import { supabase } from '../services/supabase'
import { PreferencesService } from '../services/preferencesService'
import { locationService } from '../services/locationService'
import { throttledReverseGeocode, clearGeocodeCache } from '../utils/throttledGeocode'
import { geocodingService } from '../services/geocodingService'
import { sendOtp, verifyOtp } from '../services/otpService'
import { logger } from '../utils/logger'
import { saveOnboardingData, clearOnboardingData } from '../utils/onboardingPersistence'
import { createSavedPerson, SavedPerson } from '../services/savedPeopleService'
import { detectLocaleFromCoordinates, detectLocaleFromCountryName } from '../utils/localeDetection'
import { uploadOnboardingAudio, deleteFromStorage, createAudioClipRecord } from '../services/personAudioService'
import { getCurrencySymbol, formatNumberWithCommas } from '../utils/currency'
import { getRate } from '../services/currencyService'
import { deckService } from '../services/deckService'

import { OnboardingShell } from './onboarding/OnboardingShell'
import { PhoneInput } from './onboarding/PhoneInput'
import { OTPInput } from './onboarding/OTPInput'
import { OnboardingCollaborationStep } from './onboarding/OnboardingCollaborationStep'
import { CategoryTile } from './ui/CategoryTile'
import { OnboardingAudioRecorder } from './onboarding/OnboardingAudioRecorder'
import { OnboardingSyncStep } from './onboarding/OnboardingSyncStep'
import { OnboardingFriendsStep } from './onboarding/OnboardingFriendsStep'
import { OnboardingConsentStep } from './onboarding/OnboardingConsentStep'
import { processPersonAudio } from '../services/personAudioProcessingService'
import { PulseDotLoader } from './ui/PulseDotLoader'

import {
  OnboardingData,
  OnboardingStep,
  SubStep,
  ONBOARDING_INTENTS,
  DEFAULT_PRICE_TIERS,
  TRAVEL_TIME_PRESETS,
  DEFAULT_TRAVEL_TIME,
  TRANSPORT_MODES,
  DEFAULT_TRANSPORT,
  DEFAULT_CATEGORIES,
  GENDER_OPTIONS,
  GENDER_DISPLAY_LABELS,
} from '../types/onboarding'
import { PRICE_TIERS, TIER_BY_SLUG, PriceTierSlug } from '../constants/priceTiers'
import { categories } from '../constants/categories'
import { getCountryByCode } from '../constants/countries'
import { getDefaultLanguageCode, getLanguageByCode } from '../constants/languages'
import { LanguagePickerModal } from './onboarding/LanguagePickerModal'
import { CountryPickerModal } from './onboarding/CountryPickerModal'
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
  backgroundWarmGlow,
  touchTargets,
  shadows,
  glass,
} from '../constants/designSystem'

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window')

function formatBirthdayDisplay(date: Date): string {
  const day = date.getDate().toString().padStart(2, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const year = date.getFullYear()
  return `${day}/${month}/${year}`
}

// ─── Stable Date Boundaries ───
const MIN_BIRTHDAY_DATE = new Date(1906, 0, 1)  // 120 years ago ceiling
const BIRTHDAY_PICKER_DEFAULT = new Date(2000, 0, 1)  // fallback starting position for Step 1 picker

const DEFAULT_PERSON_DATE = (() => {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 25)
  return d
})()
const MIN_PERSON_DATE = (() => {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 100)
  return d
})()
const MAX_PERSON_DATE = (() => {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 13)
  return d
})()

// Returns the Nth occurrence of a given weekday in a month (1-indexed)
// weekday: 0=Sunday, 1=Monday, ... 6=Saturday
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1)
  const firstDay = first.getDay()
  const offset = (weekday - firstDay + 7) % 7
  const day = 1 + offset + (n - 1) * 7
  return new Date(year, month, day)
}

function buildOccasions(birthday: Date | null): Array<{ name: string; date: string }> {
  const occasions: Array<{ name: string; date: string }> = []
  if (birthday) {
    const thisYear = new Date().getFullYear()
    const bday = new Date(birthday)
    bday.setFullYear(thisYear)
    if (bday < new Date()) bday.setFullYear(thisYear + 1)
    occasions.push({ name: 'Birthday', date: bday.toISOString().split('T')[0] })
  }
  const year = new Date().getFullYear()
  // Mother's Day: 2nd Sunday in May (month index 4)
  const mothersDay = nthWeekdayOfMonth(year, 4, 0, 2)
  // Father's Day: 3rd Sunday in June (month index 5)
  const fathersDay = nthWeekdayOfMonth(year, 5, 0, 3)
  occasions.push(
    { name: "Valentine's Day", date: `${year}-02-14` },
    { name: "Mother's Day", date: mothersDay.toISOString().split('T')[0] },
    { name: "Father's Day", date: fathersDay.toISOString().split('T')[0] },
    { name: "Christmas", date: `${year}-12-25` },
  )
  return occasions
}

interface OnboardingFlowProps {
  onComplete: () => void
  initialStep: OnboardingStep
  initialData: OnboardingData
  phonePreVerified: boolean
  initialHasGpsPermission: boolean
  resumeSubStep: SubStep | null
}


const OnboardingFlow = ({
  onComplete,
  initialStep,
  initialData,
  phonePreVerified,
  initialHasGpsPermission,
  resumeSubStep,
}: OnboardingFlowProps) => {
  const { user, profile, setProfile } = useAppStore()
  const queryClient = useQueryClient()

  // ─── State ───
  const [data, setData] = useState<OnboardingData>(initialData)
  const [hasGpsPermission, setHasGpsPermission] = useState(initialHasGpsPermission)
  const [categoryCapMessage, setCategoryCapMessage] = useState(false)

  // ─── State Machine ───
  const {
    state: navState,
    goNext,
    goBack,
    goToSubStep,
    choosePath,
    setSkippedFriends,
    progress,
    isLaunch,
  } = useOnboardingStateMachine({ initialStep, initialChosenPath: initialData.invitePath, hasGpsPermission })


  // isFirstScreen: true when the user is at the earliest screen where "Back to sign in"
  // should appear. For phone-pre-verified users, this is Step 2/value_prop (their starting
  // point) OR Step 1/welcome (where they end up if they navigate backwards past Step 2).
  // The OR condition ensures pre-verified users who navigate backwards are never trapped
  // without a sign-out path.
  const isFirstScreen = phonePreVerified
    ? (navState.step === 2 && navState.subStep === 'value_prop') ||
      (navState.step === 1 && navState.subStep === 'welcome')
    : (navState.step === 1 && navState.subStep === 'welcome')

  // ─── Stable Refs (prevent stale closures in timeouts) ───
  const goNextRef = useRef(goNext)
  goNextRef.current = goNext
  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resumeJumpedRef = useRef(false)

  // Cleanup auto-advance timeout on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceRef.current) {
        clearTimeout(autoAdvanceRef.current)
      }
    }
  }, [])

  // ─── One-Shot Resume Sub-Step Jump ───
  // Jumps to the resume sub-step once on mount if the loader determined one.
  // The ref guard prevents a double-fire in development Strict Mode.
  useEffect(() => {
    if (resumeSubStep && !resumeJumpedRef.current) {
      resumeJumpedRef.current = true
      goToSubStep(resumeSubStep)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])  // intentionally empty — run once on mount only

  // ─── UI State ───
  const [otpCode, setOtpCode] = useState('')
  const [otpError, setOtpError] = useState(false)
  const [otpLoading, setOtpLoading] = useState(false)
  const [sendingOtp, setSendingOtp] = useState(false)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [resendCountdown, setResendCountdown] = useState(0)
  const [otpAttempts, setOtpAttempts] = useState(0)
  const [valuePropBeat, setValuePropBeat] = useState(0)
  const [locationStatus, setLocationStatus] = useState<'idle' | 'requesting' | 'granted' | 'settings' | 'error'>('idle')
  const [manualLocationText, setManualLocationText] = useState(initialData.manualLocation ?? '')
  const [locationSuggestions, setLocationSuggestions] = useState<import('../services/geocodingService').AutocompleteSuggestion[]>([])
  const [selectedLocation, setSelectedLocation] = useState<import('../services/geocodingService').AutocompleteSuggestion | null>(
    initialData.manualLocation
      ? { displayName: initialData.manualLocation, fullAddress: initialData.manualLocation }
      : null
  )
  const [locationSearchLoading, setLocationSearchLoading] = useState(false)
  const [showLocationSuggestions, setShowLocationSuggestions] = useState(false)
  const [locationHasSearched, setLocationHasSearched] = useState(false)
  const locationSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [launchState, setLaunchState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [launchLoadingText, setLaunchLoadingText] = useState('Finding your kind of places...')
  const [launchRetries, setLaunchRetries] = useState(0)
  const [showCountryPicker, setShowCountryPicker] = useState(false)
  const [showLanguagePicker, setShowLanguagePicker] = useState(false)
  const [showPersonDatePicker, setShowPersonDatePicker] = useState(false)
  const [showCustomTravelTime, setShowCustomTravelTime] = useState(false)
  const [customTravelInput, setCustomTravelInput] = useState('')
  // Audio state now lives in `data` for persistence (data.currentAudioFriendIndex, data.audioClipsByFriend)
  // Helper setters for convenience:
  const currentAudioFriendIndex = data.currentAudioFriendIndex
  const audioClipsByFriend = data.audioClipsByFriend
  const setCurrentAudioFriendIndex = useCallback((updater: number | ((i: number) => number)) => {
    setData(prev => ({
      ...prev,
      currentAudioFriendIndex: typeof updater === 'function' ? updater(prev.currentAudioFriendIndex) : updater,
    }))
  }, [])
  const setAudioClipsByFriend = useCallback((updater: Record<string, { storagePath: string; duration: number }> | ((prev: Record<string, { storagePath: string; duration: number }>) => Record<string, { storagePath: string; duration: number }>)) => {
    setData(prev => ({
      ...prev,
      audioClipsByFriend: typeof updater === 'function' ? updater(prev.audioClipsByFriend) : updater,
    }))
  }, [])

  const warmPoolPromiseRef = useRef<Promise<void> | null>(null)

  // Pending date for the Step 1 birthday picker.
  // Holds the in-progress date while the user is scrolling.
  // Only committed to `data` when the "Done" button is pressed.
  const pendingBirthdayRef = useRef<Date | null>(null)

  // Pending date for the Step 5 person birthday picker.
  // Committed to `data` only when the Next CTA is tapped.
  const pendingPersonBirthdayRef = useRef<Date | null>(null)

  // ─── Persist Onboarding Data to AsyncStorage ───
  // Debounced: saves 500ms after the last data change to avoid excessive writes
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveOnboardingData(data)
    }, 500)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [data])

  // ─── Reset picker modals when navigating away from details ───
  useEffect(() => {
    if (navState.subStep !== 'details') {
      setShowCountryPicker(false)
      setShowLanguagePicker(false)
      setShowDatePicker(false)
    }
  }, [navState.subStep])

  // ─── Seed pendingPersonBirthdayRef when arriving at pathB_birthday ───
  // Ensures pressing Next without scrolling commits the visible default date.
  // data.personBirthday is intentionally omitted from the dep array: we only
  // want to seed the ref when the user navigates TO this screen, not on every
  // data change. data.personBirthday only changes via the CTA (which also calls
  // handleGoNext, navigating away), so there is no scenario where it changes
  // while the user is on this screen and the ref needs re-seeding.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (navState.subStep === 'pathB_birthday') {
      pendingPersonBirthdayRef.current = data.personBirthday || DEFAULT_PERSON_DATE
    }
  }, [navState.subStep])

  // ─── Location Autocomplete Debounced Search ───
  useEffect(() => {
    // Only search when user is typing (not when a selection was made)
    if (selectedLocation) return
    if (manualLocationText.trim().length < 3) {
      setLocationSuggestions([])
      setShowLocationSuggestions(false)
      setLocationHasSearched(false)
      return
    }

    if (locationSearchTimer.current) clearTimeout(locationSearchTimer.current)

    locationSearchTimer.current = setTimeout(async () => {
      setLocationSearchLoading(true)
      try {
        const results = await geocodingService.autocomplete(manualLocationText.trim())
        setLocationSuggestions(results)
        setShowLocationSuggestions(results.length > 0)
      } catch {
        setLocationSuggestions([])
        setShowLocationSuggestions(false)
      }
      setLocationSearchLoading(false)
      setLocationHasSearched(true)
    }, 350)

    return () => {
      if (locationSearchTimer.current) clearTimeout(locationSearchTimer.current)
    }
  }, [manualLocationText, selectedLocation])

  // ─── Animations ───
  const fadeAnim = useRef(new Animated.Value(1)).current
  const slideAnim = useRef(new Animated.Value(0)).current
  const revealScale = useRef(new Animated.Value(0.8)).current
  const revealOpacity = useRef(new Animated.Value(0)).current

  // ─── Welcome Screen Animations (4-phase text reveal) ───
  const heyAnim = useRef({ opacity: new Animated.Value(0), translateY: new Animated.Value(20) }).current
  const nameAnim = useRef({ opacity: new Animated.Value(0), translateY: new Animated.Value(30), scale: new Animated.Value(0.92) }).current
  const tagTopAnim = useRef({ opacity: new Animated.Value(0), translateY: new Animated.Value(15) }).current
  const tagAccentAnim = useRef({ opacity: new Animated.Value(0), translateY: new Animated.Value(15) }).current
  const welcomeAnimRan = useRef(false)

  // ─── Intent Card Stagger Animations ───
  const intentAnims = useRef(
    ONBOARDING_INTENTS.map(() => ({
      opacity: new Animated.Value(0),
      scale: new Animated.Value(0.85),
    }))
  ).current

  useEffect(() => {
    if (navState.subStep !== 'intents') return

    // Reset all
    intentAnims.forEach((a) => {
      a.opacity.setValue(0)
      a.scale.setValue(0.85)
    })

    // Stagger in
    const animations = intentAnims.map((a, i) =>
      Animated.parallel([
        Animated.timing(a.opacity, {
          toValue: 1,
          duration: 300,
          delay: i * 70,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(a.scale, {
          toValue: 1,
          tension: 120,
          friction: 14,
          delay: i * 70,
          useNativeDriver: true,
        }),
      ])
    )

    Animated.parallel(animations).start()
  }, [navState.subStep])

  // ─── Location Step Entrance Animations ───
  const locIconAnim = useRef({ opacity: new Animated.Value(0), scale: new Animated.Value(0.5), translateY: new Animated.Value(20) }).current
  const locHeadlineAnim = useRef({ opacity: new Animated.Value(0), translateY: new Animated.Value(24) }).current
  const locBodyAnim = useRef({ opacity: new Animated.Value(0), translateY: new Animated.Value(20) }).current
  const locButtonAnim = useRef({ opacity: new Animated.Value(0), scale: new Animated.Value(0.85), translateY: new Animated.Value(16) }).current
  const locPulse = useRef(new Animated.Value(1)).current
  const locPulseRef = useRef<Animated.CompositeAnimation | null>(null)

  // When entering the location sub-step, reflect the captured data state.
  // If location was already captured, show 'granted' so the user sees their choice persisted.
  // Otherwise, reset to 'idle' so they can try fresh (clears stale 'denied'/'requesting').
  // Dep array is [navState.subStep] only — do NOT add data fields (see spec §9.1).
  // Adding data.locationGranted/coordinates would race with captureLocation()'s own status management.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (navState.subStep === 'location') {
      if (data.locationGranted && data.coordinates) {
        setLocationStatus('granted')
      } else {
        setLocationStatus('idle')
      }
    }
  }, [navState.subStep])

  useEffect(() => {
    if (navState.subStep !== 'location') return

    // Stop any running pulse
    locPulseRef.current?.stop()
    locPulseRef.current = null

    // Reset all
    locIconAnim.opacity.setValue(0)
    locIconAnim.scale.setValue(0.5)
    locIconAnim.translateY.setValue(20)
    locHeadlineAnim.opacity.setValue(0)
    locHeadlineAnim.translateY.setValue(24)
    locBodyAnim.opacity.setValue(0)
    locBodyAnim.translateY.setValue(20)
    locButtonAnim.opacity.setValue(0)
    locButtonAnim.scale.setValue(0.85)
    locButtonAnim.translateY.setValue(16)
    locPulse.setValue(1)

    // Staggered entrance: icon → headline → body → button
    Animated.stagger(120, [
      // Icon: spring in with scale + fade
      Animated.parallel([
        Animated.spring(locIconAnim.scale, { toValue: 1, tension: 100, friction: 8, useNativeDriver: true }),
        Animated.timing(locIconAnim.opacity, { toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(locIconAnim.translateY, { toValue: 0, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      // Headline: slide + fade
      Animated.parallel([
        Animated.timing(locHeadlineAnim.opacity, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(locHeadlineAnim.translateY, { toValue: 0, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      // Body: slide + fade
      Animated.parallel([
        Animated.timing(locBodyAnim.opacity, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(locBodyAnim.translateY, { toValue: 0, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      // Button: scale + slide + fade
      Animated.parallel([
        Animated.spring(locButtonAnim.scale, { toValue: 1, tension: 120, friction: 10, useNativeDriver: true }),
        Animated.timing(locButtonAnim.opacity, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(locButtonAnim.translateY, { toValue: 0, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
    ]).start(() => {
      // Subtle continuous icon pulse after entrance
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(locPulse, { toValue: 1.06, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(locPulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      )
      locPulseRef.current = pulse
      pulse.start()
    })

    return () => {
      locPulseRef.current?.stop()
      locPulseRef.current = null
    }
  }, [navState.subStep])

  // ─── Value Prop Icon Animations ───
  const vpIconScale = useRef(new Animated.Value(0.3)).current
  const vpIconOpacity = useRef(new Animated.Value(0)).current
  const vpFlashOpacity = useRef(new Animated.Value(0)).current
  const vpGlowScale = useRef(new Animated.Value(1)).current
  const vpGlowRef = useRef<Animated.CompositeAnimation | null>(null)

  useEffect(() => {
    if (navState.subStep !== 'value_prop') return

    // Stop any running glow loop
    vpGlowRef.current?.stop()
    vpGlowRef.current = null

    // Reset
    vpIconScale.setValue(0.3)
    vpIconOpacity.setValue(0)
    vpFlashOpacity.setValue(0)
    vpGlowScale.setValue(1)

    const isLightning = valuePropBeat === 2

    if (isLightning) {
      // Lightning strike: fast scale burst + white flash + glow pulse
      Animated.sequence([
        // Strike in
        Animated.parallel([
          Animated.spring(vpIconScale, {
            toValue: 1.2,
            tension: 300,
            friction: 8,
            useNativeDriver: true,
          }),
          Animated.timing(vpIconOpacity, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(vpFlashOpacity, {
              toValue: 0.9,
              duration: 80,
              useNativeDriver: true,
            }),
            Animated.timing(vpFlashOpacity, {
              toValue: 0,
              duration: 200,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
        ]),
        // Settle
        Animated.spring(vpIconScale, {
          toValue: 1,
          tension: 120,
          friction: 6,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Continuous subtle pulse
        const pulse = Animated.loop(
          Animated.sequence([
            Animated.timing(vpGlowScale, {
              toValue: 1.08,
              duration: 1200,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
            Animated.timing(vpGlowScale, {
              toValue: 1,
              duration: 1200,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ])
        )
        vpGlowRef.current = pulse
        pulse.start()
      })
    } else {
      // Standard entrance: smooth scale + fade
      Animated.parallel([
        Animated.spring(vpIconScale, {
          toValue: 1,
          tension: 80,
          friction: 10,
          useNativeDriver: true,
        }),
        Animated.timing(vpIconOpacity, {
          toValue: 1,
          duration: 350,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start()
    }

    return () => {
      vpGlowRef.current?.stop()
      vpGlowRef.current = null
    }
  }, [navState.subStep, valuePropBeat])

  // ─── Resend Countdown Timer ───
  useEffect(() => {
    if (resendCountdown <= 0) return
    const timer = setTimeout(() => setResendCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendCountdown])

  // ─── Value Prop Auto-Advance ───
  useEffect(() => {
    if (navState.subStep !== 'value_prop') return
    if (valuePropBeat >= 2) return
    const timer = setTimeout(() => setValuePropBeat((b) => b + 1), 3000)
    return () => clearTimeout(timer)
  }, [navState.subStep, valuePropBeat])

  // ─── Launch Logic ───
  useEffect(() => {
    if (!isLaunch) return
    handleLaunch()
  }, [isLaunch])

  // ─── Persist Major Step ───
  const persistStep = useCallback(
    async (step: number) => {
      if (!user?.id) return
      try {
        await supabase.from('profiles').update({ onboarding_step: step }).eq('id', user.id)
      } catch (e) {
        console.error('Step persist error:', e)
      }
    },
    [user?.id]
  )

  // ─── E.164 Phone Builder ───
  const buildE164 = useCallback(() => {
    const country = getCountryByCode(data.phoneCountryCode)
    const dialCode = country?.dialCode || '+1'
    const digits = data.phoneNumber.replace(/\D/g, '')
    return `${dialCode}${digits}`
  }, [data.phoneCountryCode, data.phoneNumber])

  const isPhoneValid = useCallback(() => {
    const e164 = buildE164()
    return /^\+[1-9]\d{1,14}$/.test(e164)
  }, [buildE164])

  // ─── Send OTP ───
  const handleSendOtp = useCallback(async () => {
    logger.action('Send OTP pressed')
    // Guard: if phone is already verified, skip OTP entirely and advance
    if (data.phoneVerified) {
      logger.onboarding('Phone already verified — skipping OTP send')
      goToSubStep('gender_identity')
      return
    }
    if (!isPhoneValid()) {
      logger.onboarding('OTP send blocked — phone invalid')
      setPhoneError('Check that number — something looks off.')
      return
    }
    setPhoneError(null)
    setSendingOtp(true)
    const e164 = buildE164()
    logger.onboarding('Sending OTP', { phone: e164.slice(0, 4) + '****' })
    const result = await sendOtp(e164)
    setSendingOtp(false)
    if (result.success) {
      // Server confirmed phone is already verified — skip OTP, mark verified
      if (result.status === 'already_verified') {
        logger.onboarding('Server says phone already verified — skipping OTP')
        setData((prev) => ({ ...prev, phoneVerified: true }))
        goToSubStep('gender_identity')
        return
      }
      setResendCountdown(30)
      setOtpAttempts(0)
      goNext() // advance to OTP sub-step
    } else {
      setPhoneError(result.error || "Couldn't send code. Try again.")
    }
  }, [isPhoneValid, buildE164, goNext, data.phoneVerified, goToSubStep])

  // ─── Resend OTP (does NOT advance state — used for auto-resend after 3 failures) ───
  const handleResendOtp = useCallback(async () => {
    logger.action('Resend OTP pressed')
    setSendingOtp(true)
    const result = await sendOtp(buildE164())
    setSendingOtp(false)
    if (result.success) {
      // Server confirmed phone is already verified — skip OTP, mark verified
      if (result.status === 'already_verified') {
        logger.onboarding('Server says phone already verified on resend — skipping OTP')
        setData((prev) => ({ ...prev, phoneVerified: true }))
        goToSubStep('gender_identity')
        return
      }
      setResendCountdown(30)
    } else {
      // Phone claimed by another user — navigate back to phone step with error
      if (result.error?.includes('already associated')) {
        setPhoneError(result.error)
        setOtpCode('')
        setOtpAttempts(0)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        goToSubStep('phone')
        return
      }
      // Generic resend failure
      setPhoneError(result.error || "Couldn't resend code. Try again.")
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      goToSubStep('phone')
    }
  }, [buildE164, goToSubStep])

  // ─── Verify OTP ───
  const handleVerifyOtp = useCallback(
    async (code: string) => {
      logger.action('Verify OTP pressed')
      setOtpLoading(true)
      setOtpError(false)
      const result = await verifyOtp(buildE164(), code)
      setOtpLoading(false)
      if (result.success) {
        logger.onboarding('OTP verified successfully')
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        // Pre-populate identity defaults from phone context (atomic update)
        setData((prev) => ({
          ...prev,
          phoneVerified: true,
          userCountry: prev.phoneCountryCode,  // Default country = phone country
          userPreferredLanguage: getDefaultLanguageCode(),  // Default language = device locale
        }))
        // NOTE: persistStep(2) intentionally removed here — moved to handleSaveIdentity
        // to prevent bypassing gender_identity/details on resume
        setTimeout(() => goNext(), 800) // pause for success animation
      } else {
        logger.onboarding('OTP verification failed', { attempts: otpAttempts + 1, error: result.error })

        // Phone already claimed by another user — show error on phone step, not OTP step
        if (result.error?.includes('already associated')) {
          setPhoneError(result.error)
          setOtpCode('')
          setOtpAttempts(0)
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
          goToSubStep('phone')
          return
        }

        setOtpError(true)
        setOtpAttempts((a) => a + 1)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        if (otpAttempts >= 2) {
          // Auto-resend after 3 failures — does NOT advance past OTP
          setOtpCode('')
          setOtpAttempts(0)
          handleResendOtp()
        }
      }
    },
    [buildE164, goNext, otpAttempts, handleResendOtp, goToSubStep]
  )

  // ─── Location Capture ───
  const captureLocation = useCallback(async () => {
    try {
      // Race against 10s timeout to prevent indefinite hang on GPS warm-up
      const loc = await Promise.race([
        locationService.getCurrentLocation(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000)),
      ])

      if (!loc) {
        // GPS returned null (warm-up timeout or no signal) — show error state, not denied
        logger.onboarding('Location capture returned null — GPS timeout or warm-up failure')
        setLocationStatus('error')
        return
      }

      // Reverse geocode through the throttled wrapper — NOT direct Location.reverseGeocodeAsync
      let city: string | null = null
      try {
        const { addresses } = await throttledReverseGeocode(loc.latitude, loc.longitude)
        city = addresses[0]?.city || addresses[0]?.region || null
      } catch (geocodeError: unknown) {
        // Geocode failed (rate limit retry exhausted, network error, etc.)
        // Proceed WITHOUT city name — coordinates are still valid
        logger.onboarding('Reverse geocode failed, proceeding without city name', {
          error: geocodeError instanceof Error ? geocodeError.message : String(geocodeError),
        })
      }

      setData((prev) => ({
        ...prev,
        locationGranted: true,
        coordinates: { lat: loc.latitude, lng: loc.longitude },
        cityName: city, // null if geocode failed — NEVER 'your area'
        useGpsLocation: true,
      }))
      setHasGpsPermission(true)
      setLocationStatus('granted')
      logger.onboarding('Location captured', { city, lat: loc.latitude, lng: loc.longitude })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)

      // Persist location choice immediately so it survives app restart
      persistStep(4).catch(() => {})
      if (user?.id) {
        PreferencesService.updateUserPreferences(user.id, {
          use_gps_location: true,
          custom_location: null,
        } as any).catch(() => {})
      }
      autoAdvanceRef.current = setTimeout(() => goNextRef.current(), 1200)

      // Locale detection — use country from the geocode result we already have
      if (city) {
        // We got a geocode result — extract country from the same cached call
        let detectedCountry: string | null = null
        try {
          const { addresses } = await throttledReverseGeocode(loc.latitude, loc.longitude) // hits cache
          detectedCountry = addresses[0]?.country || null
        } catch { /* already logged above */ }

        const detected = detectLocaleFromCountryName(detectedCountry)
        if (user?.id) {
          PreferencesService.updateUserProfile(user.id, {
            currency: detected.currency,
            measurement_system: detected.measurementSystemDb,
          }).catch((err) => {
            console.warn('Locale DB write failed in captureLocation:', err?.message)
          })
        }
        const currentProfile = useAppStore.getState().profile
        if (currentProfile) {
          setProfile({
            ...currentProfile,
            currency: detected.currency,
            measurement_system: detected.measurementSystemDb,
          })
        }
        logger.onboarding('Locale auto-detected', {
          currency: detected.currency,
          measurement: detected.measurementSystem,
          country: detected.countryName,
        })
      } else {
        // No geocode result — detect locale from coordinates in background (uses geocodingService, NOT native)
        detectLocaleFromCoordinates(loc.latitude, loc.longitude).then((detected) => {
          if (user?.id) {
            PreferencesService.updateUserProfile(user.id, {
              currency: detected.currency,
              measurement_system: detected.measurementSystemDb,
            }).catch((err) => {
              console.warn('Locale DB write failed in captureLocation (fallback):', err?.message)
            })
          }
          const currentProfile = useAppStore.getState().profile
          if (currentProfile) {
            setProfile({
              ...currentProfile,
              currency: detected.currency,
              measurement_system: detected.measurementSystemDb,
            })
          }
        }).catch(() => {})
      }
    } catch (e: unknown) {
      console.error('Location capture error:', e)
      // Distinguish rate-limit / transient errors from actual permission issues
      const msg = (e instanceof Error ? e.message : String(e)) || ''
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')) {
        setLocationStatus('settings')
      } else {
        setLocationStatus('error')
      }
    }
  }, [persistStep, user?.id, setProfile])

  // ─── Location Permission ───
  const handleLocationRequest = useCallback(async () => {
    logger.action('Location permission requested')
    setLocationStatus('requesting')
    try {
      const { status, canAskAgain } = await Location.getForegroundPermissionsAsync()

      if (status === 'granted') {
        logger.onboarding('Location: already granted')
        await captureLocation()
        return
      }

      if (!canAskAgain) {
        logger.onboarding('Location: cannot ask again — showing settings prompt')
        setLocationStatus('settings')
        return
      }

      const result = await Location.requestForegroundPermissionsAsync()
      if (result.status === 'granted') {
        logger.onboarding('Location: permission granted')
        await captureLocation()
      } else {
        logger.onboarding('Location: permission denied — prompting settings')
        setLocationStatus('settings')
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      }
    } catch (e) {
      console.error('Location permission request error:', e)
      setLocationStatus('error')
    }
  }, [captureLocation])

  // ─── Location Suggestion Selection ───
  const handleSelectLocationSuggestion = useCallback(async (suggestion: import('../services/geocodingService').AutocompleteSuggestion) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setSelectedLocation(suggestion)
    setManualLocationText(suggestion.displayName)
    setShowLocationSuggestions(false)
    setLocationSuggestions([])
    logger.action('Location suggestion selected', { displayName: suggestion.displayName, placeId: suggestion.placeId })

    // Resolve coordinates if not already present (Google path returns placeId only)
    if (!suggestion.location && suggestion.placeId) {
      const coords = await geocodingService.getPlaceCoordinates(suggestion.placeId)
      if (coords) {
        setSelectedLocation({ ...suggestion, location: coords })
      }
    }
  }, [])

  // ─── Clear Location Selection (user wants to search again) ───
  const handleClearLocationSelection = useCallback(() => {
    setSelectedLocation(null)
    setManualLocationText('')
    setLocationSuggestions([])
    setShowLocationSuggestions(false)
    setLocationHasSearched(false)
  }, [])

  // ─── Manual Location Submit (uses pre-selected suggestion) ───
  const handleManualLocation = useCallback(async () => {
    if (!selectedLocation) return
    logger.action('Manual location submitted', { displayName: selectedLocation.displayName })
    setSavingPrefs(true)
    try {
      // Resolve coordinates: from suggestion.location or placeId lookup
      let lat: number | undefined
      let lng: number | undefined

      if (selectedLocation.location) {
        lat = selectedLocation.location.lat
        lng = selectedLocation.location.lng
      } else if (selectedLocation.placeId) {
        const coords = await geocodingService.getPlaceCoordinates(selectedLocation.placeId)
        if (coords) { lat = coords.lat; lng = coords.lng }
      }

      if (lat != null && lng != null) {
        setData((prev) => ({
          ...prev,
          manualLocation: selectedLocation.displayName,
          coordinates: { lat: lat!, lng: lng! },
        }))

        if (user?.id) {
          PreferencesService.updateUserPreferences(user.id, {
            use_gps_location: false,
            custom_location: selectedLocation.displayName,
          } as any).catch(() => {})
        }

        goNext()

        detectLocaleFromCoordinates(lat, lng).then((detected) => {
          if (user?.id) {
            PreferencesService.updateUserProfile(user.id, {
              currency: detected.currency,
              measurement_system: detected.measurementSystemDb,
            }).catch((err) => {
              console.warn('Locale DB write failed in handleManualLocation:', err?.message)
            })
          }
          const currentProfile = useAppStore.getState().profile
          if (currentProfile) {
            setProfile({
              ...currentProfile,
              currency: detected.currency,
              measurement_system: detected.measurementSystemDb,
            })
          }
          logger.onboarding('Locale auto-detected (manual)', {
            currency: detected.currency,
            measurement: detected.measurementSystem,
            country: detected.countryName,
          })
        }).catch(() => {})
      } else {
        // Coordinates could not be resolved — fallback to native geocoder
        const nativeResults = await Location.geocodeAsync(selectedLocation.displayName)
        if (nativeResults.length > 0) {
          const nLat = nativeResults[0].latitude
          const nLng = nativeResults[0].longitude
          setData((prev) => ({
            ...prev,
            manualLocation: selectedLocation.displayName,
            coordinates: { lat: nLat, lng: nLng },
          }))
          goNext()
          detectLocaleFromCoordinates(nLat, nLng).then((detected) => {
            if (user?.id) {
              PreferencesService.updateUserProfile(user.id, {
                currency: detected.currency,
                measurement_system: detected.measurementSystemDb,
              }).catch((err) => {
                console.warn('Locale DB write failed:', err?.message)
              })
            }
            const currentProfile = useAppStore.getState().profile
            if (currentProfile) {
              setProfile({
                ...currentProfile,
                currency: detected.currency,
                measurement_system: detected.measurementSystemDb,
              })
            }
          }).catch(() => {})
        }
      }
    } catch (e) {
      console.error('Geocode error:', e)
    }
    setSavingPrefs(false)
  }, [selectedLocation, goNext, user?.id, setProfile])

  // ─── Save Preferences (Step 4 → 5 transition) ───
  const handleSavePreferences = useCallback(async () => {
    if (!user?.id) return
    const highestTier = data.selectedPriceTiers.length > 0
      ? PRICE_TIERS.slice().reverse().find(t => data.selectedPriceTiers.includes(t.slug))
      : undefined
    const backCompatBudgetMax = highestTier?.max ?? 1000

    logger.action('Save preferences pressed', { categories: data.selectedCategories.length, priceTiers: data.selectedPriceTiers, transport: data.travelMode })
    setSavingPrefs(true)
    try {
      await PreferencesService.updateUserPreferences(user.id, {
        intents: data.selectedIntents,
        categories: data.selectedCategories,
        price_tiers: data.selectedPriceTiers,
        budget_min: 0,
        budget_max: backCompatBudgetMax,
        travel_mode: data.travelMode,
        travel_constraint_type: 'time',
        travel_constraint_value: data.travelTimeMinutes,
        datetime_pref: new Date().toISOString(),
        date_option: 'now',
        use_gps_location: data.useGpsLocation,
        custom_location: data.manualLocation,
      } as any)

      // Backfill any collaboration preferences rows that were created with empty defaults
      // (from invites accepted before onboarding completed)
      try {
        const { data: soloPrefs } = await supabase
          .from("preferences")
          .select("categories, intents, price_tiers, budget_min, budget_max, travel_mode, travel_constraint_value, date_option, time_slot, exact_time, datetime_pref, use_gps_location, custom_location")
          .eq("profile_id", user.id)
          .single()

        if (soloPrefs && soloPrefs.categories?.length > 0) {
          await supabase
            .from("board_session_preferences")
            .update({
              categories: soloPrefs.categories,
              intents: soloPrefs.intents ?? [],
              price_tiers: soloPrefs.price_tiers ?? [],
              budget_min: soloPrefs.budget_min ?? 0,
              budget_max: soloPrefs.budget_max ?? 1000,
              travel_mode: soloPrefs.travel_mode ?? "walking",
              travel_constraint_value: soloPrefs.travel_constraint_value ?? 30,
              date_option: soloPrefs.date_option ?? null,
              time_slot: soloPrefs.time_slot ?? null,
              exact_time: soloPrefs.exact_time ?? null,
              datetime_pref: soloPrefs.datetime_pref ?? null,
              use_gps_location: soloPrefs.use_gps_location ?? true,
              custom_location: soloPrefs.custom_location ?? null,
            })
            .eq("user_id", user.id)
            .filter("categories", "eq", "{}")
        }
      } catch (backfillErr) {
        // Non-critical — log and continue
        console.warn('[Onboarding] Collab prefs backfill failed:', backfillErr)
      }

      persistStep(5).catch(() => {})

      // Warm the deck pool — both category cards and curated cards
      const coords = data.coordinates
      if (coords) {
        const warmPoolPromise = deckService.warmDeckPool({
          location: coords,
          categories: data.selectedCategories,
          intents: data.selectedIntents,
          priceTiers: data.selectedPriceTiers ?? DEFAULT_PRICE_TIERS,
          budgetMin: 0,
          budgetMax: backCompatBudgetMax,
          travelMode: data.travelMode,
          travelConstraintType: 'time',
          travelConstraintValue: data.travelTimeMinutes,
          datetimePref: new Date().toISOString(),
          dateOption: 'now',
          timeSlot: null,
        }).catch((err) => {
          console.warn('[Onboarding] Warm pool failed:', err);
        });

        // Store promise ref for readiness check in handleLaunch
        warmPoolPromiseRef.current = warmPoolPromise;
      }

      goNext()
    } catch (e) {
      console.error('Preferences save error:', e)
    }
    setSavingPrefs(false)
  }, [user?.id, data, goNext, persistStep, queryClient])

  // ─── Save Identity & Details (Step 1 gender_identity + details → Step 2 transition) ───
  const handleSaveIdentity = useCallback(async () => {
    if (!user?.id) return
    logger.action('Save identity pressed', {
      gender: data.userGender,
      country: data.userCountry,
      language: data.userPreferredLanguage,
      hasBirthday: !!data.userBirthday,
    })

    // Fire-and-forget profile save — do NOT block navigation
    PreferencesService.updateUserProfile(user.id, {
      gender: data.userGender,
      birthday: data.userBirthday?.toISOString().split('T')[0] || null,
      country: data.userCountry,
      preferred_language: data.userPreferredLanguage,
    }).then(() => {
      // Update local Zustand store so profile reflects new data immediately
      const currentProfile = useAppStore.getState().profile
      if (currentProfile) {
        useAppStore.getState().setProfile({
          ...currentProfile,
          gender: data.userGender,
          birthday: data.userBirthday?.toISOString().split('T')[0] || null,
          country: data.userCountry,
          preferred_language: data.userPreferredLanguage,
        })
      }
    }).catch((err) => {
      console.warn('[Onboarding] Identity save failed:', err?.message)
      // Non-blocking — user continues onboarding. Data will be re-saved at launch if needed.
    })

    persistStep(2).catch(() => {})
    goNext()
  }, [user?.id, data.userGender, data.userBirthday, data.userCountry, data.userPreferredLanguage, goNext, persistStep])

  // ─── Step 5 Save Person (Path B) ───
  const handleSavePersonPathB = useCallback(async () => {
    if (!user?.id) return
    logger.action('Save person (Path B) pressed')
    setSaving(true)
    try {
      const personData = {
        user_id: user.id,
        name: data.personName || 'Friend',
        initials: (data.personName || 'F').slice(0, 2).toUpperCase(),
        birthday: data.personBirthday?.toISOString().split('T')[0] || null,
        gender: data.personGender as SavedPerson['gender'],
        description: null as string | null,
      }
      const person = await createSavedPerson(personData)

      if (data.audioClipStoragePath && person?.id) {
        const fileName = data.audioClipStoragePath.split('/').pop() || `onboarding_${Date.now()}.m4a`
        // Audio was eagerly uploaded to staging — just create the DB record
        await createAudioClipRecord(user.id, person.id, data.audioClipStoragePath, fileName, data.audioClipDuration || 0, 0)

        // Fire-and-forget: process audio (edge function may not be deployed yet — safe to skip)
        const coords = data.coordinates
        if (coords) {
          processPersonAudio({
            personId: person.id,
            audioStoragePath: data.audioClipStoragePath,
            location: { latitude: coords.lat, longitude: coords.lng },
            occasions: buildOccasions(data.personBirthday),
          }).catch((err) => console.info('[Onboarding] Audio processing (fire-and-forget):', err?.message))
        }
      }
      setSaving(false)
      goNext()
    } catch (e) {
      console.error('Save person error:', e)
      setSaving(false)
    }
  }, [user?.id, data, goNext])

  // ─── Step 5 Save Sync Friends (Path A) ───
  const handleSaveSyncFriends = useCallback(async () => {
    if (!user?.id) return
    logger.action('Save sync friends pressed')
    setSaving(true)
    try {
      for (const friend of data.selectedSyncFriends) {
        // Create saved_person for each friend
        const personData = {
          user_id: user.id,
          name: friend.displayName || 'Friend',
          initials: (friend.displayName || 'F').slice(0, 2).toUpperCase(),
          birthday: null as string | null,
          gender: null as SavedPerson['gender'],
          description: null as string | null,
        }
        const person = await createSavedPerson(personData)

        // 3. Create audio clip record if audio was recorded
        const friendKey = friend.userId || friend.phoneE164
        const clip = audioClipsByFriend[friendKey]
        if (clip && clip.storagePath && person?.id) {
          const fileName = clip.storagePath.split('/').pop() || `onboarding_sync_${Date.now()}.m4a`
          await createAudioClipRecord(user.id, person.id, clip.storagePath, fileName, clip.duration, 0)

          // Fire-and-forget: process audio
          const coords = data.coordinates
          if (coords) {
            processPersonAudio({
              personId: person.id,
              audioStoragePath: clip.storagePath,
              location: { latitude: coords.lat, longitude: coords.lng },
              occasions: buildOccasions(null),
            }).catch((err) => console.info('[Onboarding] Sync audio processing (fire-and-forget):', err?.message))
          }
        }

      }
      setSaving(false)
      goNext() // This triggers launch (end of Path A sequence)
    } catch (e) {
      console.error('Save sync friends error:', e)
      setSaving(false)
    }
  }, [user?.id, data, audioClipsByFriend, goNext])

  // ─── Reveal Animation (declared before handleLaunch — handleLaunch depends on it) ───
  const playRevealAnimation = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    Animated.parallel([
      Animated.spring(revealScale, { toValue: 1, tension: 80, friction: 10, useNativeDriver: true }),
      Animated.timing(revealOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start()
    setTimeout(() => onComplete(), 1500)
  }, [onComplete, revealScale, revealOpacity])

  // ─── Launch Handler ───
  const handleLaunch = useCallback(async () => {
    if (!user?.id) return
    logger.onboarding('Launch sequence started')

    // Clear persisted onboarding data — no longer needed after completion
    clearOnboardingData()

    try {
      // Mark onboarding complete + ensure identity data is persisted (safety net)
      await supabase.from('profiles').update({
        has_completed_onboarding: true,
        onboarding_step: 0,
        // Safety net: re-save identity data in case fire-and-forget in handleSaveIdentity failed
        gender: data.userGender,
        birthday: data.userBirthday?.toISOString().split('T')[0] || null,
        country: data.userCountry,
        preferred_language: data.userPreferredLanguage,
      }).eq('id', user.id)

      const currentProfile = useAppStore.getState().profile
      if (currentProfile) {
        useAppStore.getState().setProfile({
          ...currentProfile,
          has_completed_onboarding: true,
          onboarding_step: 0,
          gender: data.userGender,
          birthday: data.userBirthday?.toISOString().split('T')[0] || null,
          country: data.userCountry,
          preferred_language: data.userPreferredLanguage,
        })
      }

      // Wait for warm pool (max 3 seconds)
      if (warmPoolPromiseRef.current) {
        const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
        await Promise.race([warmPoolPromiseRef.current, timeout]);
      }

      setLaunchState('ready')
      playRevealAnimation()
    } catch (err) {
      console.warn('[Onboarding] Launch error:', err)
      // Proceed anyway — useDeckCards will handle cold fetch
      setLaunchState('ready')
      playRevealAnimation()
    }
  }, [user?.id, data.userGender, data.userBirthday, data.userCountry, data.userPreferredLanguage, playRevealAnimation])

  const handleLaunchRetry = useCallback(() => {
    logger.action('Launch retry pressed', { attempt: launchRetries + 1 })
    setLaunchRetries((r) => r + 1)
    setLaunchState('loading')
    handleLaunch()
  }, [handleLaunch, launchRetries])

  // ─── Welcome Text Entrance Animation ───
  useEffect(() => {
    if (navState.subStep !== 'welcome' || welcomeAnimRan.current) return
    welcomeAnimRan.current = true

    const runWelcomeAnim = async () => {
      let reducedMotion = false
      try {
        reducedMotion = await AccessibilityInfo.isReduceMotionEnabled()
      } catch {
        reducedMotion = false
      }

      if (reducedMotion) {
        heyAnim.opacity.setValue(1)
        heyAnim.translateY.setValue(0)
        nameAnim.opacity.setValue(1)
        nameAnim.translateY.setValue(0)
        nameAnim.scale.setValue(1)
        tagTopAnim.opacity.setValue(1)
        tagTopAnim.translateY.setValue(0)
        tagAccentAnim.opacity.setValue(1)
        tagAccentAnim.translateY.setValue(0)
        return
      }

      // T+0ms: "Hey" fades in
      Animated.parallel([
        Animated.timing(heyAnim.opacity, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.spring(heyAnim.translateY, { toValue: 0, tension: 120, friction: 12, useNativeDriver: true }),
      ]).start()

      // T+150ms: "{firstName}." slides up
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(nameAnim.opacity, { toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.spring(nameAnim.translateY, { toValue: 0, tension: 100, friction: 12, useNativeDriver: true }),
          Animated.spring(nameAnim.scale, { toValue: 1, tension: 100, friction: 12, useNativeDriver: true }),
        ]).start()
      }, 150)

      // T+550ms: "Good taste" fades in
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(tagTopAnim.opacity, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.spring(tagTopAnim.translateY, { toValue: 0, tension: 120, friction: 12, useNativeDriver: true }),
        ]).start()
      }, 550)

      // T+700ms: "just walked in." fades in
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(tagAccentAnim.opacity, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.spring(tagAccentAnim.translateY, { toValue: 0, tension: 120, friction: 12, useNativeDriver: true }),
        ]).start()
      }, 700)
    }

    runWelcomeAnim()
  }, [navState.subStep])

  // ─── Step-Level Nav Handlers ───
  const handleGoNext = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    goNext()
  }, [goNext])

  const handleGoBack = useCallback(() => {
    // Clear any pending auto-advance timeout (prevents ghost navigation from location step)
    if (autoAdvanceRef.current) {
      clearTimeout(autoAdvanceRef.current)
      autoAdvanceRef.current = null
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

    // Skip OTP step when navigating back if phone is already verified
    // (user shouldn't land on "Enter the code" screen when already verified)
    if (data.phoneVerified && navState.subStep === 'gender_identity') {
      goToSubStep('phone')
      return
    }

    // Path A audio: navigate between friends before hitting the state machine
    if (navState.subStep === 'pathA_audio' && currentAudioFriendIndex > 0) {
      setCurrentAudioFriendIndex(i => i - 1)
      return
    }

    goBack()
  }, [goBack, goToSubStep, data.phoneVerified, navState.subStep, currentAudioFriendIndex])

  const handleBackToWelcome = useCallback(async () => {
    logger.action('Back to welcome — signing out')
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    // Clear persisted onboarding data BEFORE signing out.
    // AppStateManager.handleSignOut does this via a prefix sweep, but
    // handleBackToWelcome bypasses handleSignOut — so we do it explicitly here
    // to prevent the next user from inheriting this session's onboarding data.
    await clearOnboardingData()
    await supabase.auth.signOut()
  }, [])

  // ─── CTA Config ───
  const getCtaConfig = useCallback(() => {
    const { step, subStep } = navState

    switch (subStep) {
      case 'welcome':
        return { label: "Let's go", disabled: false, loading: false, onPress: handleGoNext, hide: false }
      case 'phone':
        return data.phoneVerified
          ? { label: 'Continue', disabled: false, loading: false, onPress: () => goToSubStep('gender_identity'), hide: false }
          : { label: 'Send code', disabled: !isPhoneValid(), loading: sendingOtp, onPress: handleSendOtp, hide: false }
      case 'otp':
        return { label: 'Verify', disabled: otpCode.length < 6, loading: otpLoading, onPress: () => handleVerifyOtp(otpCode), hide: true }
      case 'gender_identity':
        return { label: 'Next', disabled: !data.userGender, loading: false, onPress: handleGoNext, hide: false }
      case 'details':
        return { label: "Let's go", disabled: !data.userBirthday, loading: false, onPress: handleSaveIdentity, hide: false }
      case 'value_prop':
        return { label: 'Next', disabled: false, loading: false, onPress: () => { logger.action(`Value prop beat advance`, { beat: valuePropBeat }); setValuePropBeat(Math.min(valuePropBeat + 1, 2)); if (valuePropBeat >= 2) handleGoNext() }, hide: false }
      case 'intents':
        return { label: 'Next', disabled: data.selectedIntents.length === 0, loading: false, onPress: () => {
          persistStep(3).catch(() => {})
          // Persist intents immediately so they survive app restart during Step 3/4
          if (user?.id) {
            PreferencesService.updateUserPreferences(user.id, { intents: data.selectedIntents } as any).catch(() => {})
          }
          handleGoNext()
        }, hide: false }
      case 'location':
        return { label: 'Enable location', disabled: locationStatus === 'requesting', loading: locationStatus === 'requesting', onPress: handleLocationRequest, hide: true }
      case 'celebration':
        return { label: 'Next', disabled: false, loading: false, onPress: handleGoNext, hide: false }
      case 'manual_location':
        return { label: 'Next', disabled: !selectedLocation, loading: savingPrefs, onPress: handleManualLocation, hide: false }
      case 'categories':
        return { label: 'Next', disabled: data.selectedCategories.length === 0, loading: false, onPress: () => {
          // Persist categories progressively so they survive app restart
          if (user?.id) {
            PreferencesService.updateUserPreferences(user.id, { categories: data.selectedCategories } as any).catch(() => {})
          }
          handleGoNext()
        }, hide: false }
      case 'budget':
        return { label: 'Next', disabled: data.selectedPriceTiers.length === 0, loading: false, onPress: () => {
          // Persist price tiers progressively
          if (user?.id) {
            const highestTier = PRICE_TIERS.slice().reverse().find(t => data.selectedPriceTiers.includes(t.slug))
            PreferencesService.updateUserPreferences(user.id, {
              price_tiers: data.selectedPriceTiers,
              budget_min: 0,
              budget_max: highestTier?.max ?? 1000,
            } as any).catch(() => {})
          }
          handleGoNext()
        }, hide: false }
      case 'transport':
        return { label: 'Next', disabled: false, loading: false, onPress: () => {
          // Persist transport mode progressively
          if (user?.id) {
            PreferencesService.updateUserPreferences(user.id, { travel_mode: data.travelMode } as any).catch(() => {})
          }
          handleGoNext()
        }, hide: false }
      case 'travel_time':
        return { label: 'Next', disabled: false, loading: savingPrefs, onPress: handleSavePreferences, hide: false }
      case 'friends':
        // OnboardingFriendsStep has its own Continue/Skip buttons
        return { label: '', disabled: true, loading: false, onPress: () => {}, hide: true }
      case 'consent':
        // OnboardingConsentStep has its own action buttons
        return { label: '', disabled: true, loading: false, onPress: () => {}, hide: true }
      case 'collaboration':
        return { label: '', disabled: true, loading: false, onPress: () => {}, hide: true }
      case 'pitch':
        return { label: '', disabled: true, loading: false, onPress: () => {}, hide: true }
      case 'pathA_sync':
        // Continue button is internal to OnboardingSyncStep component
        return { label: '', disabled: true, loading: false, onPress: () => {}, hide: true }
      case 'pathA_audio': {
        const friend = data.selectedSyncFriends[currentAudioFriendIndex]
        const friendId = friend?.userId || friend?.phoneE164
        const clip = friendId ? audioClipsByFriend[friendId] : null
        const hasMinAudio = clip && clip.duration >= 10
        const isLastFriend = currentAudioFriendIndex >= data.selectedSyncFriends.length - 1

        if (isLastFriend) {
          return { label: 'Finish', disabled: !hasMinAudio, loading: saving, onPress: handleSaveSyncFriends, hide: false }
        }
        return {
          label: 'Next',
          disabled: !hasMinAudio,
          loading: false,
          onPress: () => setCurrentAudioFriendIndex((i) => i + 1),
          hide: false,
        }
      }
      case 'pathB_birthday':
        return {
          label: 'Next',
          disabled: false,
          loading: false,
          onPress: () => {
            const personDateToCommit = pendingPersonBirthdayRef.current
            if (personDateToCommit) {
              setData((p) => ({ ...p, personBirthday: personDateToCommit }))
              pendingPersonBirthdayRef.current = null
            } else if (!data.personBirthday) {
              // Safety fallback: normally unreachable because the seeding useEffect
              // (above) always initializes pendingPersonBirthdayRef.current before the
              // user can tap Next. DO NOT remove that effect assuming this branch covers it —
              // this branch only fires if the effect somehow did not run (e.g., future
              // refactor changes the dependency array). The ref seeding is the real guard.
              setData((p) => ({ ...p, personBirthday: DEFAULT_PERSON_DATE }))
            }
            handleGoNext()
          },
          hide: false,
        }
      case 'pathB_gender':
        return { label: 'Next', disabled: !data.personGender, loading: false, onPress: handleGoNext, hide: false }
      case 'pathB_audio':
        return {
          label: 'Finish',
          disabled: !data.audioClipStoragePath || (data.audioClipDuration || 0) < 10,
          loading: saving,
          onPress: handleSavePersonPathB,
          hide: false,
        }
      case 'pathB_name':
        return { label: 'Next', disabled: !data.personName?.trim(), loading: false, onPress: handleGoNext, hide: false }
      default:
        return { label: 'Next', disabled: false, loading: false, onPress: handleGoNext, hide: false }
    }
  }, [navState, data, otpCode, otpLoading, sendingOtp, isPhoneValid, valuePropBeat, locationStatus, selectedLocation, savingPrefs, saving, handleGoNext, handleSendOtp, handleVerifyOtp, handleLocationRequest, handleManualLocation, handleSavePreferences, handleSaveIdentity, handleSavePersonPathB, handleSaveSyncFriends, persistStep, goToSubStep, currentAudioFriendIndex, audioClipsByFriend])

  // ─── Render Step Content ───
  const renderContent = () => {
    const { step, subStep } = navState
    logger.onboarding(`Rendering: Step ${step} / ${subStep}`)
    const firstName = profile?.first_name || profile?.display_name || user?.email?.split('@')[0] || 'there'

    // ─── STEP 1 ───
    if (subStep === 'welcome') {
      return (
        <View style={styles.centerContent}>
          <Animated.Text
            style={[
              styles.welcomeGreeting,
              { opacity: heyAnim.opacity, transform: [{ translateY: heyAnim.translateY }] },
            ]}
          >
            Hey
          </Animated.Text>
          <Animated.Text
            style={[
              styles.welcomeName,
              { opacity: nameAnim.opacity, transform: [{ translateY: nameAnim.translateY }, { scale: nameAnim.scale }] },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {firstName}.
          </Animated.Text>
          <Animated.Text
            style={[
              styles.welcomeTaglineTop,
              { opacity: tagTopAnim.opacity, transform: [{ translateY: tagTopAnim.translateY }] },
            ]}
          >
            Good taste
          </Animated.Text>
          <Animated.Text
            style={[
              styles.welcomeTaglineAccent,
              { opacity: tagAccentAnim.opacity, transform: [{ translateY: tagAccentAnim.translateY }] },
            ]}
          >
            just walked in.
          </Animated.Text>
        </View>
      )
    }

    if (subStep === 'phone') {
      // If phone is already verified (user navigated back or resumed), show verified state
      if (data.phoneVerified) {
        // Use profile.phone (persisted E.164) as primary source, fall back to buildE164()
        // for same-session verification where profile may not have refreshed yet
        const displayPhone = profile?.phone || buildE164()
        return (
          <View>
            <Text style={styles.headline}>You're all set.</Text>
            <Text style={styles.body}>Your number's locked in. One less thing.</Text>
            <View style={styles.verifiedCard}>
              <View style={styles.verifiedBadgeRow}>
                <View style={styles.verifiedIconCircle}>
                  <Ionicons name="checkmark" size={16} color="#fff" />
                </View>
                <Text style={styles.verifiedBadgeText}>Verified</Text>
              </View>
              <Text style={styles.verifiedPhoneNumber}>{displayPhone}</Text>
            </View>
          </View>
        )
      }

      return (
        <View>
          <Text style={styles.headline}>What's your number?</Text>
          <Text style={styles.body}>We'll send a code. Takes two seconds.</Text>
          <View style={styles.inputSpacing}>
            <PhoneInput
              value={data.phoneNumber}
              countryCode={data.phoneCountryCode}
              onChangePhone={(phone) => { setData((p) => ({ ...p, phoneNumber: phone })); setPhoneError(null) }}
              onChangeCountry={(code) => setData((p) => ({ ...p, phoneCountryCode: code }))}
              error={phoneError}
              disabled={sendingOtp}
            />
          </View>
          <Text style={styles.caption}>Only used to verify it's you. That's it.</Text>
        </View>
      )
    }

    if (subStep === 'otp') {
      return (
        <View>
          <Text style={styles.headline}>Enter the code</Text>
          <Text style={styles.body}>Sent to {buildE164()}</Text>
          <View style={styles.otpContainer}>
            <OTPInput
              length={6}
              value={otpCode}
              onChange={setOtpCode}
              onComplete={handleVerifyOtp}
              error={otpError}
              disabled={otpLoading}
            />
          </View>
          {otpLoading ? (
            <Text style={[styles.caption, styles.textCenter]}>Verifying...</Text>
          ) : (
            <>
              <View style={styles.resendRow}>
                {resendCountdown > 0 ? (
                  <Text style={styles.caption}>Resend in {resendCountdown}s</Text>
                ) : (
                  <Pressable onPress={handleResendOtp}>
                    <Text style={styles.linkText}>Resend code</Text>
                  </Pressable>
                )}
              </View>
              {otpError && (
                <Text style={styles.errorText}>
                  {otpAttempts >= 3 ? 'Three tries, no luck. Sending a fresh code.' : "That code didn't land. Try again."}
                </Text>
              )}
            </>
          )}
        </View>
      )
    }

    // ─── Step 1: Gender Identity ───
    if (subStep === 'gender_identity') {
      return (
        <View>
          <Text style={styles.headline}>Tell us about you.</Text>
          <Text style={styles.body}>So we can get your picks right.</Text>
          <View style={styles.genderListContainer}>
            {GENDER_OPTIONS.map((g) => (
              <Pressable
                key={g}
                style={[styles.genderRow, data.userGender === g && styles.genderRowSelected]}
                onPress={() => {
                  logger.action(`User gender selected: ${GENDER_DISPLAY_LABELS[g]}`)
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  setData((p) => ({ ...p, userGender: g }))
                }}
              >
                <Text style={[styles.genderText, data.userGender === g && styles.genderTextSelected]}>
                  {GENDER_DISPLAY_LABELS[g]}
                </Text>
                {data.userGender === g && (
                  <Ionicons name="checkmark" size={20} color={colors.text.inverse} />
                )}
              </Pressable>
            ))}
          </View>
        </View>
      )
    }

    // ─── Step 1: Details ───
    if (subStep === 'details') {
      return (
        <View>
          <Text style={styles.headline}>Almost done.</Text>
          <Text style={styles.body}>Just the basics. We'll handle the rest.</Text>

          {/* Country */}
          <Text style={styles.fieldLabel}>Country</Text>
          <Pressable
            style={styles.detailsPickerButton}
            onPress={() => setShowCountryPicker(true)}
          >
            <Text style={styles.detailsPickerText}>
              {getCountryByCode(data.userCountry)?.flag ?? ''}{' '}
              {getCountryByCode(data.userCountry)?.name ?? data.userCountry}
            </Text>
            <Ionicons name="chevron-down" size={18} color={colors.text.secondary} />
          </Pressable>

          {/* Date of Birth */}
          <Text style={[styles.fieldLabel, { marginTop: spacing.lg }]}>Date of birth</Text>
          <Pressable
            style={styles.detailsPickerButton}
            onPress={() => {
              pendingBirthdayRef.current = data.userBirthday || BIRTHDAY_PICKER_DEFAULT
              setShowDatePicker(true)
            }}
          >
            <Text style={[
              styles.detailsPickerText,
              !data.userBirthday && styles.detailsPickerPlaceholder,
            ]}>
              {data.userBirthday
                ? formatBirthdayDisplay(data.userBirthday)
                : "When's your birthday?"}
            </Text>
            <Ionicons name="calendar-outline" size={18} color={colors.text.secondary} />
          </Pressable>

          {showDatePicker && Platform.OS === 'ios' && (
            <View style={styles.detailsDatePickerContainer}>
              <DateTimePicker
                value={data.userBirthday || BIRTHDAY_PICKER_DEFAULT}
                mode="date"
                display="spinner"
                maximumDate={new Date()}
                minimumDate={MIN_BIRTHDAY_DATE}
                onChange={(_, selectedDate) => {
                  if (selectedDate) {
                    pendingBirthdayRef.current = selectedDate
                  }
                }}
              />
              <Pressable
                style={styles.detailsDatePickerDone}
                onPress={() => {
                  const dateToCommit = pendingBirthdayRef.current
                  if (dateToCommit) {
                    setData((p) => ({ ...p, userBirthday: dateToCommit }))
                    pendingBirthdayRef.current = null
                  }
                  setShowDatePicker(false)
                }}
              >
                <Text style={styles.detailsDatePickerDoneText}>Done</Text>
              </Pressable>
            </View>
          )}
          {showDatePicker && Platform.OS === 'android' && (
            <DateTimePicker
              value={data.userBirthday || BIRTHDAY_PICKER_DEFAULT}
              mode="date"
              display="spinner"
              maximumDate={new Date()}
              minimumDate={MIN_BIRTHDAY_DATE}
              onChange={(event, selectedDate) => {
                setShowDatePicker(false)
                if (event.type === 'set' && selectedDate) {
                  setData((p) => ({ ...p, userBirthday: selectedDate }))
                }
              }}
            />
          )}

          {/* Preferred Language */}
          <Text style={[styles.fieldLabel, { marginTop: spacing.lg }]}>Language</Text>
          <Pressable
            style={styles.detailsPickerButton}
            onPress={() => setShowLanguagePicker(true)}
          >
            <Text style={styles.detailsPickerText}>
              {getLanguageByCode(data.userPreferredLanguage)?.nativeName ?? 'English'}
              {' '}
              <Text style={styles.detailsPickerHint}>
                ({getLanguageByCode(data.userPreferredLanguage)?.name ?? 'English'})
              </Text>
            </Text>
            <Ionicons name="chevron-down" size={18} color={colors.text.secondary} />
          </Pressable>

          {/* Country Picker Modal */}
          <CountryPickerModal
            visible={showCountryPicker}
            onClose={() => setShowCountryPicker(false)}
            onSelect={(code) => setData((p) => ({ ...p, userCountry: code }))}
            selectedCode={data.userCountry}
          />

          {/* Language Picker Modal */}
          <LanguagePickerModal
            visible={showLanguagePicker}
            onClose={() => setShowLanguagePicker(false)}
            onSelect={(code) => setData((p) => ({ ...p, userPreferredLanguage: code }))}
            selectedCode={data.userPreferredLanguage}
          />
        </View>
      )
    }

    // ─── STEP 2 ───
    if (subStep === 'value_prop') {
      const beats = [
        { icon: 'navigate-outline' as const, headline: 'Know exactly where to go.', sub: 'Stop guessing. Start going.' },
        { icon: 'people-outline' as const, headline: 'For dates, friends & solo runs.', sub: 'Plans for every kind of outing.' },
        { icon: 'flash-outline' as const, headline: 'Find it fast. Go.', sub: 'Swipe. Save. Go.' },
      ]
      const beat = beats[valuePropBeat]
      const isLightning = valuePropBeat === 2
      return (
        <View style={styles.valuePropCenter}>
          <Animated.View style={[
            styles.vpIconWrap,
            {
              opacity: vpIconOpacity,
              transform: [
                { scale: Animated.multiply(vpIconScale, vpGlowScale) },
              ],
            },
          ]}>
            <Ionicons name={beat.icon} size={64} color={colors.primary[500]} />
            {isLightning && (
              <Animated.View style={[styles.vpFlashOverlay, { opacity: vpFlashOpacity }]}>
                <Ionicons name="flash" size={64} color="#FFFFFF" />
              </Animated.View>
            )}
          </Animated.View>
          <Text style={[styles.headline, styles.textCenter]}>{beat.headline}</Text>
          <Text style={[styles.body, styles.textCenter]}>{beat.sub}</Text>
          <View style={styles.dotIndicator}>
            {beats.map((_, i) => (
              <View key={i} style={[styles.dot, i === valuePropBeat && styles.dotActive]} />
            ))}
          </View>
        </View>
      )
    }

    if (subStep === 'intents') {
      return (
        <View style={styles.intentContainer}>
          <Text style={[styles.headline, styles.textCenter, styles.intentHeadline]}>Now the fun part.</Text>
          <Text style={[styles.body, styles.textCenter, styles.intentBody]}>Tap every vibe that sounds like you.</Text>
          <View style={styles.intentGrid}>
            {ONBOARDING_INTENTS.map((intent, idx) => {
              const selected = data.selectedIntents.includes(intent.id)
              return (
                <Animated.View
                  key={intent.id}
                  style={{
                    opacity: intentAnims[idx].opacity,
                    transform: [{ scale: intentAnims[idx].scale }],
                  }}
                >
                  <Pressable
                    style={[
                      styles.intentCard,
                      selected && { backgroundColor: intent.color, borderColor: intent.color },
                    ]}
                    onPress={() => {
                      logger.action(`Intent ${selected ? 'deselected' : 'selected'}: ${intent.id}`)
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                      setData((p) => ({
                        ...p,
                        selectedIntents: p.selectedIntents.includes(intent.id)
                          ? []  // Deselect (CTA enforces min 1)
                          : [intent.id],  // Radio: replace with only this one
                      }))
                    }}
                  >
                    <Ionicons
                      name={intent.icon as any}
                      size={20}
                      color={selected ? colors.text.inverse : colors.gray[600]}
                    />
                    <Text style={[styles.intentLabel, selected && styles.intentLabelSelected]}>{intent.label}</Text>
                    <Text style={[styles.intentDesc, selected && styles.intentDescSelected]}>{intent.description}</Text>
                  </Pressable>
                </Animated.View>
              )
            })}
          </View>
          <Text style={[styles.caption, styles.textCenter]}>Pick the one that excites you most.</Text>
        </View>
      )
    }

    // ─── STEP 3 ───
    if (subStep === 'location') {
      if (locationStatus === 'granted') {
        return (
          <Pressable
            style={styles.locContainer}
            onPress={() => {
              if (autoAdvanceRef.current) { clearTimeout(autoAdvanceRef.current); autoAdvanceRef.current = null }
              goNextRef.current()
            }}
          >
            <Animated.View style={[styles.locGlassCard, { opacity: locIconAnim.opacity, transform: [{ scale: locIconAnim.scale }] }]}>
              <View style={styles.locIconCircleSuccess}>
                <Ionicons name="checkmark" size={36} color={colors.text.inverse} />
              </View>
            </Animated.View>
            <Animated.Text style={[styles.locHeadline, { opacity: locHeadlineAnim.opacity, transform: [{ translateY: locHeadlineAnim.translateY }] }]}>
              Locked in — {data.cityName}!
            </Animated.Text>
            <Text style={styles.locTapHint}>Tap to continue</Text>
          </Pressable>
        )
      }
      if (locationStatus === 'settings') {
        return (
          <View style={styles.locContainer}>
            <Animated.View style={[styles.locGlassCard, { opacity: locIconAnim.opacity, transform: [{ scale: locIconAnim.scale }, { translateY: locIconAnim.translateY }] }]}>
              <Animated.View style={[styles.locIconCircle, { transform: [{ scale: locPulse }] }]}>
                <Ionicons name="settings-outline" size={36} color={colors.primary[500]} />
              </Animated.View>
            </Animated.View>
            <Animated.Text style={[styles.locHeadline, { opacity: locHeadlineAnim.opacity, transform: [{ translateY: locHeadlineAnim.translateY }] }]}>
              One quick toggle
            </Animated.Text>
            <Animated.Text style={[styles.locBody, { opacity: locBodyAnim.opacity, transform: [{ translateY: locBodyAnim.translateY }] }]}>
              Location is off for Mingla.{'\n'}Turn it on in Settings so we can find{'\n'}the best spots near you.
            </Animated.Text>
            <Animated.View style={[{ opacity: locButtonAnim.opacity, transform: [{ scale: locButtonAnim.scale }, { translateY: locButtonAnim.translateY }] }]}>
              <Pressable
                style={styles.locGlassButton}
                onPress={() => { logger.action('Open device settings pressed'); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); Linking.openSettings() }}
              >
                <Ionicons name="settings-outline" size={20} color={colors.text.inverse} style={styles.locButtonIcon} />
                <Text style={styles.locButtonText}>Open Settings</Text>
              </Pressable>
            </Animated.View>
            <Animated.View style={[{ opacity: locButtonAnim.opacity, marginTop: spacing.md }]}>
              <Pressable
                style={[styles.locRetryButton, locationStatus === 'requesting' && styles.locGlassButtonDisabled]}
                onPress={() => { logger.action('Retry location after settings'); handleLocationRequest() }}
                disabled={locationStatus === 'requesting'}
              >
                {locationStatus === 'requesting' ? (
                  <ActivityIndicator size="small" color={colors.primary[500]} style={styles.locButtonIcon} />
                ) : (
                  <Ionicons name="refresh-outline" size={18} color={colors.primary[500]} style={styles.locButtonIcon} />
                )}
                <Text style={styles.locRetryText}>{locationStatus === 'requesting' ? 'Finding you...' : "I've turned it on — retry"}</Text>
              </Pressable>
            </Animated.View>
            <Animated.View style={[{ opacity: locButtonAnim.opacity, marginTop: spacing.sm }]}>
              <Pressable
                style={styles.locRetryButton}
                onPress={() => {
                  logger.action('Skip GPS from settings — entering city manually')
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  goNextRef.current()
                }}
              >
                <Ionicons name="create-outline" size={18} color={colors.primary[500]} style={styles.locButtonIcon} />
                <Text style={styles.locRetryText}>Type my city instead</Text>
              </Pressable>
            </Animated.View>
          </View>
        )
      }
      if (locationStatus === 'error') {
        return (
          <View style={styles.locContainer}>
            <Animated.View style={[styles.locGlassCard, { opacity: locIconAnim.opacity, transform: [{ scale: locIconAnim.scale }, { translateY: locIconAnim.translateY }] }]}>
              <Animated.View style={[styles.locIconCircle, { transform: [{ scale: locPulse }] }]}>
                <Ionicons name="cloud-offline-outline" size={36} color={colors.warning[500]} />
              </Animated.View>
            </Animated.View>
            <Animated.Text style={[styles.locHeadline, { opacity: locHeadlineAnim.opacity, transform: [{ translateY: locHeadlineAnim.translateY }] }]}>
              Couldn't get your location
            </Animated.Text>
            <Animated.Text style={[styles.locBody, { opacity: locBodyAnim.opacity, transform: [{ translateY: locBodyAnim.translateY }] }]}>
              Weak signal or GPS still warming up.{'\n'}Try again or type your city instead.
            </Animated.Text>
            <Animated.View style={[{ opacity: locButtonAnim.opacity, transform: [{ scale: locButtonAnim.scale }, { translateY: locButtonAnim.translateY }] }]}>
              <Pressable
                style={[styles.locGlassButton, locationStatus === 'requesting' && styles.locGlassButtonDisabled]}
                onPress={() => {
                  logger.action('Retry location from error state')
                  handleLocationRequest()
                }}
                disabled={locationStatus === 'requesting'}
              >
                {locationStatus === 'requesting' ? (
                  <ActivityIndicator size="small" color={colors.text.inverse} style={styles.locButtonIcon} />
                ) : (
                  <Ionicons name="refresh-outline" size={20} color={colors.text.inverse} style={styles.locButtonIcon} />
                )}
                <Text style={styles.locButtonText}>
                  {locationStatus === 'requesting' ? 'Finding you...' : 'Try Again'}
                </Text>
              </Pressable>
            </Animated.View>
            <Animated.View style={[{ opacity: locButtonAnim.opacity, marginTop: spacing.md }]}>
              <Pressable
                style={styles.locRetryButton}
                onPress={() => {
                  logger.action('Skip GPS — entering city manually')
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  goNextRef.current()
                }}
              >
                <Ionicons name="create-outline" size={18} color={colors.primary[500]} style={styles.locButtonIcon} />
                <Text style={styles.locRetryText}>Type my city instead</Text>
              </Pressable>
            </Animated.View>
          </View>
        )
      }
      // Default: idle / requesting (first-time prompt)
      return (
        <View style={styles.locContainer}>
          <Animated.View style={[styles.locGlassCard, { opacity: locIconAnim.opacity, transform: [{ scale: locIconAnim.scale }, { translateY: locIconAnim.translateY }] }]}>
            <Animated.View style={[styles.locIconCircle, { transform: [{ scale: locPulse }] }]}>
              <Ionicons name="navigate" size={36} color={colors.primary[500]} />
            </Animated.View>
          </Animated.View>
          <Animated.Text style={[styles.locHeadline, { opacity: locHeadlineAnim.opacity, transform: [{ translateY: locHeadlineAnim.translateY }] }]}>
            Better spots start here
          </Animated.Text>
          <Animated.Text style={[styles.locBody, { opacity: locBodyAnim.opacity, transform: [{ translateY: locBodyAnim.translateY }] }]}>
            Enable GPS so we can find hidden{'\n'}gems right around the corner.
          </Animated.Text>
          <Animated.View style={[{ opacity: locButtonAnim.opacity, transform: [{ scale: locButtonAnim.scale }, { translateY: locButtonAnim.translateY }] }]}>
            <Pressable
              style={[styles.locGlassButton, locationStatus !== 'idle' && styles.locGlassButtonDisabled]}
              onPress={handleLocationRequest}
              disabled={locationStatus !== 'idle'}
            >
              {locationStatus === 'requesting' ? (
                <ActivityIndicator size="small" color={colors.text.inverse} style={styles.locButtonIcon} />
              ) : (
                <Ionicons name="location" size={20} color={colors.text.inverse} style={styles.locButtonIcon} />
              )}
              <Text style={styles.locButtonText}>
                {locationStatus === 'requesting' ? 'Finding you...' : 'Enable Location'}
              </Text>
            </Pressable>
          </Animated.View>
          <Animated.View style={[{ opacity: locBodyAnim.opacity }]}>
            <View style={styles.locPrivacyRow}>
              <Ionicons name="shield-checkmark-outline" size={14} color={colors.text.tertiary} />
              <Text style={styles.locPrivacyText}>Your location stays private. Always.</Text>
            </View>
          </Animated.View>
        </View>
      )
    }

    // ─── STEP 4 ───
    if (subStep === 'celebration') {
      return (
        <View style={styles.celebrationCenter}>
          <Ionicons name="trophy-outline" size={64} color={colors.primary[500]} style={styles.stepIcon} />
          <Text style={[styles.headline, styles.textCenter]}>Look at you go.</Text>
          <Text style={[styles.body, styles.textCenter]}>Four quick picks and you're done.</Text>
        </View>
      )
    }

    if (subStep === 'manual_location') {
      return (
        <View>
          <Text style={styles.headline}>Drop your pin on the map</Text>
          <Text style={styles.body}>
            Give us your exact address — down to the street — and we'll unlock the best spots around you.
          </Text>
          <View style={styles.inputSpacing}>
            {selectedLocation ? (
              // ─── Confirmed Selection State (brand orange) ───
              <Pressable
                style={styles.locationSelectedCard}
                onPress={handleClearLocationSelection}
                accessibilityLabel="Change selected location"
                accessibilityHint="Tap to search for a different location"
              >
                <View style={styles.locationSelectedContent}>
                  <View style={styles.locationSelectedIconWrap}>
                    <Ionicons name="location" size={20} color={colors.primary[500]} />
                  </View>
                  <View style={styles.locationSelectedTextWrap}>
                    <Text style={styles.locationSelectedName} numberOfLines={1}>
                      {selectedLocation.displayName}
                    </Text>
                    {selectedLocation.fullAddress !== selectedLocation.displayName && (
                      <Text style={styles.locationSelectedAddress} numberOfLines={1}>
                        {selectedLocation.fullAddress}
                      </Text>
                    )}
                  </View>
                  <Ionicons name="checkmark-circle" size={22} color={colors.primary[500]} />
                </View>
              </Pressable>
            ) : (
              // ─── Search Input + Dropdown ───
              <View style={styles.locationSearchContainer}>
                <View style={styles.locationSearchInputWrap}>
                  <Ionicons
                    name="search-outline"
                    size={20}
                    color={colors.text.tertiary}
                  />
                  <TextInput
                    style={styles.locationSearchInput}
                    value={manualLocationText}
                    onChangeText={(text) => {
                      setManualLocationText(text)
                      if (selectedLocation) setSelectedLocation(null)
                    }}
                    placeholder="Start typing your address..."
                    placeholderTextColor={colors.gray[400]}
                    autoCapitalize="words"
                    autoCorrect={false}
                    returnKeyType="search"
                  />
                  {locationSearchLoading && (
                    <ActivityIndicator size="small" color={colors.primary[500]} style={styles.locationSearchSpinner} />
                  )}
                </View>

                {showLocationSuggestions && locationSuggestions.length > 0 && (
                  <View style={styles.locationDropdown}>
                    <ScrollView
                      style={styles.locationDropdownScroll}
                      keyboardShouldPersistTaps="handled"
                      nestedScrollEnabled
                    >
                      {locationSuggestions.map((suggestion, index) => (
                        <Pressable
                          key={suggestion.placeId || `loc-${index}`}
                          style={({ pressed }) => [
                            styles.locationSuggestionRow,
                            pressed && styles.locationSuggestionRowPressed,
                          ]}
                          onPress={() => handleSelectLocationSuggestion(suggestion)}
                        >
                          <View style={styles.locationSuggestionIconWrap}>
                            <Ionicons name="location-outline" size={20} color={colors.gray[400]} />
                          </View>
                          <View style={styles.locationSuggestionTextWrap}>
                            <Text style={styles.locationSuggestionName} numberOfLines={1}>
                              {suggestion.displayName}
                            </Text>
                            {suggestion.fullAddress !== suggestion.displayName && (
                              <Text style={styles.locationSuggestionAddress} numberOfLines={1}>
                                {suggestion.fullAddress}
                              </Text>
                            )}
                          </View>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {manualLocationText.trim().length >= 3 && !locationSearchLoading && locationHasSearched && locationSuggestions.length === 0 && (
                  <View style={styles.locationNoResults}>
                    <Ionicons name="search" size={16} color={colors.gray[400]} />
                    <Text style={styles.locationNoResultsText}>Hmm, we didn't catch that. Try a nearby street or neighborhood.</Text>
                  </View>
                )}
              </View>
            )}
          </View>
          <Text style={styles.locationHelperText}>
            The more precise, the better your recommendations.
          </Text>
          <View style={styles.locPrivacyRow}>
            <Ionicons name="shield-checkmark-outline" size={14} color={colors.text.tertiary} />
            <Text style={styles.locPrivacyText}>Your exact location stays between us. Always.</Text>
          </View>
        </View>
      )
    }

    if (subStep === 'categories') {
      return (
        <View>
          <Text style={styles.headline}>What kind of places do you love?</Text>
          <Text style={styles.body}>Pick up to 3 that match your vibe.</Text>
          <View style={styles.categoryGrid}>
            {categories.map((cat) => (
              <CategoryTile
                key={cat.slug}
                slug={cat.slug}
                name={cat.name}
                icon={cat.ux.activeColor ? getCategoryIcon(cat.slug) : 'ellipse-outline'}
                activeColor={cat.ux.activeColor}
                selected={data.selectedCategories.includes(cat.name)}
                onPress={() => {
                  const isSelected = data.selectedCategories.includes(cat.name)
                  logger.action(`Category ${isSelected ? 'deselected' : 'selected'}: ${cat.name}`)
                  setData((p) => {
                    const selected = p.selectedCategories.includes(cat.name);
                    if (selected) {
                      return { ...p, selectedCategories: p.selectedCategories.filter((c) => c !== cat.name) };
                    }
                    if (p.selectedCategories.length >= 3) {
                      setCategoryCapMessage(true);
                      setTimeout(() => setCategoryCapMessage(false), 2000);
                      return p;
                    }
                    return { ...p, selectedCategories: [...p.selectedCategories, cat.name] };
                  })
                }}
              />
            ))}
          </View>
          {categoryCapMessage && (
            <Text style={styles.selectionCapMessage}>
              Maximum 3 categories. Deselect one to choose another.
            </Text>
          )}
        </View>
      )
    }

    if (subStep === 'budget') {
      return (
        <View style={styles.budgetContainer}>
          <Text style={styles.headlineCentered}>Your sweet spot</Text>
          <Text style={styles.bodyCentered}>Pick the price ranges that work.</Text>
          <View style={styles.budgetGrid}>
            {PRICE_TIERS.map((tier) => {
              const isActive = data.selectedPriceTiers.includes(tier.slug)
              return (
                <Pressable
                  key={tier.slug}
                  style={[
                    styles.budgetTile,
                    isActive && { backgroundColor: tier.color, borderColor: tier.color },
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    setData((p) => {
                      const current = p.selectedPriceTiers
                      const next = current.includes(tier.slug)
                        ? current.filter((s) => s !== tier.slug)
                        : [...current, tier.slug]
                      if (next.length === 0) return p
                      return { ...p, selectedPriceTiers: next }
                    })
                  }}
                >
                  <Ionicons
                    name={tier.icon as any}
                    size={22}
                    color={isActive ? colors.text.inverse : colors.text.tertiary}
                    style={styles.tierIcon}
                  />
                  <Text style={[
                    styles.budgetTileLabel,
                    isActive && styles.budgetTileLabelActive,
                  ]}>
                    {tier.label}
                  </Text>
                  <Text style={[
                    styles.budgetTileRange,
                    isActive && styles.budgetTileRangeActive,
                  ]}>
                    {tier.rangeLabel}
                  </Text>
                </Pressable>
              )
            })}
          </View>

          <Text style={styles.captionCentered}>Free stuff always shows up too.</Text>
        </View>
      )
    }

    if (subStep === 'transport') {
      return (
        <View>
          <Text style={styles.headline}>How do you get around?</Text>
          <Text style={styles.body}>Helps us nail the travel times.</Text>
          <View style={styles.tileGrid}>
            {TRANSPORT_MODES.map((mode) => (
              <Pressable
                key={mode.value}
                style={[styles.selectionTile, styles.selectionTileTall, data.travelMode === mode.value && styles.selectionTileActive]}
                onPress={() => {
                  logger.action(`Transport selected: ${mode.label}`)
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  setData((p) => ({ ...p, travelMode: mode.value }))
                }}
              >
                <Ionicons
                  name={mode.icon as any}
                  size={28}
                  color={data.travelMode === mode.value ? colors.text.inverse : colors.gray[600]}
                />
                <Text style={[styles.tileLabelSm, data.travelMode === mode.value && styles.tileTextActive]}>{mode.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )
    }

    if (subStep === 'travel_time') {
      return (
        <View style={styles.travelTimeContainer}>
          <Text style={styles.headlineCentered}>How far will you go?</Text>
          <Text style={styles.bodyCentered}>Set your comfort zone.</Text>
          <View style={[styles.tileGrid, styles.tileGridCentered]}>
            {TRAVEL_TIME_PRESETS.map((mins) => (
              <Pressable
                key={mins}
                style={[
                  styles.selectionTile,
                  !showCustomTravelTime && data.travelTimeMinutes === mins && styles.selectionTileActive,
                  showCustomTravelTime && styles.selectionTileDimmed,
                ]}
                onPress={() => {
                  logger.action(`Travel time selected: ${mins} min`)
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  setShowCustomTravelTime(false)
                  setData((p) => ({ ...p, travelTimeMinutes: mins }))
                }}
              >
                <Text style={[
                  styles.tileText,
                  !showCustomTravelTime && data.travelTimeMinutes === mins && styles.tileTextActive,
                  showCustomTravelTime && styles.tileTextDimmed,
                ]}>{mins} min</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.customToggleRow}>
            <Text style={styles.customToggleLabel}>Set your own</Text>
            <Switch
              value={showCustomTravelTime}
              onValueChange={(val) => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                setShowCustomTravelTime(val)
                if (val) {
                  setCustomTravelInput(data.travelTimeMinutes.toString())
                } else {
                  // Snap back to nearest preset
                  const nearest = TRAVEL_TIME_PRESETS.reduce((prev, curr) =>
                    Math.abs(curr - data.travelTimeMinutes) < Math.abs(prev - data.travelTimeMinutes) ? curr : prev
                  )
                  setData((p) => ({ ...p, travelTimeMinutes: nearest }))
                }
              }}
              trackColor={{ false: colors.gray[200], true: colors.primary[200] }}
              thumbColor={showCustomTravelTime ? colors.primary[500] : colors.gray[50]}
            />
          </View>

          {showCustomTravelTime && (
            <View style={styles.customInputContainer}>
              <Ionicons name="time-outline" size={20} color={colors.primary[500]} style={styles.customInputIcon} />
              <TextInput
                value={customTravelInput}
                onChangeText={(text) => {
                  const numeric = text.replace(/[^0-9]/g, '')
                  setCustomTravelInput(numeric)
                  const val = Number(numeric)
                  if (val >= 5 && val <= 120) {
                    setData((p) => ({ ...p, travelTimeMinutes: val }))
                  }
                }}
                keyboardType="numeric"
                style={styles.customInputField}
                placeholder="5 – 120 minutes"
                placeholderTextColor={colors.text.tertiary}
                maxLength={3}
                onBlur={() => {
                  let val = Number(customTravelInput)
                  if (isNaN(val) || val < 5) val = 5
                  if (val > 120) val = 120
                  setCustomTravelInput(val.toString())
                  setData((p) => ({ ...p, travelTimeMinutes: val }))
                }}
              />
              <Text style={styles.customInputUnit}>min</Text>
            </View>
          )}

          <Text style={styles.captionCentered}>
            Up to {data.travelTimeMinutes} min by {data.travelMode}
          </Text>
        </View>
      )
    }

    // ─── STEP 5 ───
    if (subStep === 'friends') {
      return (
        <OnboardingFriendsStep
          userId={user!.id}
          userPhoneE164={data.phoneNumber}
          addedFriends={data.addedFriends}
          onAddFriend={(friend) => {
            setData(prev => ({
              ...prev,
              addedFriends: [...prev.addedFriends, friend],
            }))
          }}
          onRemoveFriend={(phoneE164) => {
            setData(prev => ({
              ...prev,
              addedFriends: prev.addedFriends.filter(f => f.phoneE164 !== phoneE164),
            }))
          }}
          onContinue={() => goNext()}
          onSkip={() => {
            setData(prev => ({ ...prev, skippedFriends: true }))
            setSkippedFriends(true)
            goNext()
          }}
        />
      )
    }

    if (subStep === 'consent') {
      return (
        <OnboardingConsentStep
          onConsent={() => goNext()}
          onDecline={() => goNext()}
        />
      )
    }

    if (subStep === 'collaboration') {
      return (
        <OnboardingCollaborationStep
          userId={user!.id}
          addedFriends={data.addedFriends}
          initialSessions={data.createdSessions}
          userPreferences={{
            categories: data.selectedCategories,
            priceTiers: data.selectedPriceTiers,
            intents: data.selectedIntents,
            travelMode: data.travelMode,
            travelTimeMinutes: data.travelTimeMinutes,
          }}
          onContinue={(sessions) => {
            setData(prev => ({ ...prev, createdSessions: sessions }))
            goNext()
          }}
          onSkip={() => {
            goNext()
          }}
        />
      )
    }

    if (subStep === 'pitch') {
      return (
        <View>
          <Text style={styles.headline}>Who do you have in mind?</Text>
          <Text style={styles.body}>The people you care about deserve experiences that feel personal — not generic.</Text>
          <View style={styles.pathCards}>
            <Pressable
              style={styles.pathCard}
              onPress={() => {
                logger.action('Path selected: invite')
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                setData((p) => ({ ...p, invitePath: 'invite' }))
                choosePath('invite')
              }}
            >
              <Ionicons name="heart-outline" size={24} color={colors.primary[500]} />
              <Text style={styles.pathCardTitle}>Sync with someone close</Text>
              <Text style={styles.pathCardDesc}>Best friends remember their coffee order. You'll remember the rooftop bar they'd never find alone. Link up — your recommendations learn from each other.</Text>
            </Pressable>
            <Pressable
              style={styles.pathCard}
              onPress={() => {
                logger.action('Path selected: add')
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                setData((p) => ({ ...p, invitePath: 'add' }))
                choosePath('add')
              }}
            >
              <Ionicons name="person-add-outline" size={24} color={colors.primary[500]} />
              <Text style={styles.pathCardTitle}>Add someone</Text>
              <Text style={styles.pathCardDesc}>They don't need the app. Tell us about them and we'll handle the rest.</Text>
            </Pressable>
            <Pressable
              style={styles.pathCard}
              onPress={() => {
                logger.action('Path selected: skip')
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                setData((p) => ({ ...p, invitePath: 'skip' }))
                choosePath('skip')
              }}
            >
              <Ionicons name="arrow-forward-outline" size={24} color={colors.gray[400]} />
              <Text style={styles.pathCardTitle}>Take me to the app</Text>
              <Text style={styles.pathCardDesc}>You can always add people later.</Text>
            </Pressable>
          </View>
        </View>
      )
    }

    if (subStep === 'pathA_sync') {
      return (
        <OnboardingSyncStep
          userId={user!.id}
          userPhoneE164={buildE164()}
          addedFriends={data.addedFriends}
          initialSelectedIds={data.selectedSyncFriends.map(f => f.userId || f.phoneE164)}
          onContinue={(selectedFriends, newFriends) => {
            // Clean up any previously uploaded staging audio for friends no longer selected
            const prevClips = data.audioClipsByFriend
            for (const key of Object.keys(prevClips)) {
              if (prevClips[key]?.storagePath) {
                deleteFromStorage(prevClips[key].storagePath).catch(() => {})
              }
            }
            setData(prev => ({
              ...prev,
              selectedSyncFriends: selectedFriends,
              addedFriends: [...prev.addedFriends, ...newFriends],
            }))
            setCurrentAudioFriendIndex(0)
            setAudioClipsByFriend({})
            goNext()
          }}
        />
      )
    }

    if (subStep === 'pathA_audio') {
      const friend = data.selectedSyncFriends[currentAudioFriendIndex]
      const friendKey = friend?.userId || friend?.phoneE164
      const total = data.selectedSyncFriends.length
      const current = currentAudioFriendIndex + 1

      return (
        <View>
          <Text style={styles.headline}>Tell us about {friend?.displayName || 'them'}</Text>
          <Text style={styles.body}>
            What do they love? What makes them tick?{total > 1 ? ` (${current}/${total})` : ''}
          </Text>
          <Text style={styles.caption}>
            Record at least 10 seconds. Talk like you would to a friend.
          </Text>
          <OnboardingAudioRecorder
            key={friendKey}
            initialClip={friendKey && audioClipsByFriend[friendKey] ? audioClipsByFriend[friendKey] : undefined}
            onClipReady={(uri, duration) => {
              if (!friendKey || !user?.id) return
              // Eager upload to Supabase Storage so it survives app restart
              uploadOnboardingAudio(user.id, friendKey, uri)
                .then(storagePath => {
                  setAudioClipsByFriend(prev => ({ ...prev, [friendKey]: { storagePath, duration } }))
                })
                .catch(err => {
                  console.error('[Onboarding] Eager audio upload failed — clip not saved:', err?.message)
                  // Do NOT store a clip with empty storagePath — leave button disabled so user re-records
                })
            }}
            onClipCleared={() => {
              if (!friendKey) return
              const existing = audioClipsByFriend[friendKey]
              if (existing?.storagePath) {
                deleteFromStorage(existing.storagePath).catch(() => {})
              }
              setAudioClipsByFriend(prev => {
                const next = { ...prev }
                delete next[friendKey]
                return next
              })
            }}
            minDuration={10}
          />
        </View>
      )
    }

    if (subStep === 'pathB_name') {
      return (
        <View>
          <Text style={styles.headline}>What's their name?</Text>
          <View style={styles.inputSpacing}>
            <TextInput
              style={styles.textInput}
              value={data.personName || ''}
              onChangeText={(t) => setData((p) => ({ ...p, personName: t }))}
              placeholder="First name"
              placeholderTextColor={colors.gray[400]}
              autoCapitalize="words"
              autoFocus
            />
          </View>
        </View>
      )
    }

    if (subStep === 'pathB_birthday') {
      return (
        <View>
          <Text style={styles.headline}>When's their birthday?</Text>
          <Text style={styles.body}>So we can get the vibe right.</Text>
          {Platform.OS === 'ios' ? (
            <View style={styles.datePickerContainer}>
              <DateTimePicker
                value={data.personBirthday || DEFAULT_PERSON_DATE}
                mode="date"
                display="spinner"
                minimumDate={MIN_PERSON_DATE}
                maximumDate={MAX_PERSON_DATE}
                onChange={(_, date) => {
                  if (date) {
                    pendingPersonBirthdayRef.current = date
                  }
                }}
              />
            </View>
          ) : (
            <>
              <Pressable
                style={styles.detailsPickerButton}
                onPress={() => setShowPersonDatePicker(true)}
              >
                <Text style={[
                  styles.detailsPickerText,
                  !data.personBirthday && styles.detailsPickerPlaceholder,
                ]}>
                  {data.personBirthday
                    ? formatBirthdayDisplay(data.personBirthday)
                    : 'Tap to select'}
                </Text>
                <Ionicons name="calendar-outline" size={18} color={colors.text.secondary} />
              </Pressable>
              {showPersonDatePicker && (
                <DateTimePicker
                  value={data.personBirthday || DEFAULT_PERSON_DATE}
                  mode="date"
                  display="spinner"
                  minimumDate={MIN_PERSON_DATE}
                  maximumDate={MAX_PERSON_DATE}
                  onChange={(event, date) => {
                    setShowPersonDatePicker(false)
                    if (event.type === 'set' && date) {
                      setData((p) => ({ ...p, personBirthday: date }))
                      pendingPersonBirthdayRef.current = date
                    }
                  }}
                />
              )}
            </>
          )}
        </View>
      )
    }

    if (subStep === 'pathB_gender') {
      return (
        <View>
          <Text style={styles.headline}>How do they identify?</Text>
          <Text style={styles.body}>Helps us personalize their picks.</Text>
          {GENDER_OPTIONS.map((g) => (
            <Pressable
              key={g}
              style={[styles.genderRow, data.personGender === g && styles.genderRowSelected]}
              onPress={() => {
                logger.action(`Gender selected: ${GENDER_DISPLAY_LABELS[g]}`)
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                setData((p) => ({ ...p, personGender: g }))
              }}
            >
              <Text style={[styles.genderText, data.personGender === g && styles.genderTextSelected]}>
                {GENDER_DISPLAY_LABELS[g]}
              </Text>
              {data.personGender === g && <Ionicons name="checkmark" size={20} color={colors.text.inverse} />}
            </Pressable>
          ))}
        </View>
      )
    }

    if (subStep === 'pathB_audio') {
      return (
        <View>
          <Text style={styles.headline}>Tell us about {data.personName || 'them'}</Text>
          <Text style={styles.body}>What do they love? What's their vibe?</Text>
          <Text style={styles.caption}>
            Record at least 10 seconds. Talk like you would to a friend.
          </Text>
          <OnboardingAudioRecorder
            initialClip={data.audioClipStoragePath ? { storagePath: data.audioClipStoragePath, duration: data.audioClipDuration || 0 } : undefined}
            onClipReady={(uri, duration) => {
              if (!user?.id) return
              setData((p) => ({ ...p, audioClipUri: uri, audioClipDuration: duration }))
              // Eager upload to Supabase Storage
              uploadOnboardingAudio(user.id, 'pathB', uri)
                .then(storagePath => {
                  setData((p) => ({ ...p, audioClipStoragePath: storagePath }))
                })
                .catch(err => {
                  console.error('[Onboarding] Eager pathB audio upload failed:', err?.message)
                })
            }}
            onClipCleared={() => {
              if (data.audioClipStoragePath) {
                deleteFromStorage(data.audioClipStoragePath).catch(() => {})
              }
              setData((p) => ({ ...p, audioClipUri: null, audioClipDuration: null, audioClipStoragePath: null }))
            }}
            minDuration={10}
          />
        </View>
      )
    }

    return null
  }

  // ─── Launch Screen ───
  if (isLaunch) {
    return (
      <View style={styles.launchContainer}>
        {launchState === 'loading' && (
          <View style={styles.centerContent}>
            <PulseDotLoader />
            <Text style={[styles.body, styles.launchText]}>{launchLoadingText}</Text>
          </View>
        )}
        {launchState === 'ready' && (
          <Animated.View style={[styles.centerContent, { opacity: revealOpacity, transform: [{ scale: revealScale }] }]}>
            <Text style={styles.headline}>Your picks are ready.</Text>
            <Text style={styles.body}>Swipe right to save. Left to skip.</Text>
          </Animated.View>
        )}
        {launchState === 'error' && (
          <View style={styles.centerContent}>
            <Text style={styles.body}>Having trouble loading your picks. Give it another shot.</Text>
            <Pressable style={styles.primaryButton} onPress={handleLaunchRetry}>
              <Text style={styles.primaryButtonText}>Try again</Text>
            </Pressable>
          </View>
        )}
      </View>
    )
  }

  const ctaConfig = getCtaConfig()

  return (
    <OnboardingShell
      step={navState.step}
      segmentFill={progress.segmentFill}
      showBackButton={!isFirstScreen}
      onBack={handleGoBack}
      primaryCtaLabel={ctaConfig.label}
      primaryCtaDisabled={ctaConfig.disabled}
      primaryCtaLoading={ctaConfig.loading}
      onPrimaryCta={ctaConfig.onPress}
      hidePrimaryCta={ctaConfig.hide}
      hideBottomBar={false}
      scrollEnabled={navState.subStep !== 'intents' && navState.subStep !== 'celebration' && navState.subStep !== 'budget' && navState.subStep !== 'gender_identity'}
      onBackToWelcome={isFirstScreen ? handleBackToWelcome : undefined}
    >
      {renderContent()}
    </OnboardingShell>
  )
}

// ─── Helper ───
function getCategoryIcon(slug: string): string {
  const iconMap: Record<string, string> = {
    nature: 'leaf-outline',
    first_meet: 'chatbubbles-outline',
    picnic: 'basket-outline',
    drink: 'wine-outline',
    casual_eats: 'fast-food-outline',
    fine_dining: 'restaurant-outline',
    watch: 'film-outline',
    creative_arts: 'color-palette-outline',
    play: 'game-controller-outline',
    wellness: 'body-outline',
    groceries_flowers: 'cart-outline',
    work_business: 'briefcase-outline',
  }
  return iconMap[slug] || 'ellipse-outline'
}

// ─── Styles ───
const styles = StyleSheet.create({
  consentLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectionCapMessage: {
    color: '#EF4444',
    fontSize: 13,
    textAlign: 'center' as const,
    marginTop: 8,
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.xxl,
  },
  celebrationCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valuePropCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: SCREEN_HEIGHT * 0.55,
  },
  textCenter: {
    textAlign: 'center',
  },
  // ─── Welcome Screen (Cinematic Text Reveal) ───
  welcomeGreeting: {
    ...typography.xl,
    fontWeight: fontWeights.medium,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  welcomeName: {
    fontSize: 40,
    lineHeight: 48,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    letterSpacing: -1.0,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  welcomeTaglineTop: {
    ...typography.lg,
    fontWeight: fontWeights.regular,
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  welcomeTaglineAccent: {
    ...typography.lg,
    fontWeight: fontWeights.semibold,
    color: colors.primary[500],
    textAlign: 'center',
    marginTop: 2,
  },
  headline: {
    ...typography.xxxl,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    letterSpacing: -0.5,
    marginBottom: spacing.sm,
  },
  subheadline: {
    ...typography.xl,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  body: {
    ...typography.md,
    fontWeight: fontWeights.regular,
    color: colors.text.secondary,
    marginBottom: spacing.md,
  },
  caption: {
    ...typography.sm,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    marginTop: spacing.md,
  },
  captionCentered: {
    ...typography.sm,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  headlineCentered: {
    ...typography.xxxl,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    letterSpacing: -0.5,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  bodyCentered: {
    ...typography.md,
    fontWeight: fontWeights.regular,
    color: colors.text.secondary,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  budgetContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  budgetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
    justifyContent: 'center',
    width: '100%',
  },
  budgetTile: {
    width: (SCREEN_WIDTH - 48 - 8) / 2,
    height: 84,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    backgroundColor: colors.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  budgetTileLabel: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginTop: 2,
  },
  budgetTileLabelActive: {
    color: colors.text.inverse,
  },
  budgetTileRange: {
    ...typography.xs,
    color: colors.text.tertiary,
    marginTop: 2,
  },
  budgetTileRangeActive: {
    color: colors.text.inverse,
  },
  tierIcon: {
    marginBottom: 2,
  },
  errorText: {
    ...typography.sm,
    color: colors.error[500],
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  linkText: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    color: colors.primary[500],
  },
  stepIcon: {
    marginBottom: spacing.md,
  },
  vpIconWrap: {
    marginBottom: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vpFlashOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputSpacing: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  otpContainer: {
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  resendRow: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  // ─── Value Prop Dots ───
  dotIndicator: {
    flexDirection: 'row',
    marginTop: spacing.lg,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.gray[300],
    marginHorizontal: 4,
  },
  dotActive: {
    backgroundColor: colors.primary[500],
  },
  // ─── Intent Cards ───
  intentContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  intentHeadline: {
    ...(Platform.OS === 'android' && { fontSize: 24, lineHeight: 32, marginBottom: spacing.xs }),
  },
  intentBody: {
    ...(Platform.OS === 'android' && { fontSize: 14, lineHeight: 20, marginBottom: spacing.sm }),
  },
  intentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  intentCard: {
    width: (SCREEN_WIDTH - 48 - 6) / 2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    backgroundColor: colors.background.primary,
    alignItems: 'center',
  },
  intentLabel: {
    ...typography.sm,
    ...(Platform.OS === 'android' && { fontSize: 12 }),
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginTop: spacing.xs,
  },
  intentLabelSelected: {
    color: colors.text.inverse,
  },
  intentDesc: {
    ...typography.xs,
    ...(Platform.OS === 'android' && { fontSize: 10 }),
    color: colors.text.tertiary,
    textAlign: 'center',
    marginTop: 2,
  },
  intentDescSelected: {
    color: colors.text.inverse,
  },
  // ─── Category Grid ───
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  // ─── Selection Tiles (Budget, Transport, Travel) ───
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  selectionTile: {
    width: (SCREEN_WIDTH - 48 - 8) / 2,
    height: 80,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    backgroundColor: colors.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionTileTall: {
    height: 96,
  },
  selectionTileActive: {
    backgroundColor: colors.primary[500],
    borderColor: colors.primary[600],
    ...shadows.sm,
  },
  tileText: {
    ...typography.xl,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
  },
  tileTextActive: {
    color: colors.text.inverse,
  },
  tileLabelSm: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginTop: spacing.xs,
  },
  // ─── Travel Time (Step 4) ───
  travelTimeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tileGridCentered: {
    justifyContent: 'center',
    width: '100%',
  },
  selectionTileDimmed: {
    opacity: 0.4,
    borderColor: colors.gray[200],
    backgroundColor: colors.background.secondary,
  },
  tileTextDimmed: {
    color: colors.text.tertiary,
  },
  customToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
  customToggleLabel: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    color: colors.text.secondary,
  },
  customInputIcon: {
    marginRight: spacing.sm,
  },
  customInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginTop: spacing.md,
    backgroundColor: colors.background.primary,
    borderWidth: 1.5,
    borderColor: colors.primary[300],
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  customInputField: {
    flex: 1,
    ...typography.md,
    color: colors.text.primary,
    padding: 0,
  },
  customInputUnit: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.tertiary,
    marginLeft: spacing.sm,
  },
  // ─── Path Cards (Step 5) ───
  pathCards: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  pathCard: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    backgroundColor: colors.background.primary,
  },
  pathCardTitle: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginTop: spacing.sm,
  },
  pathCardDesc: {
    ...typography.sm,
    color: colors.text.secondary,
    marginTop: spacing.xs,
  },
  // ─── Gender Rows ───
  genderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    backgroundColor: colors.background.primary,
    marginBottom: spacing.xs,
  },
  genderRowSelected: {
    backgroundColor: colors.primary[500],
    borderColor: colors.primary[600],
  },
  genderText: {
    ...typography.md,
    fontWeight: fontWeights.medium,
    color: colors.text.primary,
  },
  genderTextSelected: {
    color: colors.text.inverse,
  },
  genderListContainer: {
    marginTop: spacing.md,
  },
  // ─── Verified Phone State ───
  verifiedCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.background.primary,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#34C759',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  verifiedBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  verifiedIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#34C759',
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedBadgeText: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: '#34C759',
    letterSpacing: 0.3,
  },
  verifiedPhoneNumber: {
    ...typography.xl,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    letterSpacing: 1,
  },
  // ─── Details Screen ───
  fieldLabel: {
    ...typography.sm,
    fontWeight: fontWeights.semibold as any,
    color: colors.text.secondary,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  detailsPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background.primary,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    height: 52,
  },
  detailsPickerText: {
    ...typography.md,
    fontWeight: fontWeights.medium as any,
    color: colors.text.primary,
    flex: 1,
  },
  detailsPickerPlaceholder: {
    color: colors.text.tertiary,
  },
  detailsPickerHint: {
    ...typography.sm,
    color: colors.text.secondary,
  },
  detailsDatePickerContainer: {
    backgroundColor: colors.background.secondary,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    overflow: 'hidden' as const,
  },
  detailsDatePickerDone: {
    alignItems: 'flex-end' as const,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  detailsDatePickerDoneText: {
    ...typography.md,
    fontWeight: fontWeights.semibold as any,
    color: colors.primary[600],
  },
  // ─── Segmented Control ───
  segmentedControl: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[200],
    overflow: 'hidden',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  segmentTab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.background.primary,
  },
  segmentTabActive: {
    backgroundColor: colors.primary[500],
  },
  segmentTabText: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  segmentTabTextActive: {
    color: colors.text.inverse,
  },
  // ─── Text Input ───
  textInput: {
    height: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.gray[300],
    paddingHorizontal: spacing.lg,
    ...typography.md,
    color: colors.text.primary,
    backgroundColor: colors.background.primary,
  },
  // ─── Date Picker ───
  datePickerContainer: {
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  // ─── Location Step (Glass Morphism) ───
  locContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  locGlassCard: {
    width: 100,
    height: 100,
    backgroundColor: glass.surface.backgroundColor,
    borderColor: glass.surface.borderColor,
    borderWidth: glass.surface.borderWidth,
    borderRadius: 50,
    ...glass.shadow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  locIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary[50],
    borderWidth: 1.5,
    borderColor: colors.primary[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  locIconCircleSuccess: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.success[500],
    alignItems: 'center',
    justifyContent: 'center',
  },
  locHeadline: {
    ...typography.xxxl,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  locBody: {
    ...typography.md,
    fontWeight: fontWeights.regular,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  locTapHint: {
    ...typography.sm,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    marginTop: spacing.md,
  },
  locGlassButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 220,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.primary[500],
    shadowColor: colors.primary[500],
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 6,
  },
  locGlassButtonDisabled: {
    opacity: 0.6,
  },
  locButtonIcon: {
    marginRight: spacing.sm,
  },
  locButtonText: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
    letterSpacing: 0.3,
  },
  locRetryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 220,
    height: 48,
    backgroundColor: glass.buttonSecondary.backgroundColor,
    borderColor: glass.buttonSecondary.borderColor,
    borderWidth: glass.buttonSecondary.borderWidth,
    borderRadius: radius.lg,
  },
  locRetryText: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.primary[500],
    letterSpacing: 0.2,
  },
  locPrivacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
    gap: 6,
  },
  locPrivacyText: {
    ...typography.xs,
    fontWeight: fontWeights.medium,
    color: colors.text.tertiary,
  },
  // ─── Generic Inline Button (launch retry etc.) ───
  primaryButton: {
    minHeight: touchTargets.comfortable,
    minWidth: 200,
    borderRadius: radius.md,
    backgroundColor: colors.primary[500],
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  primaryButtonText: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
  },
  // ─── Launch ───
  launchContainer: {
    flex: 1,
    backgroundColor: backgroundWarmGlow,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  launchText: {
    marginTop: spacing.lg,
  },
  // ─── Location Autocomplete ───
  locationSearchContainer: {
    zIndex: 10,
  },
  locationSearchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.gray[300],
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.background.primary,
    gap: 12,
  },
  locationSearchInputWrapFocused: {
    borderColor: colors.primary[500],
  },
  locationSearchIcon: {},
  locationSearchInput: {
    flex: 1,
    ...typography.md,
    color: colors.text.primary,
    height: '100%' as any,
  },
  locationSearchSpinner: {
    marginLeft: spacing.sm,
  },
  locationDropdown: {
    marginTop: 6,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.gray[100],
    backgroundColor: colors.background.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 12,
    overflow: 'hidden',
    paddingVertical: spacing.sm,
  },
  locationDropdownScroll: {
    maxHeight: 280,
  },
  locationSuggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginHorizontal: spacing.sm,
    borderRadius: radius.md,
    gap: 14,
  },
  locationSuggestionRowPressed: {
    backgroundColor: colors.primary[50],
  },
  locationSuggestionBorder: {},
  locationSuggestionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.gray[50],
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  locationSuggestionIcon: {},
  locationSuggestionTextWrap: {
    flex: 1,
  },
  locationSuggestionName: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  locationSuggestionAddress: {
    ...typography.sm,
    color: colors.text.tertiary,
    marginTop: 1,
  },
  locationSelectedCard: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary[500],
    backgroundColor: colors.primary[50],
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  locationSelectedContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationSelectedIconWrap: {
    marginRight: spacing.sm,
  },
  locationSelectedTextWrap: {
    flex: 1,
    marginRight: spacing.sm,
  },
  locationSelectedName: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  locationSelectedAddress: {
    ...typography.xs,
    color: colors.text.tertiary,
    marginTop: 2,
  },
  locationNoResults: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  locationNoResultsText: {
    ...typography.sm,
    color: colors.text.tertiary,
    marginLeft: spacing.sm,
    flex: 1,
  },
  locationHelperText: {
    ...typography.xs,
    color: colors.text.tertiary,
    marginTop: spacing.md,
    textAlign: 'center',
  },
})

export default OnboardingFlow
