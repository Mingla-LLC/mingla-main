import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
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
  Alert,
} from 'react-native'
import * as Location from 'expo-location'
import * as Haptics from 'expo-haptics'
import { Icon } from './ui/Icon'
// WhatsAppLogo: available from './ui/BrandIcons' if needed for OTP channel UI
import DateTimePicker from '@react-native-community/datetimepicker'
import { useQueryClient } from '@tanstack/react-query'

import { useAppStore } from '../store/appStore'
import { useOnboardingStateMachine } from '../hooks/useOnboardingStateMachine'
import { supabase } from '../services/supabase'
import { PreferencesService } from '../services/preferencesService'
import { locationService } from '../services/locationService'
import { throttledReverseGeocode, clearGeocodeCache } from '../utils/throttledGeocode'
import { geocodingService } from '../services/geocodingService'
import { sendOtp, verifyOtp, OtpChannel } from '../services/otpService'
import { logger } from '../utils/logger'
import { saveOnboardingData, clearOnboardingData } from '../utils/onboardingPersistence'
import { detectLocaleFromCoordinates, detectLocaleFromCountryName } from '../utils/localeDetection'

// Legacy saved_people + audio services removed — pairing uses real behavior data.
import { getCurrencySymbol, formatNumberWithCommas } from '../utils/currency'
import { getRate } from '../services/currencyService'
import { deckService, DeckResponse } from '../services/deckService'
import { buildDeckQueryKey } from '../hooks/useDeckCards'
import { normalizeCategoryArray } from '../utils/categoryUtils'
import { normalizeDateTime } from '../utils/cardConverters'
import { withTimeout } from '../utils/withTimeout'
import { logAppsFlyerEvent } from '../services/appsFlyerService'
import { mixpanelService } from '../services/mixpanelService'

import { OnboardingShell } from './onboarding/OnboardingShell'
import { PhoneInput } from './onboarding/PhoneInput'
import { OTPInput } from './onboarding/OTPInput'
import { OnboardingCollaborationStep } from './onboarding/OnboardingCollaborationStep'
import { CategoryTile } from './ui/CategoryTile'
import { OnboardingFriendsAndPairingStep } from './onboarding/OnboardingFriendsAndPairingStep'
import { OnboardingConsentStep } from './onboarding/OnboardingConsentStep'
import { Checkbox } from './ui/checkbox'
import InAppBrowserModal from './InAppBrowserModal'
import { LEGAL_URLS } from '../constants/urls'
import { useFriends } from '../hooks/useFriends'
import { FriendRequest } from '../services/friendsService'
// processPersonAudio removed — pairing uses real behavior data
// PulseDotLoader removed — launch animation now in GettingExperiencesScreen

import {
  OnboardingData,
  OnboardingStep,
  SubStep,
  ONBOARDING_INTENTS,
  TRAVEL_TIME_PRESETS,
  DEFAULT_TRAVEL_TIME,
  TRANSPORT_MODES,
  DEFAULT_TRANSPORT,
  DEFAULT_CATEGORIES,
  GENDER_OPTIONS,
  GENDER_DISPLAY_LABELS,
} from '../types/onboarding'
import { categories } from '../constants/categories'
import { getCountryByCode } from '../constants/countries'
import { getDefaultLanguageCode, getLanguageByCode } from '../constants/languages'
import { CountryPickerModal } from './onboarding/CountryPickerModal'
import { LanguageSelectionStep } from './onboarding/LanguageSelectionStep'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { persistLanguage } from '../i18n'
import { getCurrencyByCountryCode, getMeasurementSystem } from '../services/countryCurrencyService'
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

/** Intent vibe cards: two columns with gap 6, horizontal padding 24+24 from OnboardingShell */
const INTENT_CARD_WIDTH = (SCREEN_WIDTH - 48 - 6) / 2

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

// ─── Getting Experiences Screen (Step 7b) ───

interface GettingExperiencesScreenProps {
  userId: string
  data: OnboardingData
  warmPoolPromiseRef: React.MutableRefObject<Promise<void> | null>
  onComplete: () => void
}

// Loading messages are now fetched via i18n in GettingExperiencesScreen
const LOADING_MESSAGE_KEYS = [
  'getting_experiences.loading_1',
  'getting_experiences.loading_2',
  'getting_experiences.loading_3',
  'getting_experiences.loading_4',
] as const

