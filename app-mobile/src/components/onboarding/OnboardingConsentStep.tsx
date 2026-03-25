import React from 'react'
import {
  View,
  Text,
  StyleSheet,
} from 'react-native'
import { Icon } from '../ui/Icon'
import {
  colors,
  typography,
  fontWeights,
  spacing,
} from '../../constants/designSystem'

interface OnboardingConsentStepProps {
  onConsent: () => void
}

export const OnboardingConsentStep: React.FC<OnboardingConsentStepProps> = ({
  onConsent,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Icon name="shield-checkmark-outline" size={48} color={colors.primary[500]} />
      </View>

      <Text style={styles.headline}>One quick thing</Text>

      <Text style={styles.body}>
        Mingla uses what you've shared — your tastes, your vibe, your location — to find experiences you'll genuinely love. Your data stays yours. We never sell it, and you can delete it anytime.
      </Text>
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
    fontSize: typography.xxl.fontSize,
    fontWeight: fontWeights.bold as any,
    color: colors.gray[900],
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  body: {
    fontSize: typography.md.fontSize,
    color: colors.gray[500],
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },
})
