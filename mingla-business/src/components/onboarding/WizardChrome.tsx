import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { colors, spacing, radius, fontWeights } from "../../constants/designSystem";

interface WizardChromeProps {
  currentStep: number;
  totalSteps: number;
  onBack?: () => void;
  onContinue: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  continueLoading?: boolean;
  children: React.ReactNode;
}

/**
 * Shared wizard wrapper for all multi-step flows in the business app.
 * Provides: progress bar, back button, step indicator, sticky Continue CTA.
 * Reusable for: onboarding, claim place, event creation.
 */
export default function WizardChrome({
  currentStep,
  totalSteps,
  onBack,
  onContinue,
  continueLabel = "Continue",
  continueDisabled = false,
  continueLoading = false,
  children,
}: WizardChromeProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(["onboarding", "common"]);
  const progress = totalSteps > 0 ? currentStep / totalSteps : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        {onBack ? (
          <TouchableOpacity
            onPress={onBack}
            style={styles.backButton}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={24} color={colors.gray[600]} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backPlaceholder} />
        )}
        <Text style={styles.stepIndicator}>
          {t("onboarding:step_of", { current: currentStep, total: totalSteps })}
        </Text>
        <View style={styles.backPlaceholder} />
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>

      {/* Scrollable content */}
      <View style={styles.content}>{children}</View>

      {/* Sticky CTA */}
      <View style={[styles.ctaContainer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          onPress={onContinue}
          disabled={continueDisabled || continueLoading}
          style={[
            styles.ctaButton,
            (continueDisabled || continueLoading) && styles.ctaButtonDisabled,
          ]}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={continueLabel}
          accessibilityState={{ disabled: continueDisabled || continueLoading }}
        >
          {continueLoading ? (
            <ActivityIndicator size="small" color={colors.text.inverse} />
          ) : (
            <Text style={styles.ctaText}>{continueLabel}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  header: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  backPlaceholder: {
    width: 44,
  },
  stepIndicator: {
    fontSize: 14,
    fontWeight: fontWeights.medium,
    color: colors.text.tertiary,
  },
  progressTrack: {
    height: 4,
    backgroundColor: colors.gray[100],
  },
  progressFill: {
    height: 4,
    backgroundColor: colors.primary[500],
    borderRadius: 2,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  ctaContainer: {
    paddingHorizontal: 20,
    paddingTop: spacing.md,
  },
  ctaButton: {
    height: 56,
    backgroundColor: colors.primary[500],
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  ctaButtonDisabled: {
    backgroundColor: colors.primary[200],
    shadowOpacity: 0,
    elevation: 0,
  },
  ctaText: {
    fontSize: 16,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
  },
});