const GettingExperiencesScreen: React.FC<GettingExperiencesScreenProps> = ({
  userId,
  data,
  warmPoolPromiseRef,
  onComplete,
}) => {
  const { t: tOnboarding } = useTranslation('onboarding')
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [messageIndex, setMessageIndex] = useState(0)
  const [retryCount, setRetryCount] = useState(0)

  // Animations
  const compassRotation = useRef(new Animated.Value(0)).current
  const glowOpacity = useRef(new Animated.Value(0.4)).current
  const progressWidth = useRef(new Animated.Value(0)).current
  const messageOpacity = useRef(new Animated.Value(1)).current
  const phase1Opacity = useRef(new Animated.Value(1)).current
  const phase2Opacity = useRef(new Animated.Value(0)).current
  const phase2TranslateY = useRef(new Animated.Value(16)).current
  const checkScale = useRef(new Animated.Value(0)).current
  const ctaOpacity = useRef(new Animated.Value(0)).current
  const ctaTranslateY = useRef(new Animated.Value(16)).current

  // Spinning compass animation
  useEffect(() => {
    if (phase !== 'loading') return
    const spin = Animated.loop(
      Animated.timing(compassRotation, {
        toValue: 1,
        duration: 2000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    )
    spin.start()
    return () => spin.stop()
  }, [phase, compassRotation])

  // Glow pulse
  useEffect(() => {
    if (phase !== 'loading') return
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(glowOpacity, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(glowOpacity, { toValue: 0.4, duration: 750, useNativeDriver: true }),
      ])
    )
    pulse.start()
    return () => pulse.stop()
  }, [phase, glowOpacity])

  // Message cycling
  useEffect(() => {
    if (phase !== 'loading') return
    const interval = setInterval(() => {
      Animated.timing(messageOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        setMessageIndex(prev => (prev + 1) % LOADING_MESSAGE_KEYS.length)
        Animated.timing(messageOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start()
      })
    }, 1200)
    return () => clearInterval(interval)
  }, [phase, messageOpacity])

  // Main loading + launch logic
  useEffect(() => {
    let cancelled = false

    const run = async () => {
      // Enforce minimum 2500ms display time
      const minTimer = new Promise<void>(r => setTimeout(r, 2500))

      // Progress bar animation (runs for ~3s)
      Animated.timing(progressWidth, {
        toValue: 1,
        duration: 3000,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start()

      try {
        // Warm all edge functions in parallel with the animation.
        // The 3s animation provides ample time for isolates to spin up.
        supabase.functions.invoke('keep-warm').catch(() => {});

        // Mark onboarding complete — check response for errors
        const { error: updateError } = await supabase.from('profiles').update({
          has_completed_onboarding: true,
          onboarding_step: 0,
          gender: data.userGender,
          birthday: data.userBirthday?.toISOString().split('T')[0] || null,
          country: data.userCountry,
          preferred_language: data.userPreferredLanguage,
        }).eq('id', userId)

        if (updateError) throw updateError

        // ── Analytics: onboarding complete + trial start ──
        logAppsFlyerEvent('af_tutorial_completion', {
          af_success: true,
          af_content: 'onboarding',
          gender: data.userGender || '',
          country: data.userCountry || '',
        })
        logAppsFlyerEvent('af_start_trial', {
          af_trial_type: 'elite_7day',
          af_duration: 7,
        })
        mixpanelService.trackTrialStarted({ trial_duration_days: 7 })
        mixpanelService.trackOnboardingStepCompleted(7, {
          substep: 'getting_experiences',
        })
        mixpanelService.trackOnboardingCompleted({
          gender: data.userGender || '',
          country: data.userCountry || '',
        })
        mixpanelService.setUserProperties({
          onboarding_completed: true,
          onboarding_completed_at: new Date().toISOString(),
          country: data.userCountry || '',
          gender: data.userGender || '',
          language: data.userPreferredLanguage || 'en',
        })
        mixpanelService.setUserPropertyOnce({
          onboarding_completed_at: new Date().toISOString(),
        })

        // Only clear persistence AFTER DB confirms success
        await clearOnboardingData()

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
          const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000))
          await Promise.race([warmPoolPromiseRef.current, timeout])
        }

        await minTimer
        if (cancelled) return

        // Race progress to 100%
        Animated.timing(progressWidth, {
          toValue: 1,
          duration: 300,
          useNativeDriver: false,
        }).start()

        // Transition to Phase 2
        setTimeout(() => {
          if (cancelled) return
          // Fade out Phase 1
          Animated.timing(phase1Opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start()

          setTimeout(() => {
            if (cancelled) return
            setPhase('ready')

            // Fade in Phase 2
            Animated.parallel([
              Animated.timing(phase2Opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
              Animated.timing(phase2TranslateY, { toValue: 0, duration: 500, useNativeDriver: true }),
            ]).start()

            // Spring checkmark
            Animated.spring(checkScale, { toValue: 1, tension: 200, friction: 12, useNativeDriver: true }).start()

            // Haptic
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)

            // CTA slides up after delay
            setTimeout(() => {
              if (cancelled) return
              Animated.parallel([
                Animated.timing(ctaOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
                Animated.timing(ctaTranslateY, { toValue: 0, duration: 250, useNativeDriver: true }),
              ]).start()
            }, 300)
          }, 200) // 200ms pause between phases
        }, 300) // After progress bar races
      } catch (err) {
        logger.error('GettingExperiences launch error', { error: String(err) })
        await minTimer
        if (cancelled) return
        setPhase('error')
      }
    }

    run()
    return () => { cancelled = true }
  }, [retryCount]) // eslint-disable-line react-hooks/exhaustive-deps

  const spinInterpolation = compassRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  })

  const handleRetry = () => {
    setPhase('loading')
    setMessageIndex(0)
    progressWidth.setValue(0)
    phase1Opacity.setValue(1)
    phase2Opacity.setValue(0)
    phase2TranslateY.setValue(16)
    checkScale.setValue(0)
    ctaOpacity.setValue(0)
    ctaTranslateY.setValue(16)
    setRetryCount(r => r + 1)
  }

  return (
    <View style={getExpStyles.container}>
      {/* Phase 1: Loading */}
      {phase === 'loading' && (
        <Animated.View style={[getExpStyles.phaseContainer, { opacity: phase1Opacity }]}>
          {/* Glow circle + compass */}
          <View style={getExpStyles.iconContainer}>
            <Animated.View style={[getExpStyles.glowCircle, { opacity: glowOpacity }]} />
            <Animated.View style={{ transform: [{ rotate: spinInterpolation }] }}>
              <Icon name="compass-outline" size={48} color={colors.primary[500]} />
            </Animated.View>
          </View>

          <Text style={getExpStyles.headline}>Building your deck...</Text>

          {/* Progress bar */}
          <View style={getExpStyles.progressTrack}>
            <Animated.View
              style={[
                getExpStyles.progressFill,
                {
                  width: progressWidth.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                },
              ]}
            />
          </View>

          <Animated.Text style={[getExpStyles.statusMessage, { opacity: messageOpacity }]}>
            {tOnboarding(LOADING_MESSAGE_KEYS[messageIndex])}
          </Animated.Text>
        </Animated.View>
      )}

      {/* Phase 2: Ready */}
      {phase === 'ready' && (
        <Animated.View
          style={[
            getExpStyles.phaseContainer,
            { opacity: phase2Opacity, transform: [{ translateY: phase2TranslateY }] },
          ]}
        >
          {/* Success icon with glow */}
          <View style={getExpStyles.iconContainer}>
            <View style={getExpStyles.successGlow} />
            <Animated.View style={{ transform: [{ scale: checkScale }] }}>
              <Icon name="checkmark-circle" size={48} color={colors.success[500]} />
            </Animated.View>
          </View>

          <Text style={getExpStyles.headline}>Your deck is ready</Text>
          <Text style={getExpStyles.subtitle}>
            Swipe through, save what you love, skip what you don't.
          </Text>

          <Animated.View
            style={[
              getExpStyles.ctaContainer,
              { opacity: ctaOpacity, transform: [{ translateY: ctaTranslateY }] },
            ]}
          >
            <Pressable
              style={getExpStyles.ctaButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
                onComplete()
              }}
            >
              <Text style={getExpStyles.ctaText}>Let's go</Text>
            </Pressable>
          </Animated.View>
        </Animated.View>
      )}

      {/* Phase 3: Error */}
      {phase === 'error' && (
        <View style={getExpStyles.phaseContainer}>
          <View style={getExpStyles.iconContainer}>
            <View style={getExpStyles.errorGlow} />
            <Icon name="alert-circle" size={48} color={colors.error[400]} />
          </View>

          <Text style={getExpStyles.headline}>Something went wrong</Text>
          <Text style={getExpStyles.subtitle}>
            We couldn't load your picks. Let's try again.
          </Text>

          <View style={getExpStyles.ctaContainer}>
            <Pressable
              style={getExpStyles.ctaButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
                handleRetry()
              }}
            >
              <Text style={getExpStyles.ctaText}>Try again</Text>
            </Pressable>
            <Pressable
              style={getExpStyles.skipErrorButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                // Proceed immediately — user exits onboarding instantly
                onComplete()

                // Best-effort: mark onboarding complete in background
                withTimeout(
                  supabase.from('profiles').update({
                    has_completed_onboarding: true,
                    onboarding_step: 0,
                    gender: data.userGender,
                    birthday: data.userBirthday?.toISOString().split('T')[0] || null,
                    country: data.userCountry,
                    preferred_language: data.userPreferredLanguage,
                  }).eq('id', userId),
                  5000,
                  'skipOnboarding'
                )
                  .then(({ error: skipError }) => {
                    if (skipError) {
                      console.warn('[OnboardingFlow] Skip profile update failed:', skipError)
                      return
                    }
                    clearOnboardingData()
                    const currentProfile = useAppStore.getState().profile
                    if (currentProfile) {
                      useAppStore.getState().setProfile({
                        ...currentProfile,
                        has_completed_onboarding: true,
                        onboarding_step: 0,
                      })
                    }
                  })
                  .catch((e) => {
                    console.warn('[OnboardingFlow] Skip onboarding background update failed:', e)
                  })
              }}
            >
              <Text style={getExpStyles.skipErrorText}>Skip for now</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  )
}

const getExpStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  phaseContainer: {
    alignItems: 'center',
    width: '100%',
  },
  iconContainer: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  glowCircle: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primary[50],
  },
  successGlow: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.success[50],
  },
  errorGlow: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.error[50] ?? '#fef2f2',
  },
  headline: {
    ...typography.xxl,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.md,
    fontWeight: fontWeights.regular,
    color: colors.gray[500],
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  progressTrack: {
    width: 200,
    height: 4,
    backgroundColor: colors.gray[200],
    borderRadius: radius.full,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  progressFill: {
    height: 4,
    backgroundColor: colors.primary[500],
    borderRadius: radius.full,
  },
  statusMessage: {
    ...typography.sm,
    fontWeight: fontWeights.regular,
    color: colors.gray[500],
    textAlign: 'center',
  },
  ctaContainer: {
    width: '100%',
    marginTop: spacing.xxl,
  },
  ctaButton: {
    backgroundColor: colors.primary[500],
    borderRadius: radius.lg,
    height: 56,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  ctaText: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
  },
  skipErrorButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  skipErrorText: {
    ...typography.md,
    fontWeight: fontWeights.medium,
    color: colors.text.tertiary,
  },
})

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
  const { t } = useTranslation(['onboarding', 'common'])

  // ─── Friends (for incoming request UI in Step 5/friends) ───
  const {
    friendRequests,
    acceptFriendRequest,
    declineFriendRequest,
    loadFriendRequests,
  } = useFriends({ autoFetchBlockedUsers: false })

  const incomingPendingRequests = useMemo(
    () => (friendRequests || []).filter(
      (req: FriendRequest) => req.type === 'incoming' && req.status === 'pending'
    ),
    [friendRequests]
  )

  // ─── State ───
  const [data, setData] = useState<OnboardingData>(initialData)
  const [hasGpsPermission, setHasGpsPermission] = useState(initialHasGpsPermission)

  // ─── State Machine ───
  const {
    state: navState,
    goNext,
    goBack,
    goToSubStep,
    progress,
    isLaunch,
  } = useOnboardingStateMachine({ initialStep, hasGpsPermission })


  // isFirstScreen: true when the user is at the earliest screen where "Back to sign in"
  // should appear. For phone-pre-verified users, this is Step 2/value_prop (their starting
  // point) OR Step 1/welcome (where they end up if they navigate backwards past Step 2).
  // The OR condition ensures pre-verified users who navigate backwards are never trapped
  // without a sign-out path.
  const isFirstScreen = phonePreVerified
    ? (navState.step === 2 && navState.subStep === 'value_prop') ||
      (navState.step === 1 && navState.subStep === 'language')
    : (navState.step === 1 && navState.subStep === 'language')

  // ── Analytics: track each onboarding sub-step transition ──
  const prevSubStepRef = useRef(navState.subStep)
  const prevStepRef = useRef(navState.step)
  useEffect(() => {
    if (navState.step !== prevStepRef.current) {
      // The user moved to a new step — the PREVIOUS step is completed
      logAppsFlyerEvent('onboarding_step_completed', {
        step: prevStepRef.current,
        step_name: `Step ${prevStepRef.current}`,
        substep: prevSubStepRef.current,
      })
      mixpanelService.trackOnboardingStepCompleted(prevStepRef.current, {
        substep: prevSubStepRef.current,
      })
      mixpanelService.trackOnboardingStepViewed(navState.step)
      prevStepRef.current = navState.step
      prevSubStepRef.current = navState.subStep
    } else if (navState.subStep !== prevSubStepRef.current) {
      // Sub-step changed within same step — track the sub-step transition
      prevSubStepRef.current = navState.subStep
    }
  }, [navState.step, navState.subStep])

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

  // ─── Deferred TextInput Focus ───
  // autoFocus on a TextInput inside a scrollEnabled={false} ScrollView causes a
  // native crash on iOS Fabric (New Architecture). iOS tries to scroll the focused
  // field into view, but the disabled ScrollView can't scroll → native exception.
  // Fix: focus manually after the native view hierarchy has fully committed.
  useEffect(() => {
    if (navState.subStep === 'welcome' && !(data.firstName || '').trim()) {
      const timer = setTimeout(() => {
        firstNameRef.current?.focus()
      }, 400)
      return () => clearTimeout(timer)
    }
  }, [navState.subStep]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── UI State ───
  const [otpCode, setOtpCode] = useState('')
  const [otpError, setOtpError] = useState(false)
  const [otpLoading, setOtpLoading] = useState(false)
  const [sendingOtp, setSendingOtp] = useState(false)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [smsConsentChecked, setSmsConsentChecked] = useState(false)
  const [legalBrowserUrl, setLegalBrowserUrl] = useState('')
  const [legalBrowserTitle, setLegalBrowserTitle] = useState('')
  const [legalBrowserVisible, setLegalBrowserVisible] = useState(false)
  const [resendCountdown, setResendCountdown] = useState(0)
  const [otpAttempts, setOtpAttempts] = useState(0)
  const [activeChannel, setActiveChannel] = useState<OtpChannel>('sms')
  const [channelConfirmation, setChannelConfirmation] = useState<string | null>(null)
  const [showChannelOptions, setShowChannelOptions] = useState(false)
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
  const [prefsSaveError, setPrefsSaveError] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  // saving state removed — save handlers (Path A/B) deleted
  const [showCountryPicker, setShowCountryPicker] = useState(false)
  const [showCustomTravelTime, setShowCustomTravelTime] = useState(false)
  const [customTravelInput, setCustomTravelInput] = useState('')
  const warmPoolPromiseRef = useRef<Promise<void> | null>(null)

  // Pending date for the Step 1 birthday picker.
  // Holds the in-progress date while the user is scrolling.
  // Only committed to `data` when the "Done" button is pressed.
  const pendingBirthdayRef = useRef<Date | null>(null)

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
      setShowDatePicker(false)
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
  // revealScale + revealOpacity removed — launch animation now in GettingExperiencesScreen

  // ─── Welcome Screen Animations (4-phase text reveal) ───
  const heyAnim = useRef({ opacity: new Animated.Value(0), translateY: new Animated.Value(20) }).current
  const nameAnim = useRef({ opacity: new Animated.Value(0), translateY: new Animated.Value(30), scale: new Animated.Value(0.92) }).current
  const tagTopAnim = useRef({ opacity: new Animated.Value(0), translateY: new Animated.Value(15) }).current
  const tagAccentAnim = useRef({ opacity: new Animated.Value(0), translateY: new Animated.Value(15) }).current
  const welcomeAnimRan = useRef(false)
  const firstNameRef = useRef<TextInput>(null)
  const lastNameRef = useRef<TextInput>(null)

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
    const timer = setTimeout(() => setResendCountdown((prev) => {
      if (prev <= 1) {
        setShowChannelOptions(true)
        return 0
      }
      return prev - 1
    }), 1000)
    return () => clearTimeout(timer)
  }, [resendCountdown])

  // ─── Value Prop Auto-Advance ───
  useEffect(() => {
    if (navState.subStep !== 'value_prop') return
    if (valuePropBeat >= 2) return
    const timer = setTimeout(() => setValuePropBeat((b) => b + 1), 3000)
    return () => clearTimeout(timer)
  }, [navState.subStep, valuePropBeat])

  // Launch logic is now triggered from the getting_experiences substep, not via isLaunch flag

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
      setActiveChannel('sms')
      setChannelConfirmation(null)
      setShowChannelOptions(false)
      setResendCountdown(30)
      setOtpAttempts(0)
      goNext() // advance to OTP sub-step
    } else {
      setPhoneError(result.error || "Couldn't send code. Try again.")
    }
  }, [isPhoneValid, buildE164, goNext, data.phoneVerified, goToSubStep])

  // ─── Resend OTP via Channel (replaces old SMS-only handleResendOtp) ───
  const handleResendViaChannel = useCallback(async (channel: OtpChannel) => {
    logger.action(`Resend OTP via ${channel}`)
    setSendingOtp(true)
    setChannelConfirmation(null)
    const result = await sendOtp(buildE164(), channel)
    setSendingOtp(false)
    if (result.success) {
      // Server confirmed phone is already verified — skip OTP, mark verified
      if (result.status === 'already_verified') {
        logger.onboarding('Server says phone already verified on resend — skipping OTP')
        setData((prev) => ({ ...prev, phoneVerified: true }))
        goToSubStep('gender_identity')
        return
      }
      setActiveChannel(channel)
      setShowChannelOptions(false)
      setResendCountdown(30)
      switch (channel) {
        case 'sms':
          setChannelConfirmation('Code re-sent via SMS')
          break
        case 'whatsapp':
          setChannelConfirmation('Code sent via WhatsApp')
          break
        case 'call':
          setChannelConfirmation('Calling you now...')
          break
      }
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
      // Rate limit — hide channel options, show error
      if (result.error?.includes('Too many attempts')) {
        setShowChannelOptions(false)
      }
      setPhoneError(result.error || "Couldn't send code. Try again.")
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      goToSubStep('phone')
    }
  }, [buildE164, goToSubStep])

  // Thin wrapper for backward compat (auto-resend references)
  const handleResendOtp = useCallback(() => {
    handleResendViaChannel('sms')
  }, [handleResendViaChannel])

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
          // Show channel picker instead of auto-resending SMS
          setOtpCode('')
          setOtpAttempts(0)
          setShowChannelOptions(true)
        }
      }
    },
    [buildE164, goNext, otpAttempts, goToSubStep]
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
    logger.action('Save preferences pressed', { categories: data.selectedCategories.length, transport: data.travelMode })
    setSavingPrefs(true)
    setPrefsSaveError(false)
    try {
      await withTimeout(
        PreferencesService.updateUserPreferences(user.id, {
          intents: data.selectedIntents,
          categories: data.selectedCategories,
          travel_mode: data.travelMode,
          travel_constraint_type: 'time',
          travel_constraint_value: data.travelTimeMinutes,
          datetime_pref: new Date().toISOString(),
          date_option: 'this_weekend',
          selected_dates: data.selectedDates?.length > 0 ? data.selectedDates : null,
          use_gps_location: data.useGpsLocation,
          custom_location: data.manualLocation,
          intent_toggle: true,
          category_toggle: true,
        } as any),
        8000,
        'saveOnboardingPreferences'
      )

      // ORCH-0443: Collab prefs backfill removed. Seeding happens at acceptance time
      // via seedCollabPrefsFromSolo. Deck generator has solo fallback as defense-in-depth.

      persistStep(5).catch(() => {})

      // ── Pre-seed React Query caches (ORCH-0386) ────────────────────────
      // Pre-seed the userPreferences cache so RecommendationsContext doesn't
      // re-fetch from DB after onboarding transition (~200ms saved).
      const datetimePref = new Date().toISOString()
      queryClient.setQueryData(['userPreferences', user.id], {
        categories: data.selectedCategories,
        intents: data.selectedIntents,
        travel_mode: data.travelMode,
        travel_constraint_type: 'time',
        travel_constraint_value: data.travelTimeMinutes,
        datetime_pref: datetimePref,
        date_option: 'this_weekend',
        use_gps_location: data.useGpsLocation,
        custom_location: data.manualLocation,
        custom_lat: data.coordinates?.lat ?? null,
        custom_lng: data.coordinates?.lng ?? null,
        intent_toggle: true,
        category_toggle: true,
        selected_dates: data.selectedDates?.length > 0 ? data.selectedDates : null,
      })

      // ── Real deck prefetch (replaces dead warmDeckPool no-op) ──────────
      // Fire the actual deck fetch NOW (end of Step 4). User will spend
      // 25-100s on Steps 5-7a (friends, collabs, consent) — plenty of time
      // for this to complete. On success, pre-seeds the React Query cache so
      // useDeckCards finds data on first mount and renders instantly.
      // On failure, the catch logs and continues — post-transition cold fetch
      // still works as fallback (zero regression risk).
      const coords = data.coordinates
      if (coords) {
        // Apply identical normalization as RecommendationsContext stableDeckParams
        const normalizedCategories = normalizeCategoryArray(data.selectedCategories)
        const normalizedIntents = data.selectedIntents ?? []

        // Build the exact query key useDeckCards will look for post-transition
        const deckQueryKey = buildDeckQueryKey({
          lat: coords.lat,
          lng: coords.lng,
          categories: normalizedCategories,
          intents: normalizedIntents,
          travelMode: data.travelMode,
          travelConstraintType: 'time',
          travelConstraintValue: data.travelTimeMinutes,
          datetimePref,
          dateOption: 'this_weekend',
          batchSeed: 0,
          excludeCardIds: [],
        })

        const prefetchPromise = deckService.fetchDeck({
          location: coords,
          categories: normalizedCategories,
          intents: normalizedIntents,
          travelMode: data.travelMode,
          travelConstraintType: 'time' as const,
          travelConstraintValue: data.travelTimeMinutes,
          datetimePref,
          dateOption: 'this_weekend',
          batchSeed: 0,
          limit: 200,
          excludeCardIds: [],
        }).then((result: DeckResponse) => {
          // Guard: don't cache empty results — likely auth failure, not genuine empty pool.
          // The normal post-transition useDeckCards flow will retry with valid token. ORCH-0387.
          if (result.cards.length === 0) {
            if (__DEV__) console.warn('[Onboarding] Deck prefetch returned 0 cards — skipping cache (possible auth failure)')
            return
          }
          // Pre-seed the deck-cards cache with the exact key useDeckCards uses
          queryClient.setQueryData(deckQueryKey, result)
          if (__DEV__) {
            console.log(`[Onboarding] Deck prefetch complete: ${result.cards.length} cards cached`)
          }
        }).catch((err: unknown) => {
          // Non-blocking — cold fetch will work as fallback post-transition
          console.warn('[Onboarding] Deck prefetch failed (will retry post-transition):', err)
        })

        // Store promise for GettingExperiencesScreen readiness check
        warmPoolPromiseRef.current = prefetchPromise
      }

      goNext()
    } catch (e) {
      console.error('Preferences save error:', e)
      setPrefsSaveError(true)
    }
    setSavingPrefs(false)
  }, [user?.id, data, goNext, persistStep, queryClient])

  // ─── Country Change Handler (details substep) ───
  const handleCountryChange = useCallback((newCountryCode: string) => {
    const currencyInfo = getCurrencyByCountryCode(newCountryCode)
    const newCurrency = currencyInfo?.currencyCode ?? 'USD'
    const newSymbol = currencyInfo?.currencySymbol ?? '$'
    const newMeasurement = getMeasurementSystem(newCountryCode)
    const countryName = getCountryByCode(newCountryCode)?.name ?? newCountryCode

    Alert.alert(
      'Update settings?',
      `Switching to ${countryName} will set your currency to ${newCurrency} (${newSymbol}) and units to ${newMeasurement}. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: () => {
            setData(p => ({
              ...p,
              userCountry: newCountryCode,
            }))
          },
        },
      ]
    )
  }, [])

  // ─── Save Identity & Details (Step 1 gender_identity + details → Step 2 transition) ───
  const handleSaveIdentity = useCallback(async () => {
    if (!user?.id) return
    logger.action('Save identity pressed', {
      gender: data.userGender,
      country: data.userCountry,
      language: data.userPreferredLanguage,
      hasBirthday: !!data.userBirthday,
    })

    // Derive currency and measurement from country selection
    const derivedCurrency = getCurrencyByCountryCode(data.userCountry)?.currencyCode ?? 'USD'
    const derivedMeasurement = getMeasurementSystem(data.userCountry)

    // Fire-and-forget profile save — do NOT block navigation
    PreferencesService.updateUserProfile(user.id, {
      gender: data.userGender,
      birthday: data.userBirthday?.toISOString().split('T')[0] || null,
      country: data.userCountry,
      preferred_language: data.userPreferredLanguage,
      currency: derivedCurrency,
      measurement_system: derivedMeasurement,
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
          currency: derivedCurrency,
          measurement_system: derivedMeasurement,
        })
      }
    }).catch((err) => {
      console.warn('[Onboarding] Identity save failed:', err?.message)
      // Non-blocking — user continues onboarding. Data will be re-saved at launch if needed.
    })

    persistStep(2).catch(() => {})
    goNext()
  }, [user?.id, data.userGender, data.userBirthday, data.userCountry, data.userPreferredLanguage, goNext, persistStep])

  // Launch animation + handler now lives in GettingExperiencesScreen (Step 7b)

  // ─── Welcome Text Entrance Animation ───
  // CRITICAL: Only run when Phase 2 (Animated.Text greeting) is rendered.
  // Phase 1 (name collection) uses regular Text/TextInput — the animated values
  // aren't attached to any native view. On iOS Fabric, starting useNativeDriver
  // animations on detached nodes throws a native ObjC exception → SIGABRT crash.
  const hasNameForGreeting = !!(data.firstName || '').trim() && data.phoneVerified
  useEffect(() => {
    if (navState.subStep !== 'welcome' || welcomeAnimRan.current) return
    if (!hasNameForGreeting) return  // Phase 1 — no Animated.Text in tree, skip
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
  }, [navState.subStep, hasNameForGreeting])

  // ─── Step-Level Nav Handlers ───
  const handleGoNext = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    goNext()
  }, [goNext])

  const handleSaveName = useCallback(async () => {
    if (!user?.id) return;
    const first = data.firstName.trim();
    const last = data.lastName.trim();

    logger.action('Save name pressed', { firstName: first, lastName: last });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Fire-and-forget profile update — do NOT block navigation
    PreferencesService.updateUserProfile(user.id, {
      first_name: first,
      last_name: last,
      display_name: `${first} ${last}`.trim(),
    }).then(() => {
      const currentProfile = useAppStore.getState().profile;
      if (currentProfile) {
        useAppStore.getState().setProfile({
          ...currentProfile,
          first_name: first,
          last_name: last,
          display_name: `${first} ${last}`.trim(),
        });
      }
    }).catch((err) => {
      console.warn('[Onboarding] Name save failed:', err?.message);
    });

    goNext();
  }, [user?.id, data.firstName, data.lastName, goNext]);

  const handleGoBack = useCallback(() => {
    // Clear any pending auto-advance timeout (prevents ghost navigation from location step)
    if (autoAdvanceRef.current) {
      clearTimeout(autoAdvanceRef.current)
      autoAdvanceRef.current = null
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    mixpanelService.trackOnboardingStepBack(navState.step)

    // Skip OTP step when navigating back if phone is already verified
    // (user shouldn't land on "Enter the code" screen when already verified)
    if (data.phoneVerified && navState.subStep === 'gender_identity') {
      goToSubStep('phone')
      return
    }

    goBack()
  }, [goBack, goToSubStep, data.phoneVerified, navState.subStep])

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
      case 'language':
        return { label: t('common:continue'), disabled: false, loading: false, onPress: handleGoNext, hide: false }
      case 'welcome': {
        const nameReady = data.firstName.trim().length > 0 && data.lastName.trim().length > 0;
        return { label: t('common:lets_go'), disabled: !nameReady, loading: false, onPress: handleSaveName, hide: false }
      }
      case 'phone':
        return data.phoneVerified
          ? { label: t('common:continue'), disabled: false, loading: false, onPress: () => goToSubStep('gender_identity'), hide: false }
          : { label: t('onboarding:phone.cta_send_code'), disabled: !isPhoneValid() || !smsConsentChecked, loading: sendingOtp, onPress: handleSendOtp, hide: false }
      case 'otp':
        return { label: t('onboarding:otp.cta_verify'), disabled: otpCode.length < 6, loading: otpLoading, onPress: () => handleVerifyOtp(otpCode), hide: true }
      case 'gender_identity':
        return { label: t('common:next'), disabled: !data.userGender, loading: false, onPress: handleGoNext, hide: false }
      case 'details':
        return { label: t('common:lets_go'), disabled: !data.userBirthday, loading: false, onPress: handleSaveIdentity, hide: false }
      case 'value_prop':
        return { label: t('common:next'), disabled: false, loading: false, onPress: () => { logger.action(`Value prop beat advance`, { beat: valuePropBeat }); setValuePropBeat(Math.min(valuePropBeat + 1, 2)); if (valuePropBeat >= 2) handleGoNext() }, hide: false }
      case 'intents':
        return { label: t('common:next'), disabled: data.selectedIntents.length === 0, loading: false, onPress: () => {
          persistStep(3).catch(() => {})
          handleGoNext()
        }, hide: false }
      case 'location':
        return { label: t('onboarding:location.cta_enable'), disabled: locationStatus === 'requesting', loading: locationStatus === 'requesting', onPress: handleLocationRequest, hide: true }
      case 'celebration':
        return { label: t('common:next'), disabled: false, loading: false, onPress: handleGoNext, hide: false }
      case 'categories':
        return { label: t('common:next'), disabled: data.selectedCategories.length === 0, loading: false, onPress: () => {
          handleGoNext()
        }, hide: false }
      case 'transport':
        return { label: t('common:next'), disabled: false, loading: false, onPress: () => {
          handleGoNext()
        }, hide: false }
      case 'travel_time':
        return { label: prefsSaveError ? t('common:retry') : t('common:next'), disabled: false, loading: savingPrefs, onPress: handleSavePreferences, hide: false }
      case 'friends_and_pairing':
        return {
          label: t('common:continue'),
          disabled: false,
          loading: false,
          onPress: () => goNext(),
          hide: false,
        }
      case 'collaborations': {
        const hasActed = data.createdSessions.length > 0 || data.collabActionTaken
        return {
          label: hasActed ? t('common:continue') : t('common:ill_do_this_later'),
          disabled: false,
          loading: false,
          onPress: () => goNext(),
          hide: false,
        }
      }
      case 'consent':
        return { label: t('common:sounds_good_lets_go'), disabled: false, loading: false, onPress: () => goNext(), hide: false }
      case 'getting_experiences':
        // Full-screen takeover, no shell CTA
        return { label: '', disabled: true, loading: false, onPress: () => {}, hide: true }
      default:
        return { label: t('common:next'), disabled: false, loading: false, onPress: handleGoNext, hide: false }
    }
  }, [navState, data, otpCode, otpLoading, sendingOtp, isPhoneValid, smsConsentChecked, valuePropBeat, locationStatus, selectedLocation, savingPrefs, prefsSaveError, handleGoNext, handleSendOtp, handleVerifyOtp, handleLocationRequest, handleManualLocation, handleSavePreferences, handleSaveIdentity, persistStep, goToSubStep])

  // ─── Render Step Content ───
  const renderContent = () => {
    const { step, subStep } = navState
    logger.onboarding(`Rendering: Step ${step} / ${subStep}`)

    // ─── STEP 1 ───
    if (subStep === 'language') {
      return (
        <LanguageSelectionStep
          selectedCode={data.userPreferredLanguage}
          onSelect={(code: string) => {
            setData((p) => ({ ...p, userPreferredLanguage: code }))
            i18n.changeLanguage(code)
            persistLanguage(code)
          }}
        />
      )
    }

    if (subStep === 'welcome') {
      const hasName = (data.firstName || '').trim().length > 0;

      if (hasName && data.phoneVerified) {
        // Phase 2: Personalized greeting (returning to this step)
        return (
          <View style={styles.centerContent}>
            <Animated.Text
              style={[styles.welcomeGreeting, { opacity: heyAnim.opacity, transform: [{ translateY: heyAnim.translateY }] }]}
            >
              {t('onboarding:welcome.greeting_hey')}
            </Animated.Text>
            <Animated.Text
              style={[styles.welcomeName, { opacity: nameAnim.opacity, transform: [{ translateY: nameAnim.translateY }, { scale: nameAnim.scale }] }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {t('onboarding:welcome.greeting_name', { name: data.firstName.trim() })}
            </Animated.Text>
            <Animated.Text
              style={[styles.welcomeTaglineTop, { opacity: tagTopAnim.opacity, transform: [{ translateY: tagTopAnim.translateY }] }]}
            >
              {t('onboarding:welcome.greeting_good_taste')}
            </Animated.Text>
            <Animated.Text
              style={[styles.welcomeTaglineAccent, { opacity: tagAccentAnim.opacity, transform: [{ translateY: tagAccentAnim.translateY }] }]}
            >
              {t('onboarding:welcome.greeting_walked_in')}
            </Animated.Text>
          </View>
        );
      }

      // Phase 1: Name collection — minimal, centered, modern
      return (
        <View style={styles.nameCollectionContainer}>
          <Text style={styles.nameGreeting}>{t('onboarding:welcome.we_know')}</Text>
          <Text style={styles.nameGreetingAccent}>{t('onboarding:welcome.good_taste')}</Text>
          <Text style={styles.nameGreeting}>{t('onboarding:welcome.just_walked_in')}</Text>
          <Text style={styles.namePrompt}>{t('onboarding:welcome.name_prompt')}</Text>

          <View style={styles.nameInputRow}>
            <TextInput
              ref={firstNameRef}
              style={styles.nameInput}
              placeholder={t('onboarding:welcome.placeholder_first')}
              placeholderTextColor={colors.gray[300]}
              value={data.firstName}
              onChangeText={(text) => setData((p) => ({ ...p, firstName: text }))}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="next"
              onSubmitEditing={() => lastNameRef.current?.focus()}
              textAlign="center"
            />
            <TextInput
              ref={lastNameRef}
              style={styles.nameInput}
              placeholder={t('onboarding:welcome.placeholder_last')}
              placeholderTextColor={colors.gray[300]}
              value={data.lastName}
              onChangeText={(text) => setData((p) => ({ ...p, lastName: text }))}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              textAlign="center"
            />
          </View>
        </View>
      );
    }

    if (subStep === 'phone') {
      // If phone is already verified (user navigated back or resumed), show verified state
      if (data.phoneVerified) {
        // Use profile.phone (persisted E.164) as primary source, fall back to buildE164()
        // for same-session verification where profile may not have refreshed yet
        const displayPhone = profile?.phone || buildE164()
        return (
          <View>
            <Text style={styles.headline}>{t('onboarding:phone.verified_headline')}</Text>
            <Text style={styles.body}>{t('onboarding:phone.verified_body')}</Text>
            <View style={styles.verifiedCard}>
              <View style={styles.verifiedBadgeRow}>
                <View style={styles.verifiedIconCircle}>
                  <Icon name="checkmark" size={16} color="#fff" />
                </View>
                <Text style={styles.verifiedBadgeText}>{t('common:verified')}</Text>
              </View>
              <Text style={styles.verifiedPhoneNumber}>{displayPhone}</Text>
            </View>
          </View>
        )
      }

      return (
        <View>
          <Text style={styles.headline}>{t('onboarding:phone.headline')}</Text>
          <Text style={styles.body}>{t('onboarding:phone.body')}</Text>
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
          <Pressable
            style={styles.consentRow}
            onPress={() => setSmsConsentChecked(prev => !prev)}
            accessibilityRole="checkbox"
            accessibilityLabel={t('onboarding:phone.consent_accessibility')}
            accessibilityState={{ checked: smsConsentChecked }}
          >
            <Checkbox
              checked={smsConsentChecked}
              onCheckedChange={setSmsConsentChecked}
              size="md"
              style={styles.consentCheckbox}
            />
            <Text style={styles.consentText}>
              {t('onboarding:phone.consent_text')}
              <Text
                style={styles.consentLink}
                onPress={() => {
                  setLegalBrowserUrl(LEGAL_URLS.termsOfService)
                  setLegalBrowserTitle(t('onboarding:phone.terms_of_service'))
                  setLegalBrowserVisible(true)
                }}
                accessibilityRole="link"
                accessibilityLabel={t('onboarding:phone.terms_of_service')}
              >
                {t('onboarding:phone.terms_of_service')}
              </Text>
              {t('onboarding:phone.and')}
              <Text
                style={styles.consentLink}
                onPress={() => {
                  setLegalBrowserUrl(LEGAL_URLS.privacyPolicy)
                  setLegalBrowserTitle(t('onboarding:phone.privacy_policy'))
                  setLegalBrowserVisible(true)
                }}
                accessibilityRole="link"
                accessibilityLabel={t('onboarding:phone.privacy_policy')}
              >
                {t('onboarding:phone.privacy_policy')}
              </Text>
              .
            </Text>
          </Pressable>
        </View>
      )
    }

    if (subStep === 'otp') {
      return (
        <View>
          <Text style={styles.headline}>{t('onboarding:otp.headline')}</Text>
          <Text style={styles.body}>{t('onboarding:otp.body', { phone: buildE164() })}</Text>
          {channelConfirmation && (
            <Text style={styles.channelConfirmation}>{channelConfirmation}</Text>
          )}
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
            <Text style={[styles.caption, styles.textCenter]}>{t('onboarding:otp.verifying')}</Text>
          ) : sendingOtp ? (
            <Text style={[styles.caption, styles.textCenter]}>{t('onboarding:otp.sending')}</Text>
          ) : (
            <>
              {resendCountdown > 0 && !showChannelOptions ? (
                <View style={styles.resendRow}>
                  <Text style={styles.caption}>{t('onboarding:otp.resend_countdown', { seconds: resendCountdown })}</Text>
                </View>
              ) : showChannelOptions ? (
                <View style={styles.channelOptions}>
                  <Text style={styles.channelOptionsLabel}>{t('onboarding:otp.channel_label')}</Text>
                  <Pressable
                    style={styles.channelButton}
                    onPress={() => handleResendViaChannel('sms')}
                    accessibilityRole="button"
                    accessibilityLabel={t('onboarding:otp.resend_sms_accessibility')}
                  >
                    <Icon name="message-square" size={18} color={colors.text.secondary} />
                    <Text style={styles.channelButtonText}>{t('onboarding:otp.resend_sms')}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.channelButton}
                    onPress={() => handleResendViaChannel('call')}
                    accessibilityRole="button"
                    accessibilityLabel={t('onboarding:otp.call_me_accessibility')}
                  >
                    <Icon name="call" size={18} color={colors.text.secondary} />
                    <Text style={styles.channelButtonText}>{t('onboarding:otp.call_me')}</Text>
                  </Pressable>
                </View>
              ) : null}
              {otpError && (
                <Text style={styles.errorText}>
                  {otpAttempts >= 3 ? t('onboarding:otp.error_max_attempts') : t('onboarding:otp.error_wrong_code')}
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
          <Text style={styles.headline}>{t('onboarding:gender.headline')}</Text>
          <Text style={styles.body}>{t('onboarding:gender.body')}</Text>
          <View style={styles.genderListContainer}>
            {GENDER_OPTIONS.map((g) => (
              <Pressable
                key={g}
                style={[styles.genderRow, data.userGender === g && styles.genderRowSelected]}
                onPress={() => {
                  logger.action(`User gender selected: ${t(`onboarding:gender.${g.replace(/-/g, '_')}`)}`)
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  setData((p) => ({ ...p, userGender: g }))
                }}
              >
                <Text style={[styles.genderText, data.userGender === g && styles.genderTextSelected]}>
                  {t(`onboarding:gender.${g.replace(/-/g, '_')}`)}
                </Text>
                {data.userGender === g && (
                  <Icon name="checkmark" size={20} color={colors.text.inverse} />
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
          <Text style={styles.headline}>{t('onboarding:details.headline')}</Text>
          <Text style={styles.body}>{t('onboarding:details.body')}</Text>

          {/* Country — pre-detected from phone number, editable */}
          <Text style={styles.fieldLabel}>{t('onboarding:details.country_label')}</Text>
          <Pressable
            style={styles.detailsPickerButton}
            onPress={() => setShowCountryPicker(true)}
          >
            <Text style={styles.detailsPickerText}>
              {getCountryByCode(data.userCountry)?.flag ?? ''}{' '}
              {getCountryByCode(data.userCountry)?.name ?? data.userCountry}
            </Text>
            <Icon name="chevron-forward" size={16} color={colors.text.tertiary} />
          </Pressable>
          <Text style={styles.fieldHelperText}>{t('onboarding:details.country_helper')}</Text>

          <CountryPickerModal
            visible={showCountryPicker}
            selectedCode={data.userCountry}
            onSelect={(code: string) => {
              handleCountryChange(code)
              setShowCountryPicker(false)
            }}
            onClose={() => setShowCountryPicker(false)}
          />

          {/* Date of Birth */}
          <Text style={[styles.fieldLabel, { marginTop: spacing.lg }]}>{t('onboarding:details.dob_label')}</Text>
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
                : t('onboarding:details.dob_placeholder')}
            </Text>
            <Icon name="calendar-outline" size={18} color={colors.text.secondary} />
          </Pressable>

          {showDatePicker && (
            <View style={{ marginTop: spacing.sm }}>
              <DateTimePicker
                value={pendingBirthdayRef.current || data.userBirthday || BIRTHDAY_PICKER_DEFAULT}
                mode="date"
                display={Platform.OS === 'android' ? 'default' : 'spinner'}
                minimumDate={MIN_BIRTHDAY_DATE}
                maximumDate={new Date()}
                onChange={(_event, selectedDate) => {
                  if (Platform.OS === 'android') {
                    // Android spinner fires once on confirm/dismiss
                    if (_event.type === 'set' && selectedDate) {
                      setData((p) => ({ ...p, userBirthday: selectedDate }))
                    }
                    setShowDatePicker(false)
                    return
                  }
                  // iOS spinner fires on every scroll
                  if (selectedDate) pendingBirthdayRef.current = selectedDate
                }}
              />
              {Platform.OS === 'ios' && (
                <Pressable
                  style={{
                    alignItems: 'flex-end',
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                  }}
                  onPress={() => {
                    const dateToCommit = pendingBirthdayRef.current
                    if (dateToCommit) {
                      setData((p) => ({ ...p, userBirthday: dateToCommit }))
                      pendingBirthdayRef.current = null
                    }
                    setShowDatePicker(false)
                  }}
                >
                  <Text style={{
                    ...typography.md,
                    fontWeight: fontWeights.semibold,
                    color: colors.primary[600],
                  }}>{t('common:done')}</Text>
                </Pressable>
              )}
            </View>
          )}

        </View>
      )
    }

    // ─── STEP 2 ───
    if (subStep === 'value_prop') {
      const beats = [
        { icon: 'navigate-outline' as const, headline: t('onboarding:value_prop.beat1_headline'), sub: t('onboarding:value_prop.beat1_sub') },
        { icon: 'people-outline' as const, headline: t('onboarding:value_prop.beat2_headline'), sub: t('onboarding:value_prop.beat2_sub') },
        { icon: 'flash-outline' as const, headline: t('onboarding:value_prop.beat3_headline'), sub: t('onboarding:value_prop.beat3_sub') },
      ]
      return (
        <View style={styles.valuePropCenter}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={{ width: SCREEN_WIDTH - 48 }}
            contentContainerStyle={{ alignItems: 'center' }}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / (SCREEN_WIDTH - 48))
              if (idx >= 0 && idx < beats.length) {
                setValuePropBeat(idx)
              }
            }}
          >
            {beats.map((beat, i) => (
              <View key={i} style={{ width: SCREEN_WIDTH - 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
                <View style={styles.vpIconWrap}>
                  <Icon name={beat.icon} size={64} color={colors.primary[500]} />
                </View>
                <Text style={[styles.headline, styles.textCenter]}>{beat.headline}</Text>
                <Text style={[styles.body, styles.textCenter]}>{beat.sub}</Text>
              </View>
            ))}
          </ScrollView>
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
          <Text style={[styles.headline, styles.textCenter, styles.intentHeadline]}>{t('onboarding:intents.headline')}</Text>
          <Text style={[styles.body, styles.textCenter, styles.intentBody]}>{t('onboarding:intents.body')}</Text>
          <View style={styles.intentGrid}>
            {ONBOARDING_INTENTS.map((intent, idx) => {
              const selected = data.selectedIntents.includes(intent.id)
              return (
                <Animated.View
                  key={intent.id}
                  style={{
                    width: INTENT_CARD_WIDTH,
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
                          ? p.selectedIntents.filter(i => i !== intent.id)  // Toggle off
                          : [...p.selectedIntents, intent.id],               // Toggle on
                      }))
                    }}
                  >
                    <Icon
                      name={intent.icon}
                      size={28}
                      color={selected ? colors.text.inverse : colors.gray[600]}
                    />
                    <Text style={[styles.intentLabel, selected && styles.intentLabelSelected]}>{t(`onboarding:intents.${intent.id.replace(/-/g, '_')}`)}</Text>
                    <Text style={[styles.intentDesc, selected && styles.intentDescSelected]}>{t(`onboarding:intents.${intent.id.replace(/-/g, '_')}_desc`)}</Text>
                  </Pressable>
                </Animated.View>
              )
            })}
          </View>
          <Text style={[styles.caption, styles.textCenter]}>{t('onboarding:intents.caption')}</Text>
        </View>
      )
    }

    // ─── STEP 3 ───
    if (subStep === 'location') {
      // Pre-compute requesting state to avoid TS narrowing inside if-branches:
      // inside `if (locationStatus === 'settings')`, TS narrows to literal 'settings'
      // and flags comparisons to 'requesting' as impossible.
      const isRequesting = locationStatus === 'requesting';
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
                <Icon name="checkmark" size={36} color={colors.text.inverse} />
              </View>
            </Animated.View>
            <Animated.Text style={[styles.locHeadline, { opacity: locHeadlineAnim.opacity, transform: [{ translateY: locHeadlineAnim.translateY }] }]}>
              {t('onboarding:location.granted_headline', { city: data.cityName })}
            </Animated.Text>
            <Text style={styles.locTapHint}>{t('onboarding:location.granted_tap_hint')}</Text>
          </Pressable>
        )
      }
      if (locationStatus === 'settings') {
        return (
          <View style={styles.locContainer}>
            <Animated.View style={[styles.locGlassCard, { opacity: locIconAnim.opacity, transform: [{ scale: locIconAnim.scale }, { translateY: locIconAnim.translateY }] }]}>
              <Animated.View style={[styles.locIconCircle, { transform: [{ scale: locPulse }] }]}>
                <Icon name="settings-outline" size={36} color={colors.primary[500]} />
              </Animated.View>
            </Animated.View>
            <Animated.Text style={[styles.locHeadline, { opacity: locHeadlineAnim.opacity, transform: [{ translateY: locHeadlineAnim.translateY }] }]}>
              {t('onboarding:location.settings_headline')}
            </Animated.Text>
            <Animated.Text style={[styles.locBody, { opacity: locBodyAnim.opacity, transform: [{ translateY: locBodyAnim.translateY }] }]}>
              {t('onboarding:location.settings_body')}
            </Animated.Text>
            <Animated.View style={[{ opacity: locButtonAnim.opacity, transform: [{ scale: locButtonAnim.scale }, { translateY: locButtonAnim.translateY }] }]}>
              <Pressable
                style={styles.locGlassButton}
                onPress={() => { logger.action('Open device settings pressed'); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); Linking.openSettings() }}
              >
                <Icon name="settings-outline" size={20} color={colors.text.inverse} style={styles.locButtonIcon} />
                <Text style={styles.locButtonText}>{t('onboarding:location.open_settings')}</Text>
              </Pressable>
            </Animated.View>
            <Animated.View style={[{ opacity: locButtonAnim.opacity, marginTop: spacing.md }]}>
              <Pressable
                style={[styles.locRetryButton, isRequesting && styles.locGlassButtonDisabled]}
                onPress={() => { logger.action('Retry location after settings'); handleLocationRequest() }}
                disabled={isRequesting}
              >
                {isRequesting ? (
                  <ActivityIndicator size="small" color={colors.primary[500]} style={styles.locButtonIcon} />
                ) : (
                  <Icon name="refresh-outline" size={18} color={colors.primary[500]} style={styles.locButtonIcon} />
                )}
                <Text style={styles.locRetryText}>{isRequesting ? t('onboarding:location.retry_finding') : t('onboarding:location.retry_turned_on')}</Text>
              </Pressable>
            </Animated.View>
            <Animated.View style={[{ opacity: locButtonAnim.opacity, marginTop: spacing.md }]}>
              <Text style={styles.locDeniedHelper}>We need your location to find great spots near you</Text>
            </Animated.View>
          </View>
        )
      }
      if (locationStatus === 'error') {
        return (
          <View style={styles.locContainer}>
            <Animated.View style={[styles.locGlassCard, { opacity: locIconAnim.opacity, transform: [{ scale: locIconAnim.scale }, { translateY: locIconAnim.translateY }] }]}>
              <Animated.View style={[styles.locIconCircle, { transform: [{ scale: locPulse }] }]}>
                <Icon name="cloud-offline-outline" size={36} color={colors.warning[500]} />
              </Animated.View>
            </Animated.View>
            <Animated.Text style={[styles.locHeadline, { opacity: locHeadlineAnim.opacity, transform: [{ translateY: locHeadlineAnim.translateY }] }]}>
              {t('onboarding:location.error_headline')}
            </Animated.Text>
            <Animated.Text style={[styles.locBody, { opacity: locBodyAnim.opacity, transform: [{ translateY: locBodyAnim.translateY }] }]}>
              {t('onboarding:location.error_body')}
            </Animated.Text>
            <Animated.View style={[{ opacity: locButtonAnim.opacity, transform: [{ scale: locButtonAnim.scale }, { translateY: locButtonAnim.translateY }] }]}>
              <Pressable
                style={[styles.locGlassButton, isRequesting && styles.locGlassButtonDisabled]}
                onPress={() => {
                  logger.action('Retry location from error state')
                  handleLocationRequest()
                }}
                disabled={isRequesting}
              >
                {isRequesting ? (
                  <ActivityIndicator size="small" color={colors.text.inverse} style={styles.locButtonIcon} />
                ) : (
                  <Icon name="refresh-outline" size={20} color={colors.text.inverse} style={styles.locButtonIcon} />
                )}
                <Text style={styles.locButtonText}>
                  {isRequesting ? t('onboarding:location.retry_finding') : t('onboarding:location.try_again')}
                </Text>
              </Pressable>
            </Animated.View>
            <Animated.View style={[{ opacity: locButtonAnim.opacity, marginTop: spacing.md }]}>
              <Text style={styles.locDeniedHelper}>We need your location to find great spots near you</Text>
            </Animated.View>
          </View>
        )
      }
      // Default: idle / requesting (first-time prompt)
      return (
        <View style={styles.locContainer}>
          <Animated.View style={[styles.locGlassCard, { opacity: locIconAnim.opacity, transform: [{ scale: locIconAnim.scale }, { translateY: locIconAnim.translateY }] }]}>
            <Animated.View style={[styles.locIconCircle, { transform: [{ scale: locPulse }] }]}>
              <Icon name="navigate" size={36} color={colors.primary[500]} />
            </Animated.View>
          </Animated.View>
          <Animated.Text style={[styles.locHeadline, { opacity: locHeadlineAnim.opacity, transform: [{ translateY: locHeadlineAnim.translateY }] }]}>
            {t('onboarding:location.idle_headline')}
          </Animated.Text>
          <Animated.Text style={[styles.locBody, { opacity: locBodyAnim.opacity, transform: [{ translateY: locBodyAnim.translateY }] }]}>
            {t('onboarding:location.idle_body')}
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
                <Icon name="location" size={20} color={colors.text.inverse} style={styles.locButtonIcon} />
              )}
              <Text style={styles.locButtonText}>
                {locationStatus === 'requesting' ? t('onboarding:location.retry_finding') : t('onboarding:location.enable_location')}
              </Text>
            </Pressable>
          </Animated.View>
          <Animated.View style={[{ opacity: locBodyAnim.opacity }]}>
            <View style={styles.locPrivacyRow}>
              <Icon name="shield-checkmark-outline" size={14} color={colors.text.tertiary} />
              <Text style={styles.locPrivacyText}>{t('onboarding:location.privacy_hint')}</Text>
            </View>
          </Animated.View>
        </View>
      )
    }

    // ─── STEP 4 ───
    if (subStep === 'celebration') {
      return (
        <View style={styles.celebrationCenter}>
          <Icon name="trophy-outline" size={64} color={colors.primary[500]} style={styles.stepIcon} />
          <Text style={[styles.headline, styles.textCenter]}>{t('onboarding:celebration.headline')}</Text>
          <Text style={[styles.body, styles.textCenter]}>{t('onboarding:celebration.body')}</Text>
        </View>
      )
    }


    if (subStep === 'categories') {
      return (
        <View style={styles.categoryStepRoot}>
          <Text style={styles.headline}>{t('onboarding:categories.headline')}</Text>
          <Text style={styles.body}>{t('onboarding:categories.body')}</Text>
          <View style={styles.categoryGrid}>
            {categories.map((cat) => (
              <CategoryTile
                key={cat.slug}
                slug={cat.slug}
                name={t(`common:category_${cat.slug}`)}
                icon={({
                  nature: 'trees',
                  icebreakers: 'cafe-outline',
                  drinks_and_music: 'wine-outline',
                  brunch_lunch_casual: 'restaurant-outline',
                  upscale_fine_dining: 'chef-hat',
                  movies_theatre: 'film-new',
                  creative_arts: 'color-palette-outline',
                  play: 'game-controller-outline',
                } as Record<string, string>)[cat.slug] || 'compass-outline'}
                activeColor={cat.ux.activeColor}
                selected={data.selectedCategories.includes(cat.slug)}
                onPress={() => {
                  const isSelected = data.selectedCategories.includes(cat.slug)
                  logger.action(`Category ${isSelected ? 'deselected' : 'selected'}: ${cat.slug}`)
                  setData((p) => {
                    const selected = p.selectedCategories.includes(cat.slug);
                    if (selected) {
                      return { ...p, selectedCategories: p.selectedCategories.filter((c) => c !== cat.slug) };
                    }
                    return { ...p, selectedCategories: [...p.selectedCategories, cat.slug] };
                  })
                }}
              />
            ))}
          </View>
        </View>
      )
    }

    if (subStep === 'transport') {
      return (
        <View>
          <Text style={styles.headline}>{t('onboarding:transport.headline')}</Text>
          <Text style={styles.body}>{t('onboarding:transport.body')}</Text>
          <View style={styles.tileGrid}>
            {TRANSPORT_MODES.map((mode) => (
              <Pressable
                key={mode.value}
                style={[styles.selectionTile, styles.selectionTileTall, data.travelMode === mode.value && styles.selectionTileActive]}
                onPress={() => {
                  logger.action(`Transport selected: ${mode.value}`)
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  setData((p) => ({ ...p, travelMode: mode.value }))
                }}
              >
                <Icon
                  name={mode.icon}
                  size={28}
                  color={data.travelMode === mode.value ? colors.text.inverse : colors.gray[600]}
                />
                <Text style={[styles.tileLabelSm, data.travelMode === mode.value && styles.tileTextActive]}>{t(`common:transport_${mode.value}`)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )
    }

    if (subStep === 'travel_time') {
      return (
        <View style={styles.travelTimeContainer}>
          <Text style={styles.headlineCentered}>{t('onboarding:travel_time.headline')}</Text>
          <Text style={styles.bodyCentered}>{t('onboarding:travel_time.body')}</Text>
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
                ]}>{mins} {t('onboarding:travel_time.unit')}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.customToggleRow}>
            <Text style={styles.customToggleLabel}>{t('onboarding:travel_time.custom_toggle')}</Text>
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
              <Icon name="time-outline" size={20} color={colors.primary[500]} style={styles.customInputIcon} />
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
                placeholder={t('onboarding:travel_time.custom_placeholder')}
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
              <Text style={styles.customInputUnit}>{t('onboarding:travel_time.unit')}</Text>
            </View>
          )}

          <Text style={styles.captionCentered}>
            {t('onboarding:travel_time.caption', { minutes: data.travelTimeMinutes, mode: data.travelMode })}
          </Text>

          {prefsSaveError && (
            <Text style={[styles.captionCentered, { color: '#ef4444', marginTop: spacing.sm }]}>
              {t('onboarding:travel_time.error')}
            </Text>
          )}
        </View>
      )
    }

    // ─── STEP 5: Friends & Pairing ───
    if (subStep === 'friends_and_pairing') {
      return (
        <OnboardingFriendsAndPairingStep
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
          pairActions={data.pairActions}
          onPairAction={(action) => {
            setData(prev => ({
              ...prev,
              pairActions: [...prev.pairActions, action],
            }))
          }}
          onContinue={() => goNext()}
          onSkip={() => {
            setData(prev => ({ ...prev, skippedFriends: true }))
            goNext()
          }}
          incomingRequests={incomingPendingRequests}
          onAcceptRequest={async (requestId: string) => {
            // Find the request to extract sender info before accepting
            const request = incomingPendingRequests.find(r => r.id === requestId)
            await acceptFriendRequest(requestId)
            await loadFriendRequests()
            // Add accepted friend to addedFriends so they appear in Step 6 collaborations
            if (request) {
              const friend: import('../types/onboarding').AddedFriend = {
                userId: request.sender_id,
                phoneE164: '',
                displayName: request.sender.display_name || request.sender.first_name || request.sender.username || 'Friend',
                username: request.sender.username,
                avatarUrl: request.sender.avatar_url,
                type: 'existing',
                friendshipStatus: 'friends',
              }
              setData(prev => ({
                ...prev,
                addedFriends: prev.addedFriends.some(f => f.userId === friend.userId)
                  ? prev.addedFriends
                  : [...prev.addedFriends, friend],
              }))
            }
          }}
          onDeclineRequest={async (requestId: string) => {
            await declineFriendRequest(requestId)
            await loadFriendRequests()
          }}
        />
      )
    }

    // ─── STEP 6: Collaborations ───
    if (subStep === 'collaborations') {
      return (
        <OnboardingCollaborationStep
          userId={user!.id}
          addedFriends={data.addedFriends}
          initialSessions={data.createdSessions}
          userPreferences={{
            categories: data.selectedCategories,
            intents: data.selectedIntents,
            travelMode: data.travelMode,
            travelTimeMinutes: data.travelTimeMinutes,
          }}
          onContinue={(sessions) => {
            setData(prev => ({ ...prev, createdSessions: sessions }))
            goNext()
          }}
          onSkip={() => {}}
          onActionTaken={() => {
            setData(prev => ({ ...prev, collabActionTaken: true }))
          }}
        />
      )
    }

    // ─── STEP 7a: Consent ───
    if (subStep === 'consent') {
      return (
        <OnboardingConsentStep
          onConsent={() => goNext()}
        />
      )
    }

    // ─── STEP 7b: Getting Experiences ───
    if (subStep === 'getting_experiences') {
      return (
        <GettingExperiencesScreen
          userId={user!.id}
          data={data}
          warmPoolPromiseRef={warmPoolPromiseRef}
          onComplete={onComplete}
        />
      )
    }

    return null
  }

  const ctaConfig = getCtaConfig()

  return (
    <>
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
      hideBottomBar={navState.subStep === 'getting_experiences'}
      disableKeyboardAvoidance={navState.subStep === 'collaborations' || navState.subStep === 'welcome'}
      scrollEnabled={navState.subStep !== 'welcome' && navState.subStep !== 'intents' && navState.subStep !== 'celebration' && navState.subStep !== 'gender_identity' && navState.subStep !== 'collaborations' && navState.subStep !== 'categories'}
      onBackToWelcome={isFirstScreen ? handleBackToWelcome : undefined}
    >
      {renderContent()}
    </OnboardingShell>
    <InAppBrowserModal
      visible={legalBrowserVisible}
      url={legalBrowserUrl}
      title={legalBrowserTitle}
      onClose={() => setLegalBrowserVisible(false)}
    />
    </>
  )
}

// ─── Helper ───
function getCategoryIcon(slug: string): string {
  const iconMap: Record<string, string> = {
    nature: 'trees',
    first_meet: 'handshake',
    picnic_park: 'tree-pine',
    picnic: 'tree-pine',
    drink: 'wine-outline',
    casual_eats: 'utensils-crossed',
    fine_dining: 'chef-hat',
    watch: 'film-new',
    live_performance: 'musical-notes-outline',
    creative_arts: 'color-palette-outline',
    play: 'game-controller-outline',
    wellness: 'heart-pulse',
    flowers: 'flower-outline',
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
  nameCollectionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  nameGreeting: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: fontWeights.regular,
    color: colors.text.secondary,
    textAlign: 'center',
  },
  nameGreetingAccent: {
    fontSize: 36,
    lineHeight: 44,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  namePrompt: {
    ...typography.md,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    textAlign: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
  },
  nameInputRow: {
    flexDirection: 'row',
    gap: spacing.md,
    width: '100%',
  },
  nameInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: fontWeights.medium,
    color: colors.text.primary,
    textAlign: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: colors.gray[200],
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
  consentRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    marginTop: spacing.md,
  },
  consentCheckbox: {
    marginTop: 2,
  },
  consentText: {
    ...typography.sm,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    flex: 1,
    marginLeft: spacing.sm,
  },
  consentLink: {
    color: colors.primary[700],
    fontWeight: fontWeights.medium,
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
  // ─── OTP Channel Options ───
  channelConfirmation: {
    ...typography.sm,
    color: colors.success[600],
    textAlign: 'center' as const,
    marginTop: spacing.xs,
  },
  channelOptions: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  channelOptionsLabel: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    color: colors.text.secondary,
    marginBottom: spacing.xs,
  },
  channelButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[200],
    backgroundColor: colors.background.secondary,
    gap: spacing.sm,
  },
  channelButtonText: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    color: colors.text.primary,
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
    alignItems: 'stretch',
    gap: 6,
    marginTop: spacing.md,
  },
  intentCard: {
    width: '100%',
    flex: 1,
    // Floor height so short copy (e.g. Romantic) matches taller cards; flex fills row with stretch
    minHeight: 136,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    backgroundColor: colors.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
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
  // ─── Category Grid (2 columns, full width — CategoryTile width matches this gap math) ───
  categoryStepRoot: {
    flex: 1,
    width: '100%',
  },
  categoryGrid: {
    flex: 1,
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignContent: 'stretch',
    gap: 10,
    marginTop: spacing.sm,
    paddingBottom: spacing.sm,
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
  fieldHelperText: {
    ...typography.xs,
    color: colors.text.tertiary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
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
  detailsPickerLocked: {
    backgroundColor: colors.gray[50],
    borderColor: colors.gray[200],
    borderStyle: 'dashed' as const,
  },
  detailsLockedBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    backgroundColor: colors.gray[100],
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  detailsLockedText: {
    ...typography.xs,
    fontWeight: fontWeights.medium as any,
    color: colors.text.tertiary,
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
  locDeniedHelper: {
    ...typography.sm,
    color: colors.text.tertiary,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    lineHeight: 20,
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
