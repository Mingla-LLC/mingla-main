/**
 * ComposerFooter — sticky bottom action bar.
 *   - "Save draft" ghost button (always enabled when there's any dirty state)
 *   - "Review & schedule →" primary button (disabled until all required fields)
 *
 * Safe-area aware internally — caller mounts at position absolute bottom: 0.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export interface ComposerFooterProps {
  onSaveDraft: () => void;
  saveDraftDisabled?: boolean;
  saveDraftLabel?: string;
  onReview: () => void;
  reviewDisabled: boolean;
  reviewLabel?: string;
  submitting?: boolean;
}

export const ComposerFooter: React.FC<ComposerFooterProps> = ({
  onSaveDraft,
  saveDraftDisabled,
  saveDraftLabel = "Save draft",
  onReview,
  reviewDisabled,
  reviewLabel = "Review & schedule →",
  submitting,
}) => {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.host,
        { paddingBottom: Math.max(insets.bottom, spacing.sm) + spacing.sm },
      ]}
    >
      <Pressable
        onPress={onSaveDraft}
        disabled={saveDraftDisabled === true || submitting === true}
        accessibilityRole="button"
        accessibilityLabel="Save draft"
        accessibilityState={{
          disabled: saveDraftDisabled === true || submitting === true,
        }}
        style={({ pressed }) => [
          styles.ghostBtn,
          pressed ? styles.ghostBtnPressed : null,
          saveDraftDisabled === true || submitting === true
            ? styles.ghostBtnDisabled
            : null,
        ]}
      >
        <Text style={styles.ghostBtnLabel}>{saveDraftLabel}</Text>
      </Pressable>
      <Pressable
        onPress={onReview}
        disabled={reviewDisabled || submitting === true}
        accessibilityRole="button"
        accessibilityLabel={reviewLabel}
        accessibilityState={{ disabled: reviewDisabled || submitting === true }}
        style={({ pressed }) => [
          styles.primaryBtn,
          reviewDisabled || submitting === true
            ? styles.primaryBtnDisabled
            : styles.primaryBtnEnabled,
          pressed && !reviewDisabled && submitting !== true
            ? styles.primaryBtnPressed
            : null,
        ]}
      >
        <Text
          style={[
            styles.primaryBtnLabel,
            reviewDisabled || submitting === true
              ? styles.primaryBtnLabelDisabled
              : null,
          ]}
        >
          {submitting === true ? "Scheduling…" : reviewLabel}
        </Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
    backgroundColor: "rgba(20, 22, 26, 0.92)",
  },
  ghostBtn: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostBtnPressed: {
    opacity: 0.85,
  },
  ghostBtnDisabled: {
    opacity: 0.4,
  },
  ghostBtnLabel: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "600",
  },
  primaryBtn: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnEnabled: {
    backgroundColor: "rgba(235, 120, 37, 0.42)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
  },
  primaryBtnDisabled: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
  primaryBtnPressed: {
    opacity: 0.85,
  },
  primaryBtnLabel: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "600",
  },
  primaryBtnLabelDisabled: {
    color: textTokens.tertiary,
  },
});
