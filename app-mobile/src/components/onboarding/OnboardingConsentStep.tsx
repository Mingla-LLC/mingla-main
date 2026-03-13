import React from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
} from '../../constants/designSystem'

interface OnboardingConsentStepProps {
  onConsent: () => void
  onDecline: () => void
}

export const OnboardingConsentStep: React.FC<OnboardingConsentStepProps> = ({
  onConsent,
  onDecline,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Ionicons name="shield-checkmark-outline" size={48} color={colors.primary[500]} />
      </View>

      <Text style={styles.headline}>Before we continue</Text>

      <Text style={styles.body}>
        Mingla uses your preferences and activity to find the best experiences for you. Your data is never sold or shared with advertisers.
      </Text>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.consentButton}
          onPress={onConsent}
          activeOpacity={0.7}
        >
          <Text style={styles.consentButtonText}>I agree — let's go</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onDecline} activeOpacity={0.7}>
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: spacing.lg,
  },
  headline: {
    fontSize: typography.sizes['2xl'],
    fontWeight: fontWeights.bold as any,
    color: colors.neutral[900],
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  body: {
    fontSize: typography.sizes.md,
    color: colors.neutral[500],
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  actions: {
    width: '100%',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  consentButton: {
    backgroundColor: colors.primary[500],
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    width: '100%',
    alignItems: 'center',
  },
  consentButtonText: {
    color: '#fff',
    fontSize: typography.sizes.md,
    fontWeight: fontWeights.semiBold as any,
  },
  skipText: {
    fontSize: typography.sizes.md,
    color: colors.neutral[400],
  },
})
