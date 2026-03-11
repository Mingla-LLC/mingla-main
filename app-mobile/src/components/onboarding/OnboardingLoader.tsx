import React from 'react'
import { View, ActivityIndicator, StatusBar, StyleSheet } from 'react-native'
import { useOnboardingResume } from '../../hooks/useOnboardingResume'
import OnboardingFlow from '../OnboardingFlow'
import { colors } from '../../constants/designSystem'

interface OnboardingLoaderProps {
  userId: string
  // Uses the same ResumeProfile shape that useOnboardingResume expects.
  // Pass the full profile object — the hook only reads what it needs.
  profile: {
    id: string
    phone?: string | null
    onboarding_step?: number | null
    gender?: string | null
    birthday?: string | null
    country?: string | null
    preferred_language?: string | null
  }
  onComplete: () => void
}

export default function OnboardingLoader({ userId, profile, onComplete }: OnboardingLoaderProps) {
  const resumeData = useOnboardingResume(userId, profile)

  if (!resumeData.isReady) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
        <ActivityIndicator size="large" color={colors.primary[500]} />
      </View>
    )
  }

  return (
    <OnboardingFlow
      onComplete={onComplete}
      initialStep={resumeData.initialStep}
      initialData={resumeData.initialData}
      phonePreVerified={resumeData.phonePreVerified}
      initialHasGpsPermission={resumeData.hasGpsPermission}
      resumeSubStep={resumeData.resumeSubStep}
    />
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
})
