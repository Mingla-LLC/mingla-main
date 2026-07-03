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
  /**
   * ORCH-1270 RC-3 — SMS pre-send guardrail (all additive + optional; email
   * and every existing caller are unaffected). When `isSendNow &&
   * smsOutsideWindow`, a NON-blocking warning + a "Schedule for …" secondary
   * CTA render above the actions row. "Send now" stays primary (RC-1 defers
   * safely). Undefined ⇒ nothing changes.
   */
  smsOutsideWindow?: boolean;
  nextWindowLabel?: string;
  onScheduleForNextWindow?: () => void;
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
  smsOutsideWindow,
  nextWindowLabel,
  onScheduleForNextWindow,
}) => {
  const ctaLabel = isSendNow ? "Send now" : "Schedule";
  // ORCH-1270 RC-3 — show the out-of-window heads-up only on a Send-now review
  // when the whole audience is currently outside sending hours. Non-blocking.
  const showOutsideWindowWarning = isSendNow && smsOutsideWindow === true;
  const scheduleForLabel = `Schedule for ${nextWindowLabel ?? ""}`.trim();
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
        {showOutsideWindowWarning ? (
          <View style={styles.warningSection}>
            <Text style={styles.warningTitle}>Outside texting hours right now</Text>
            <Text style={styles.warningBody}>
              {"It's before 8 AM or after 9 PM local for your whole audience, so nothing sends this instant. Tap Send now and Mingla holds each text until that person's next morning window — or schedule it for "}
              {nextWindowLabel ?? ""}
              {"."}
            </Text>
            {onScheduleForNextWindow !== undefined ? (
              <Pressable
                onPress={onScheduleForNextWindow}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel={scheduleForLabel}
                style={({ pressed }) => [
                  styles.scheduleForBtn,
                  pressed && !submitting ? styles.ghostBtnPressed : null,
                ]}
              >
                <Text style={styles.scheduleForBtnLabel}>{scheduleForLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
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
    overflow: "hidden",
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
  // ORCH-1270 RC-3 — out-of-window warning block. Reuses the section container
  // shape with an accent border (no new design tokens).
  warningSection: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
    backgroundColor: glass.tint.profileBase,
  },
  warningTitle: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "700",
  },
  warningBody: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  scheduleForBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  scheduleForBtnLabel: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.primary,
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
    overflow: "hidden",
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
