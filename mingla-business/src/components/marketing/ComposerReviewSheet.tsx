/**
 * ComposerReviewSheet — modal review of audience + preview thumbnail +
 * schedule time before tapping the final Schedule / Send now button.
 *
 * Renders INSIDE the parent composer Sheet (props-controlled visibility).
 */

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Sheet } from "../ui/Sheet";
import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export interface ComposerReviewSheetProps {
  visible: boolean;
  audienceName: string | null;
  recipientCount: number | null;
  subject: string;
  scheduledLabel: string;
  isSendNow: boolean;
  submitting: boolean;
  onBack: () => void;
  onClose: () => void;
  onConfirm: () => void;
}

export const ComposerReviewSheet: React.FC<ComposerReviewSheetProps> = ({
  visible,
  audienceName,
  recipientCount,
  subject,
  scheduledLabel,
  isSendNow,
  submitting,
  onBack,
  onClose,
  onConfirm,
}) => {
  const ctaLabel = isSendNow ? "Send now" : "Schedule";
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="half">
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Ready to send?</Text>
        <Text style={styles.subtitle}>
          Review the details below. Mingla auto-skips suppressed contacts.
        </Text>
        <View style={styles.section}>
          <Text style={styles.label}>AUDIENCE</Text>
          <Text style={styles.value}>{audienceName ?? "—"}</Text>
          {recipientCount !== null ? (
            <Text style={styles.metaText}>
              {recipientCount} reachable {recipientCount === 1 ? "person" : "people"}
            </Text>
          ) : null}
        </View>
        <View style={styles.section}>
          <Text style={styles.label}>SUBJECT</Text>
          <Text style={styles.value} numberOfLines={2}>
            {subject.length > 0 ? subject : "(no subject)"}
          </Text>
        </View>
        <View style={styles.section}>
          <Text style={styles.label}>{isSendNow ? "DELIVERY" : "SCHEDULED FOR"}</Text>
          <Text style={styles.value}>{scheduledLabel}</Text>
        </View>
        <View style={styles.actionsRow}>
          <Pressable
            onPress={onBack}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Back to edit"
            style={({ pressed }) => [
              styles.ghostBtn,
              pressed ? styles.ghostBtnPressed : null,
            ]}
          >
            <Text style={styles.ghostBtnLabel}>Back to edit</Text>
          </Pressable>
          <Pressable
            onPress={onConfirm}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            accessibilityState={{ disabled: submitting }}
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && !submitting ? styles.primaryBtnPressed : null,
              submitting ? styles.primaryBtnDisabled : null,
            ]}
          >
            <Text style={styles.primaryBtnLabel}>
              {submitting ? "Working…" : ctaLabel}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  title: {
    ...typography.h3,
    color: textTokens.primary,
  },
  subtitle: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  section: {
    gap: 4,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  label: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  value: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "500",
  },
  metaText: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  actionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
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
  ghostBtnLabel: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.primary,
  },
  primaryBtn: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: "rgba(235, 120, 37, 0.42)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnPressed: {
    opacity: 0.85,
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryBtnLabel: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "600",
  },
});
