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
  dismissDisabled?: boolean;
  onBack: () => void;
  onClose: () => void;
  onConfirm: () => void;
  /**
   * ORCH-1270 F-1 — SMS timing info note (all additive + optional; email and
   * every existing caller are unaffected). When `isSendNow && smsInfoNote`, an
   * always-on INFORMATIONAL note ("How SMS timing works") + a "Schedule for …"
   * secondary CTA render above the actions row. It is NOT a warning — it simply
   * explains that off-hours recipients are held and auto-sent in their next
   * morning window (nothing is lost). "Send now" stays primary (RC-1 defers
   * safely). Undefined ⇒ nothing changes.
   */
  smsInfoNote?: boolean;
  nextWindowLabel?: string;
  onScheduleForNextWindow?: () => void;
  /**
   * ORCH-1281 — channel-aware review row (all additive + optional; email and
   * every existing caller are unaffected). When `channelKind === "sms"` the
   * SUBJECT section is replaced with a MESSAGE section showing `messagePreview`
   * (the SMS wire body, first ~140 chars) and, when `hasMedia`, a "+ 1 photo
   * (MMS)" caption. Undefined / "email" ⇒ the existing SUBJECT section renders
   * verbatim.
   */
  channelKind?: "email" | "sms";
  messagePreview?: string;
  hasMedia?: boolean;
  estimatedCostLabel?: string;
  selectedCount?: number;
  suppressedCount?: number;
  unavailableCount?: number;
  quoteExpiresAt?: string;
  staleWarning?: boolean;
  disabledReason?: string | null;
  onRetryPreview?: () => void;
  retryDisabled?: boolean;
  staleDetail?: string;
}

export const ComposerReviewSheet: React.FC<ComposerReviewSheetProps> = ({
  visible,
  audienceName,
  recipientCount,
  subject,
  scheduledLabel,
  isSendNow,
  submitting,
  dismissDisabled = false,
  onBack,
  onClose,
  onConfirm,
  smsInfoNote,
  nextWindowLabel,
  onScheduleForNextWindow,
  channelKind,
  messagePreview,
  hasMedia,
  estimatedCostLabel,
  selectedCount,
  suppressedCount,
  unavailableCount,
  quoteExpiresAt,
  staleWarning,
  disabledReason,
  onRetryPreview,
  retryDisabled,
  staleDetail,
}) => {
  const ctaLabel = isSendNow ? "Send now" : "Schedule";
  const handleClose = dismissDisabled ? () => {} : onClose;
  // ORCH-1270 F-1 — always show the SMS timing info note on an SMS Send-now
  // review. Informational (not a warning): it tells the operator that off-hours
  // recipients are held and auto-sent in their next window, nothing is lost.
  const showSmsInfoNote = isSendNow && smsInfoNote === true;
  const scheduleForLabel = `Schedule for ${nextWindowLabel ?? ""}`.trim();
  return (
    <Sheet
      visible={visible}
      onClose={handleClose}
      dismissOnScrimTap={!dismissDisabled}
      snapPoint="half"
    >
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
              {recipientCount} reachable{" "}
              {recipientCount === 1 ? "person" : "people"}
            </Text>
          ) : null}
          {estimatedCostLabel !== undefined ? (
            <Text style={styles.metaText}>{estimatedCostLabel}</Text>
          ) : null}
          {selectedCount !== undefined ? (
            <Text style={styles.metaText}>
              {selectedCount} selected · {suppressedCount ?? 0} suppressed ·{" "}
              {unavailableCount ?? 0} unavailable
            </Text>
          ) : null}
          {quoteExpiresAt !== undefined ? (
            <Text style={styles.metaText}>
              Preview valid until{" "}
              {new Date(quoteExpiresAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
          ) : null}
          {staleWarning === true ? (
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              style={styles.errorText}
            >
              {staleDetail ?? "The audience or cost changed."} Review this
              refreshed preview, then confirm again.
            </Text>
          ) : null}
          {disabledReason ? (
            <Text style={styles.errorText}>{disabledReason}</Text>
          ) : null}
          {disabledReason && onRetryPreview ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh preview"
              accessibilityState={{ disabled: retryDisabled === true }}
              disabled={retryDisabled === true}
              onPress={onRetryPreview}
            >
              <Text style={styles.scheduleForBtnLabel}>Refresh preview</Text>
            </Pressable>
          ) : null}
        </View>
        {channelKind === "sms" ? (
          // ORCH-1281 — SMS has no subject line; show the actual message (wire
          // body incl. STOP footer) + an MMS-photo caption when attached.
          <View style={styles.section}>
            <Text style={styles.label}>MESSAGE</Text>
            <Text style={styles.value} numberOfLines={4}>
              {messagePreview !== undefined && messagePreview.length > 0
                ? messagePreview
                : "(no message)"}
            </Text>
            {hasMedia === true ? (
              <Text style={styles.metaText}>+ 1 photo (MMS)</Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.label}>SUBJECT</Text>
            <Text style={styles.value} numberOfLines={2}>
              {subject.length > 0 ? subject : "(no subject)"}
            </Text>
          </View>
        )}
        <View style={styles.section}>
          <Text style={styles.label}>
            {isSendNow ? "DELIVERY" : "SCHEDULED FOR"}
          </Text>
          <Text style={styles.value}>{scheduledLabel}</Text>
        </View>
        {showSmsInfoNote ? (
          <View style={styles.infoSection}>
            <Text style={styles.infoTitle}>How SMS timing works</Text>
            <Text style={styles.infoBody}>
              {
                "Texts only send during each recipient's local hours (8 AM–9 PM). Anyone outside that window right now is automatically held and sent in their next morning window — nothing is lost. You can also schedule the whole blast for "
              }
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
                <Text style={styles.scheduleForBtnLabel}>
                  {scheduleForLabel}
                </Text>
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
            disabled={submitting || disabledReason != null}
            accessibilityRole="button"
            accessibilityLabel={
              staleWarning
                ? `Confirm updated ${isSendNow ? "send" : "schedule"}`
                : ctaLabel
            }
            accessibilityState={{
              disabled: submitting || disabledReason != null,
            }}
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && !submitting ? styles.primaryBtnPressed : null,
              submitting ? styles.primaryBtnDisabled : null,
            ]}
          >
            <Text style={styles.primaryBtnLabel}>
              {submitting
                ? "Working…"
                : staleWarning
                  ? `Confirm updated ${isSendNow ? "send" : "schedule"}`
                  : ctaLabel}
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
  errorText: { ...typography.bodySm, color: "#FFB4AB", fontWeight: "600" },
  // ORCH-1270 F-1 — neutral SMS-timing INFO note (not a warning). Reuses the
  // plain section container shape + neutral border (no accent, no new tokens)
  // so it reads as a helpful heads-up, not an error.
  infoSection: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  infoTitle: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "700",
  },
  infoBody: {
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
