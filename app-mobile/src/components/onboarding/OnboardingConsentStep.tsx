import React, { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { LinkConsentCard } from '../LinkConsentCard'
import { PendingLinkConsent } from '../../services/linkConsentService'
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
  shadows,
} from '../../constants/designSystem'

interface OnboardingConsentStepProps {
  pendingConsents: PendingLinkConsent[]
  onRespond: (linkId: string, action: 'accept' | 'decline') => Promise<void>
  isResponding: boolean
  onContinue: () => void
}

export function OnboardingConsentStep({
  pendingConsents,
  onRespond,
  isResponding,
  onContinue,
}: OnboardingConsentStepProps) {
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set())

  const allResolved = pendingConsents.length > 0 && resolvedIds.size >= pendingConsents.length

  const handleRespond = async (linkId: string, action: 'accept' | 'decline') => {
    await onRespond(linkId, action)
    setResolvedIds(prev => new Set(prev).add(linkId))
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="people-outline" size={32} color={colors.primary[500]} />
        <Text style={styles.headline}>Link profiles with your new friends?</Text>
        <Text style={styles.subtext}>
          Linking lets you share your name, birthday, and preferences with each other — so your recommendations get even better.
        </Text>
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {pendingConsents.map((consent) => (
          <View
            key={consent.linkId}
            style={[
              styles.cardWrapper,
              resolvedIds.has(consent.linkId) && styles.cardResolved,
            ]}
          >
            {resolvedIds.has(consent.linkId) ? (
              <View style={styles.resolvedCard}>
                <Ionicons name="checkmark-circle" size={20} color={colors.success?.[500] || '#10B981'} />
                <Text style={styles.resolvedText}>Done</Text>
              </View>
            ) : (
              <LinkConsentCard
                consent={consent}
                onRespond={handleRespond}
                isResponding={isResponding}
              />
            )}
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.continueButton,
            !allResolved && styles.continueButtonDisabled,
          ]}
          onPress={onContinue}
          disabled={!allResolved}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.continueButtonText,
              !allResolved && styles.continueButtonTextDisabled,
            ]}
          >
            Continue
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  headline: {
    fontSize: typography.xl.fontSize,
    fontWeight: fontWeights.bold as any,
    color: colors.text.primary,
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  subtext: {
    fontSize: typography.sm.fontSize,
    color: colors.text.tertiary,
    textAlign: 'center',
    lineHeight: 20,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  cardWrapper: {
    marginBottom: spacing.sm,
  },
  cardResolved: {
    opacity: 0.6,
  },
  resolvedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  resolvedText: {
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.semibold as any,
    color: colors.success?.[500] || '#10B981',
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingBottom: spacing.lg,
  },
  continueButton: {
    backgroundColor: colors.primary[500],
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.md,
  },
  continueButtonDisabled: {
    backgroundColor: colors.gray[200],
  },
  continueButtonText: {
    fontSize: typography.md.fontSize,
    fontWeight: fontWeights.semibold as any,
    color: '#FFFFFF',
  },
  continueButtonTextDisabled: {
    color: colors.gray[400],
  },
})
