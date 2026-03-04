import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { SegmentedProgressBar } from './SegmentedProgressBar';
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
  touchTargets,
  backgroundWarmGlow,
} from '../../constants/designSystem';

interface OnboardingShellProps {
  step: number; // 1-5
  segmentFill: number; // 0-1
  showBackButton: boolean;
  onBack: () => void;
  primaryCtaLabel: string;
  primaryCtaDisabled: boolean;
  primaryCtaLoading: boolean;
  onPrimaryCta: () => void;
  hidePrimaryCta?: boolean;
  hideBottomBar?: boolean;
  children: React.ReactNode;
}

export const OnboardingShell: React.FC<OnboardingShellProps> = ({
  step,
  segmentFill,
  showBackButton,
  onBack,
  primaryCtaLabel,
  primaryCtaDisabled,
  primaryCtaLoading,
  onPrimaryCta,
  hidePrimaryCta = false,
  hideBottomBar = false,
  children,
}) => {
  const handleBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onBack();
  };

  const handlePrimaryCta = () => {
    if (primaryCtaDisabled || primaryCtaLoading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPrimaryCta();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Progress bar */}
        <View style={styles.progressContainer}>
          <SegmentedProgressBar
            totalSegments={5}
            currentStep={step}
            currentSegmentFill={segmentFill}
          />
        </View>

        {/* Scrollable content */}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>

        {/* Fixed bottom bar */}
        {!hideBottomBar && (
          <View style={styles.bottomBar}>
            {/* Back button */}
            {showBackButton ? (
              <TouchableOpacity
                style={styles.backButton}
                onPress={handleBack}
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <Ionicons
                  name="arrow-back"
                  size={18}
                  color={colors.text.primary}
                />
                <Text style={styles.backButtonText}>Back</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.backPlaceholder} />
            )}

            {/* Primary CTA */}
            {!hidePrimaryCta && (
              <TouchableOpacity
                style={[
                  styles.primaryCta,
                  primaryCtaLoading
                    ? styles.primaryCtaLoading
                    : primaryCtaDisabled
                      ? styles.primaryCtaDisabled
                      : styles.primaryCtaEnabled,
                ]}
                onPress={handlePrimaryCta}
                disabled={primaryCtaDisabled || primaryCtaLoading}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={primaryCtaLabel}
              >
                {primaryCtaLoading ? (
                  <>
                    <ActivityIndicator
                      size="small"
                      color={colors.text.inverse}
                      style={styles.ctaSpinner}
                    />
                    <Text style={styles.primaryCtaTextEnabled}>Saving...</Text>
                  </>
                ) : (
                  <Text
                    style={[
                      styles.primaryCtaText,
                      primaryCtaDisabled
                        ? styles.primaryCtaTextDisabled
                        : styles.primaryCtaTextEnabled,
                    ]}
                  >
                    {primaryCtaLabel}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: backgroundWarmGlow,
  },
  flex: {
    flex: 1,
  },
  progressContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 120,
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
    backgroundColor: backgroundWarmGlow,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    height: touchTargets.comfortable,
    width: touchTargets.comfortable,
    justifyContent: 'center',
  },
  backButtonText: {
    ...typography.md,
    fontWeight: fontWeights.medium,
    color: colors.text.primary,
    marginLeft: spacing.xs,
  },
  backPlaceholder: {
    width: touchTargets.comfortable,
    height: touchTargets.comfortable,
  },
  primaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: touchTargets.comfortable,
    minWidth: 120,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
  },
  primaryCtaEnabled: {
    backgroundColor: colors.primary[500],
  },
  primaryCtaDisabled: {
    backgroundColor: colors.gray[200],
  },
  primaryCtaLoading: {
    backgroundColor: colors.primary[500],
    opacity: 0.8,
  },
  primaryCtaText: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
  },
  primaryCtaTextEnabled: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
  },
  primaryCtaTextDisabled: {
    color: colors.text.tertiary,
  },
  ctaSpinner: {
    marginRight: spacing.sm,
  },
});
