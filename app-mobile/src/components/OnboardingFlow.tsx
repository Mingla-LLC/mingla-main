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
} from 'react-native'
import * as Location from 'expo-location'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import DateTimePicker from '@react-native-community/datetimepicker'
import { useQueryClient } from '@tanstack/react-query'

import { useAuthSimple } from '../hooks/useAuthSimple'
import { useAppStore } from '../store/appStore'
import { useOnboardingStateMachine } from '../hooks/useOnboardingStateMachine'
import { supabase } from '../services/supabase'
import { PreferencesService } from '../services/preferencesService'
import { locationService } from '../services/locationService'
import { sendOtp, verifyOtp } from '../services/otpService'
import { logger } from '../utils/logger'
import { createSavedPerson } from '../services/savedPeopleService'
import { startRecording, stopRecording, uploadAudioClip } from '../services/personAudioService'
import { searchUsers, sendFriendLink } from '../services/friendLinkService'

import { OnboardingShell } from './onboarding/OnboardingShell'
import { PhoneInput } from './onboarding/PhoneInput'
import { OTPInput } from './onboarding/OTPInput'
import { CategoryTile } from './ui/CategoryTile'
import { OnboardingAudioRecorder } from './onboarding/OnboardingAudioRecorder'
import { PulseDotLoader } from './ui/PulseDotLoader'

import {
  OnboardingData,
  OnboardingStep,
  ONBOARDING_INTENTS,
  BUDGET_PRESETS,
  DEFAULT_BUDGET,
  TRAVEL_TIME_PRESETS,
  DEFAULT_TRAVEL_TIME,
  TRANSPORT_MODES,
  DEFAULT_TRANSPORT,
  DEFAULT_CATEGORIES,
  GENDER_OPTIONS,
  GENDER_DISPLAY_LABELS,
} from '../types/onboarding'
import { categories } from '../constants/categories'
import { getDefaultCountryCode, getCountryByCode } from '../constants/countries'
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
  backgroundWarmGlow,
  touchTargets,
  shadows,
} from '../constants/designSystem'

const { width: SCREEN_WIDTH } = Dimensions.get('window')

interface OnboardingFlowProps {
  onComplete: () => void
  onBackToWelcome?: () => void
}

const INITIAL_DATA: OnboardingData = {
  phoneNumber: '',
  phoneCountryCode: 'US',
  phoneVerified: false,
  selectedIntents: [],
  locationGranted: false,
  coordinates: null,
  cityName: null,
  useGpsLocation: false,
  manualLocation: null,
  selectedCategories: [...DEFAULT_CATEGORIES],
  budgetMax: DEFAULT_BUDGET,
  travelMode: DEFAULT_TRANSPORT,
  travelTimeMinutes: DEFAULT_TRAVEL_TIME,
  invitePath: null,
  personName: null,
  personBirthday: null,
  personGender: null,
  audioClipUri: null,
  audioClipDuration: null,
  contactMethod: null,
  contactValue: null,
}

// Extracted to its own component so the useEffect is scoped to mount/unmount
const SkipAutoAdvance = ({ goNext }: { goNext: () => void }) => {
  const hasFired = useRef(false)
  useEffect(() => {
    if (hasFired.current) return
    hasFired.current = true
    const timer = setTimeout(() => goNext(), 1000)
    return () => clearTimeout(timer)
  }, [goNext])

  return (
    <View style={styles.centerContent}>
      <Ionicons name="flash-outline" size={48} color={colors.primary[500]} />
      <Text style={styles.subheadline}>Now for the good part.</Text>
    </View>
  )
}

const OnboardingFlow = ({ onComplete, onBackToWelcome }: OnboardingFlowProps) => {
  const { user } = useAuthSimple()
  const { profile } = useAppStore()
  const queryClient = useQueryClient()

  // ─── State ───
  const [data, setData] = useState<OnboardingData>({
    ...INITIAL_DATA,
    phoneCountryCode: getDefaultCountryCode(),
  })
  const [hasGpsPermission, setHasGpsPermission] = useState(false)
  const [initialStep, setInitialStep] = useState<OnboardingStep>(1)
  const [isReady, setIsReady] = useState(false)

  // ─── State Machine ───
  const {
    state: navState,
    goNext,
    goBack,
    goToSubStep,
    choosePath,
    isFirstScreen,
    progress,
    isLaunch,
  } = useOnboardingStateMachine({ initialStep, hasGpsPermission })

  // ─── UI State ───
  const [otpCode, setOtpCode] = useState('')
  const [otpError, setOtpError] = useState(false)
  const [otpLoading, setOtpLoading] = useState(false)
  const [sendingOtp, setSendingOtp] = useState(false)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [resendCountdown, setResendCountdown] = useState(0)
  const [otpAttempts, setOtpAttempts] = useState(0)
  const [valuePropBeat, setValuePropBeat] = useState(0)
  const [locationStatus, setLocationStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied' | 'settings'>('idle')
  const [manualLocationText, setManualLocationText] = useState('')
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [contactSearchResults, setContactSearchResults] = useState<any[]>([])
  const [contactSearching, setContactSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [launchState, setLaunchState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [launchLoadingText, setLaunchLoadingText] = useState('Finding your kind of places...')
  const [launchRetries, setLaunchRetries] = useState(0)

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

  // ─── Resume Logic ───
  useEffect(() => {
    async function loadResume() {
      if (!user?.id) return
      try {
        const savedStep = profile?.onboarding_step
        if (savedStep && savedStep >= 1 && savedStep <= 5) {
          setInitialStep(savedStep as OnboardingStep)
        }
        // Load existing preferences
        const prefs = await PreferencesService.getUserPreferences(user.id)
        if (prefs) {
          setData((prev) => ({
            ...prev,
            selectedCategories: prefs.categories?.length ? prefs.categories : DEFAULT_CATEGORIES,
            budgetMax: prefs.budget_max || DEFAULT_BUDGET,
            travelMode: (prefs.travel_mode as any) || DEFAULT_TRANSPORT,
            travelTimeMinutes: prefs.travel_constraint_value || DEFAULT_TRAVEL_TIME,
            selectedIntents: (prefs as any).intents || [],
          }))
        }
      } catch (e) {
        console.error('Resume load error:', e)
      }
      setIsReady(true)
    }
    loadResume()
  }, [user?.id])

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
    if (!isPhoneValid()) {
      logger.onboarding('OTP send blocked — phone invalid')
      setPhoneError('Check that number — something looks off.')
      return
    }
    setPhoneError(null)
    setSendingOtp(true)
    const result = await sendOtp(buildE164())
    setSendingOtp(false)
    if (result.success) {
      setResendCountdown(30)
      setOtpAttempts(0)
      goNext() // advance to OTP sub-step
    } else {
      setPhoneError(result.error || "Couldn't send code. Try again.")
    }
  }, [isPhoneValid, buildE164, goNext])

  // ─── Resend OTP (does NOT advance state — used for auto-resend after 3 failures) ───
  const handleResendOtp = useCallback(async () => {
    setSendingOtp(true)
    const result = await sendOtp(buildE164())
    setSendingOtp(false)
    if (result.success) {
      setResendCountdown(30)
    }
  }, [buildE164])

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
        setData((prev) => ({ ...prev, phoneVerified: true }))
        await persistStep(2)
        setTimeout(() => goNext(), 800) // pause for success animation
      } else {
        logger.onboarding('OTP verification failed', { attempts: otpAttempts + 1 })
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
    [buildE164, goNext, persistStep, otpAttempts, handleResendOtp]
  )

  // ─── Location Permission ───
  const handleLocationRequest = useCallback(async () => {
    logger.action('Location permission requested')
    setLocationStatus('requesting')
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
      logger.onboarding('Location: permission denied')
      setLocationStatus('denied')
      setHasGpsPermission(false)
      setData((prev) => ({ ...prev, locationGranted: false, useGpsLocation: false }))
      await persistStep(4)
      goNext()
    }
  }, [goNext, persistStep])

  const captureLocation = useCallback(async () => {
    try {
      const loc = await locationService.getCurrentLocation()
      if (loc) {
        const geo = await Location.reverseGeocodeAsync({
          latitude: loc.latitude,
          longitude: loc.longitude,
        })
        const city = geo[0]?.city || geo[0]?.region || 'your area'
        setData((prev) => ({
          ...prev,
          locationGranted: true,
          coordinates: { lat: loc.latitude, lng: loc.longitude },
          cityName: city,
          useGpsLocation: true,
        }))
        setHasGpsPermission(true)
        setLocationStatus('granted')
        logger.onboarding('Location captured', { city, lat: loc.latitude, lng: loc.longitude })
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        await persistStep(4)
        setTimeout(() => goNext(), 1200) // show confirmation briefly
      }
    } catch (e) {
      console.error('Location capture error:', e)
      setLocationStatus('denied')
    }
  }, [goNext, persistStep])

  const handleSkipLocation = useCallback(async () => {
    setLocationStatus('denied')
    setHasGpsPermission(false)
    setData((prev) => ({ ...prev, locationGranted: false, useGpsLocation: false }))
    await persistStep(4)
    goNext()
  }, [goNext, persistStep])

  // ─── Manual Location Geocode ───
  const handleManualLocation = useCallback(async () => {
    if (!manualLocationText.trim()) return
    setSavingPrefs(true)
    try {
      const results = await Location.geocodeAsync(manualLocationText.trim())
      if (results.length > 0) {
        setData((prev) => ({
          ...prev,
          manualLocation: manualLocationText.trim(),
          coordinates: { lat: results[0].latitude, lng: results[0].longitude },
        }))
        goNext()
      }
    } catch (e) {
      console.error('Geocode error:', e)
    }
    setSavingPrefs(false)
  }, [manualLocationText, goNext])

  // ─── Save Preferences (Step 4 → 5 transition) ───
  const handleSavePreferences = useCallback(async () => {
    if (!user?.id) return
    logger.action('Save preferences pressed', { categories: data.selectedCategories.length, budget: data.budget, transport: data.transportMode })
    setSavingPrefs(true)
    try {
      await PreferencesService.updateUserPreferences(user.id, {
        intents: data.selectedIntents,
        categories: data.selectedCategories,
        budget_min: 0,
        budget_max: data.budgetMax,
        travel_mode: data.travelMode,
        travel_constraint_type: 'time',
        travel_constraint_value: data.travelTimeMinutes,
        datetime_pref: new Date().toISOString(),
        date_option: 'now',
        use_gps_location: data.useGpsLocation,
        custom_location: data.manualLocation,
      } as any)

      await persistStep(5)

      // Fire-and-forget card generation
      const coords = data.coordinates
      if (coords) {
        queryClient.prefetchQuery({
          queryKey: ['onboarding-cards'],
          queryFn: async () => {
            const { data: cards, error } = await supabase.functions.invoke('discover-cards', {
              body: {
                categories: data.selectedCategories,
                location: coords,
                budgetMax: data.budgetMax,
                travelMode: data.travelMode,
                travelConstraintType: 'time',
                travelConstraintValue: data.travelTimeMinutes,
                datetimePref: new Date().toISOString(),
                dateOption: 'now',
                timeSlot: null,
                batchSeed: 0,
                limit: 20,
              },
            })
            if (error) throw error
            return cards
          },
          staleTime: 10 * 60 * 1000,
        })
      }

      goNext()
    } catch (e) {
      console.error('Preferences save error:', e)
    }
    setSavingPrefs(false)
  }, [user?.id, data, goNext, persistStep, queryClient])

  // ─── Step 5 Save Person ───
  const handleSavePerson = useCallback(async () => {
    if (!user?.id) return
    logger.action('Save person pressed')
    setSaving(true)
    try {
      const personData: any = {
        user_id: user.id,
        name: data.personName || 'Friend',
        initials: (data.personName || 'F').slice(0, 2).toUpperCase(),
        birthday: data.personBirthday?.toISOString().split('T')[0] || null,
        gender: data.personGender,
      }
      const person = await createSavedPerson(personData)

      if (data.audioClipUri && person?.id) {
        await uploadAudioClip(
          user.id,
          person.id,
          data.audioClipUri,
          `onboarding_${Date.now()}.m4a`,
          data.audioClipDuration || 0,
          0
        )
      }

      if (data.invitePath === 'invite' && data.contactValue) {
        if (data.contactMethod === 'username') {
          const results = await searchUsers(data.contactValue)
          if (results.length > 0) {
            await sendFriendLink(results[0].id)
          }
        }
      }
    } catch (e) {
      console.error('Save person error:', e)
    }
    setSaving(false)
    goNext()
  }, [user?.id, data, goNext])

  // ─── Launch Handler ───
  const handleLaunch = useCallback(async () => {
    if (!user?.id) return
    logger.onboarding('Launch sequence started')
    // Mark complete
    try {
      await supabase.from('profiles').update({ has_completed_onboarding: true, onboarding_step: 0 }).eq('id', user.id)
      useAppStore.getState().setProfile({ ...profile, has_completed_onboarding: true, onboarding_step: 0 } as any)
    } catch (e) {
      console.error('Launch complete error:', e)
    }

    // Check for cards
    const cachedCards = queryClient.getQueryData(['onboarding-cards'])
    if (cachedCards) {
      setLaunchState('ready')
      playRevealAnimation()
      return
    }

    // Wait for cards with rotating text
    const loadingTexts = ['Finding your kind of places...', 'Curating your city...', 'Almost there...']
    let textIdx = 0
    const textInterval = setInterval(() => {
      textIdx = (textIdx + 1) % loadingTexts.length
      setLaunchLoadingText(loadingTexts[textIdx])
    }, 1500)

    // Poll for cards (max 5s)
    const startTime = Date.now()
    const pollInterval = setInterval(() => {
      const cards = queryClient.getQueryData(['onboarding-cards'])
      if (cards) {
        clearInterval(pollInterval)
        clearInterval(textInterval)
        setLaunchState('ready')
        playRevealAnimation()
        return
      }
      if (Date.now() - startTime > 5000) {
        clearInterval(pollInterval)
        clearInterval(textInterval)
        if (launchRetries < 2) {
          setLaunchState('error')
        } else {
          // After 2 retries, just proceed
          setLaunchState('ready')
          playRevealAnimation()
        }
      }
    }, 500)

    return () => {
      clearInterval(pollInterval)
      clearInterval(textInterval)
    }
  }, [user?.id, profile, queryClient, launchRetries])

  const playRevealAnimation = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    Animated.parallel([
      Animated.spring(revealScale, { toValue: 1, tension: 80, friction: 10, useNativeDriver: true }),
      Animated.timing(revealOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start()
    setTimeout(() => onComplete(), 1500)
  }, [onComplete, revealScale, revealOpacity])

  const handleLaunchRetry = useCallback(() => {
    setLaunchRetries((r) => r + 1)
    setLaunchState('loading')
    handleLaunch()
  }, [handleLaunch])

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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    goBack()
  }, [goBack])

  const handleBackToWelcome = useCallback(async () => {
    logger.action('Back to welcome — signing out')
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    await supabase.auth.signOut()
  }, [])

  // ─── CTA Config ───
  const getCtaConfig = useCallback(() => {
    const { step, subStep } = navState

    switch (subStep) {
      case 'welcome':
        return { label: "Let's go", disabled: false, loading: false, onPress: handleGoNext, hide: false }
      case 'phone':
        return { label: 'Send code', disabled: !isPhoneValid(), loading: sendingOtp, onPress: handleSendOtp, hide: false }
      case 'otp':
        return { label: 'Verify', disabled: otpCode.length < 6, loading: otpLoading, onPress: () => handleVerifyOtp(otpCode), hide: false }
      case 'value_prop':
        return { label: 'Next', disabled: false, loading: false, onPress: () => { setValuePropBeat(Math.min(valuePropBeat + 1, 2)); if (valuePropBeat >= 2) handleGoNext() }, hide: false }
      case 'intents':
        return { label: 'Next', disabled: data.selectedIntents.length === 0, loading: false, onPress: async () => { await persistStep(3); handleGoNext() }, hide: false }
      case 'location':
        return { label: 'Enable location', disabled: false, loading: locationStatus === 'requesting', onPress: handleLocationRequest, hide: true }
      case 'celebration':
        return { label: 'Next', disabled: false, loading: false, onPress: handleGoNext, hide: false }
      case 'manual_location':
        return { label: 'Next', disabled: !manualLocationText.trim(), loading: savingPrefs, onPress: handleManualLocation, hide: false }
      case 'categories':
        return { label: 'Next', disabled: data.selectedCategories.length === 0, loading: false, onPress: handleGoNext, hide: false }
      case 'budget':
        return { label: 'Next', disabled: false, loading: false, onPress: handleGoNext, hide: false }
      case 'transport':
        return { label: 'Next', disabled: false, loading: false, onPress: handleGoNext, hide: false }
      case 'travel_time':
        return { label: 'Next', disabled: false, loading: savingPrefs, onPress: handleSavePreferences, hide: false }
      case 'pitch':
        return { label: '', disabled: true, loading: false, onPress: () => {}, hide: true }
      case 'pathA_birthday':
      case 'pathB_birthday':
        return { label: 'Next', disabled: !data.personBirthday, loading: false, onPress: handleGoNext, hide: false }
      case 'pathA_gender':
      case 'pathB_gender':
        return { label: 'Next', disabled: !data.personGender, loading: false, onPress: handleGoNext, hide: false }
      case 'pathA_audio':
      case 'pathB_audio':
        return { label: 'Next', disabled: false, loading: false, onPress: handleGoNext, hide: false }
      case 'pathA_contact':
        return { label: 'Send invite', disabled: !data.contactValue, loading: saving, onPress: handleSavePerson, hide: false }
      case 'pathB_name':
        return { label: 'Next', disabled: !data.personName?.trim(), loading: false, onPress: handleGoNext, hide: false }
      case 'skip':
        return { label: '', disabled: true, loading: false, onPress: () => {}, hide: true }
      default:
        return { label: 'Next', disabled: false, loading: false, onPress: handleGoNext, hide: false }
    }
  }, [navState, data, otpCode, otpLoading, sendingOtp, isPhoneValid, valuePropBeat, locationStatus, manualLocationText, savingPrefs, saving, handleGoNext, handleSendOtp, handleVerifyOtp, handleLocationRequest, handleManualLocation, handleSavePreferences, handleSavePerson, persistStep])

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
      return (
        <View style={styles.centerContent}>
          <Ionicons name={beat.icon} size={64} color={colors.primary[500]} style={styles.stepIcon} />
          <Text style={styles.headline}>{beat.headline}</Text>
          <Text style={styles.body}>{beat.sub}</Text>
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
        <View>
          <Text style={styles.headline}>What are you into?</Text>
          <Text style={styles.body}>Pick all that fit.</Text>
          <View style={styles.intentGrid}>
            {ONBOARDING_INTENTS.map((intent) => {
              const selected = data.selectedIntents.includes(intent.id)
              return (
                <Pressable
                  key={intent.id}
                  style={[styles.intentCard, selected && styles.intentCardSelected]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    setData((p) => ({
                      ...p,
                      selectedIntents: selected
                        ? p.selectedIntents.filter((i) => i !== intent.id)
                        : [...p.selectedIntents, intent.id],
                    }))
                  }}
                >
                  <Ionicons
                    name={intent.icon as any}
                    size={24}
                    color={selected ? colors.text.inverse : colors.primary[500]}
                  />
                  <Text style={[styles.intentLabel, selected && styles.intentLabelSelected]}>{intent.label}</Text>
                  <Text style={[styles.intentDesc, selected && styles.intentDescSelected]}>{intent.description}</Text>
                </Pressable>
              )
            })}
          </View>
          <Text style={styles.caption}>You can always change these later.</Text>
        </View>
      )
    }

    // ─── STEP 3 ───
    if (subStep === 'location') {
      if (locationStatus === 'granted') {
        return (
          <View style={styles.centerContent}>
            <Ionicons name="checkmark-circle" size={64} color={colors.success[500]} />
            <Text style={styles.headline}>Locked in — {data.cityName}!</Text>
          </View>
        )
      }
      if (locationStatus === 'settings') {
        return (
          <View style={styles.centerContent}>
            <Ionicons name="location-outline" size={64} color={colors.primary[500]} />
            <Text style={styles.headline}>Better spots start here</Text>
            <Text style={styles.body}>Location is turned off for Mingla. Tap below to fix it.</Text>
            <Pressable style={styles.primaryButton} onPress={() => Linking.openSettings()}>
              <Text style={styles.primaryButtonText}>Open settings</Text>
            </Pressable>
            <Pressable onPress={handleSkipLocation}>
              <Text style={styles.linkText}>I'll set it manually</Text>
            </Pressable>
          </View>
        )
      }
      return (
        <View style={styles.centerContent}>
          <Ionicons name="location-outline" size={64} color={colors.primary[500]} />
          <Text style={styles.headline}>Better spots start here</Text>
          <Text style={styles.body}>Share your location and we'll find gems nearby.</Text>
          <Pressable style={styles.primaryButton} onPress={handleLocationRequest}>
            <Text style={styles.primaryButtonText}>Enable location</Text>
          </Pressable>
          <Pressable onPress={handleSkipLocation}>
            <Text style={styles.linkText}>I'll set it manually</Text>
          </Pressable>
        </View>
      )
    }

    // ─── STEP 4 ───
    if (subStep === 'celebration') {
      return (
        <View style={styles.centerContent}>
          <Ionicons name="trophy-outline" size={64} color={colors.primary[500]} style={styles.stepIcon} />
          <Text style={styles.headline}>Look at you go.</Text>
          <Text style={styles.body}>Four quick picks and you're done.</Text>
        </View>
      )
    }

    if (subStep === 'manual_location') {
      return (
        <View>
          <Text style={styles.headline}>Where are you based?</Text>
          <Text style={styles.body}>Type your city so we can find places nearby.</Text>
          <View style={styles.inputSpacing}>
            <TextInput
              style={styles.textInput}
              value={manualLocationText}
              onChangeText={setManualLocationText}
              placeholder="e.g., San Francisco"
              placeholderTextColor={colors.gray[400]}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={handleManualLocation}
            />
          </View>
        </View>
      )
    }

    if (subStep === 'categories') {
      return (
        <View>
          <Text style={styles.headline}>What kind of places do you love?</Text>
          <Text style={styles.body}>Pick as many as you want.</Text>
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
                  setData((p) => ({
                    ...p,
                    selectedCategories: p.selectedCategories.includes(cat.name)
                      ? p.selectedCategories.filter((c) => c !== cat.name)
                      : [...p.selectedCategories, cat.name],
                  }))
                }}
              />
            ))}
          </View>
        </View>
      )
    }

    if (subStep === 'budget') {
      return (
        <View>
          <Text style={styles.headline}>What's your sweet spot?</Text>
          <Text style={styles.body}>How much per outing, roughly?</Text>
          <View style={styles.tileGrid}>
            {BUDGET_PRESETS.map((amount) => (
              <Pressable
                key={amount}
                style={[styles.selectionTile, data.budgetMax === amount && styles.selectionTileActive]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  setData((p) => ({ ...p, budgetMax: amount }))
                }}
              >
                <Text style={[styles.tileText, data.budgetMax === amount && styles.tileTextActive]}>${amount}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.caption}>Free stuff always shows up too.</Text>
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
        <View>
          <Text style={styles.headline}>How far will you go?</Text>
          <Text style={styles.body}>Set your comfort zone.</Text>
          <View style={styles.tileGrid}>
            {TRAVEL_TIME_PRESETS.map((mins) => (
              <Pressable
                key={mins}
                style={[styles.selectionTile, data.travelTimeMinutes === mins && styles.selectionTileActive]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  setData((p) => ({ ...p, travelTimeMinutes: mins }))
                }}
              >
                <Text style={[styles.tileText, data.travelTimeMinutes === mins && styles.tileTextActive]}>{mins} min</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.caption}>Up to {data.travelTimeMinutes} min by {data.travelMode}</Text>
        </View>
      )
    }

    // ─── STEP 5 ───
    if (subStep === 'pitch') {
      return (
        <View>
          <Text style={styles.headline}>Got someone in mind?</Text>
          <Text style={styles.body}>Add a friend, partner, or date — we'll find places you'll both love.</Text>
          <View style={styles.pathCards}>
            <Pressable style={styles.pathCard} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setData((p) => ({ ...p, invitePath: 'invite' })); choosePath('invite') }}>
              <Ionicons name="paper-plane-outline" size={24} color={colors.primary[500]} />
              <Text style={styles.pathCardTitle}>Invite them to Mingla</Text>
              <Text style={styles.pathCardDesc}>They get their own account. Recs get smarter together.</Text>
            </Pressable>
            <Pressable style={styles.pathCard} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setData((p) => ({ ...p, invitePath: 'add' })); choosePath('add') }}>
              <Ionicons name="person-add-outline" size={24} color={colors.primary[500]} />
              <Text style={styles.pathCardTitle}>Just add them</Text>
              <Text style={styles.pathCardDesc}>We'll factor them in. No invite needed.</Text>
            </Pressable>
            <Pressable style={styles.pathCard} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setData((p) => ({ ...p, invitePath: 'skip' })); choosePath('skip') }}>
              <Ionicons name="arrow-forward-outline" size={24} color={colors.gray[400]} />
              <Text style={styles.pathCardTitle}>Skip for now</Text>
              <Text style={styles.pathCardDesc}>You can add people anytime.</Text>
            </Pressable>
          </View>
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

    if (subStep === 'pathA_birthday' || subStep === 'pathB_birthday') {
      const defaultDate = new Date()
      defaultDate.setFullYear(defaultDate.getFullYear() - 25)
      const minDate = new Date()
      minDate.setFullYear(minDate.getFullYear() - 100)
      const maxDate = new Date()
      maxDate.setFullYear(maxDate.getFullYear() - 13)

      return (
        <View>
          <Text style={styles.headline}>When's their birthday?</Text>
          <Text style={styles.body}>So we can get the vibe right.</Text>
          <View style={styles.datePickerContainer}>
            <DateTimePicker
              value={data.personBirthday || defaultDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              minimumDate={minDate}
              maximumDate={maxDate}
              onChange={(_, date) => {
                if (date) setData((p) => ({ ...p, personBirthday: date }))
              }}
            />
          </View>
        </View>
      )
    }

    if (subStep === 'pathA_gender' || subStep === 'pathB_gender') {
      return (
        <View>
          <Text style={styles.headline}>How do they identify?</Text>
          <Text style={styles.body}>Helps us personalize their picks.</Text>
          {GENDER_OPTIONS.map((g) => (
            <Pressable
              key={g}
              style={[styles.genderRow, data.personGender === g && styles.genderRowSelected]}
              onPress={() => {
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

    if (subStep === 'pathA_audio' || subStep === 'pathB_audio') {
      return (
        <View>
          <Text style={styles.headline}>Tell us about them</Text>
          <Text style={styles.body}>Record a voice note — what do they love? What's their vibe?</Text>
          <Text style={styles.caption}>Up to 60 seconds. Talk like you would to a friend.</Text>
          <OnboardingAudioRecorder
            onClipReady={(uri, duration) => setData((p) => ({ ...p, audioClipUri: uri, audioClipDuration: duration }))}
            onSkip={handleGoNext}
          />
        </View>
      )
    }

    if (subStep === 'pathA_contact') {
      return (
        <View>
          <Text style={styles.headline}>How should we reach them?</Text>
          <View style={styles.segmentedControl}>
            <Pressable
              style={[styles.segmentTab, data.contactMethod === 'phone' && styles.segmentTabActive]}
              onPress={() => setData((p) => ({ ...p, contactMethod: 'phone', contactValue: null }))}
            >
              <Text style={[styles.segmentTabText, data.contactMethod === 'phone' && styles.segmentTabTextActive]}>Phone</Text>
            </Pressable>
            <Pressable
              style={[styles.segmentTab, data.contactMethod === 'username' && styles.segmentTabActive]}
              onPress={() => setData((p) => ({ ...p, contactMethod: 'username', contactValue: null }))}
            >
              <Text style={[styles.segmentTabText, data.contactMethod === 'username' && styles.segmentTabTextActive]}>Username</Text>
            </Pressable>
          </View>
          {data.contactMethod === 'phone' && (
            <TextInput
              style={[styles.textInput, styles.inputSpacing]}
              keyboardType="phone-pad"
              placeholder="Their phone number"
              placeholderTextColor={colors.gray[400]}
              value={data.contactValue || ''}
              onChangeText={(t) => setData((p) => ({ ...p, contactValue: t }))}
            />
          )}
          {data.contactMethod === 'username' && (
            <TextInput
              style={[styles.textInput, styles.inputSpacing]}
              placeholder="Search Mingla"
              placeholderTextColor={colors.gray[400]}
              value={data.contactValue || ''}
              onChangeText={(t) => setData((p) => ({ ...p, contactValue: t }))}
              autoCapitalize="none"
            />
          )}
        </View>
      )
    }

    if (subStep === 'skip') {
      return <SkipAutoAdvance goNext={goNext} />
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

  if (!isReady) return null

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
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.xxl,
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
    marginTop: spacing.sm,
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
  intentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  intentCard: {
    width: (SCREEN_WIDTH - 48 - 8) / 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    backgroundColor: colors.background.primary,
    alignItems: 'center',
  },
  intentCardSelected: {
    backgroundColor: colors.primary[500],
    borderColor: colors.primary[600],
  },
  intentLabel: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginTop: spacing.xs,
  },
  intentLabelSelected: {
    color: colors.text.inverse,
  },
  intentDesc: {
    ...typography.xs,
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
    height: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    backgroundColor: colors.background.primary,
    marginBottom: spacing.sm,
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
  // ─── Primary Button (inline, for Location step) ───
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
})

export default OnboardingFlow
