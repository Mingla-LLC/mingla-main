/**
 * ComposerFooter — sticky bottom action bar.
 *
 * Stage F.10b: 3-button footer (Preview / Send Now / Schedule). Per
 * operator directive 2026-05-18:
 *   - Preview (ghost):   opens the EmailPreviewPane modal (inbox view)
 *   - Send Now (light):  opens the review-confirmation sheet in send-now
 *                        mode (NO immediate send — review then confirm)
 *   - Schedule (primary): opens the SchedulePickerSheet (date+time), then
 *                         the review-confirmation sheet
 *
 * Save-draft moved to ComposerHeader top-right per operator directive F.9.
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
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";

export interface ComposerFooterProps {
  /** Preview button — opens inbox preview modal. Always enabled. */
  onPreview: () => void;
  /**
   * Send Now button — opens review-confirmation sheet in send-now mode.
   * Disabled until the audience + subject + body validate.
   */
  onSendNow: () => void;
  sendNowDisabled: boolean;
  /**
   * Schedule button — opens the date+time picker, then the review-
   * confirmation sheet. Same validation gate as Send Now.
   */
  onSchedule: () => void;
  scheduleDisabled: boolean;
  /** True while the mutation is in flight (post-confirmation). */
  submitting?: boolean;
}

export const ComposerFooter: React.FC<ComposerFooterProps> = ({
  onPreview,
  onSendNow,
  sendNowDisabled,
  onSchedule,
  scheduleDisabled,
  submitting,
}) => {
  const insets = useSafeAreaInsets();
  const { isWideDesktop } = useResponsiveLayout();
  const disabledByMutation = submitting === true;
  // ORCH-0891 M3 D-2: hide Preview button on wide-desktop. The
  // permanent right-hand EmailPreviewPane mounted by ComposerCanvas.web
  // makes the Modal-based Preview button redundant — the inbox view is
  // already live on screen as the operator types. Native + narrow web
  // still render the button (their preview is the Modal).
  return (
    <View
      style={[
        styles.host,
        isWideDesktop ? styles.desktopHost : null,
        {
          paddingTop: spacing.md,
          paddingBottom: isWideDesktop ? 0 : insets.bottom + spacing.lg,
        },
      ]}
    >
      {isWideDesktop ? null : (
        <Pressable
          onPress={onPreview}
          disabled={disabledByMutation}
          accessibilityRole="button"
          accessibilityLabel="Preview email"
          accessibilityState={{ disabled: disabledByMutation }}
          style={({ pressed }) => [
            styles.ghostBtn,
            pressed ? styles.ghostBtnPressed : null,
            disabledByMutation ? styles.btnDisabled : null,
          ]}
        >
          <Text style={styles.ghostBtnLabel}>Preview</Text>
        </Pressable>
      )}
      <Pressable
        onPress={onSendNow}
        disabled={sendNowDisabled || disabledByMutation}
        accessibilityRole="button"
        accessibilityLabel="Send now"
        accessibilityState={{
          disabled: sendNowDisabled || disabledByMutation,
        }}
        style={({ pressed }) => [
          styles.lightBtn,
          isWideDesktop ? styles.desktopAccentOutlineBtn : null,
          pressed && !sendNowDisabled && !disabledByMutation
            ? styles.lightBtnPressed
            : null,
          sendNowDisabled || disabledByMutation ? styles.btnDisabled : null,
        ]}
      >
        <Text style={styles.lightBtnLabel}>Send now</Text>
      </Pressable>
      <Pressable
        onPress={onSchedule}
        disabled={scheduleDisabled || disabledByMutation}
        accessibilityRole="button"
        accessibilityLabel="Schedule"
        accessibilityState={{
          disabled: scheduleDisabled || disabledByMutation,
        }}
        style={({ pressed }) => [
          styles.primaryBtn,
          scheduleDisabled || disabledByMutation
            ? styles.primaryBtnDisabled
            : styles.primaryBtnEnabled,
          isWideDesktop && (scheduleDisabled || disabledByMutation)
            ? styles.desktopFlatBtn
            : null,
          isWideDesktop && !scheduleDisabled && !disabledByMutation
            ? styles.desktopPrimaryBtnEnabled
            : null,
          pressed && !scheduleDisabled && !disabledByMutation
            ? styles.primaryBtnPressed
            : null,
        ]}
      >
        <Text
          style={[
            styles.primaryBtnLabel,
            scheduleDisabled || disabledByMutation
              ? styles.primaryBtnLabelDisabled
              : null,
          ]}
        >
          {disabledByMutation ? "Working…" : "Schedule"}
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
  },
  desktopHost: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.sm,
    paddingTop: spacing.sm,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  // F.10b — Preview ghost button (leftmost). Outlined, no fill, neutral.
  ghostBtn: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostBtnPressed: {
    opacity: 0.78,
  },
  ghostBtnLabel: {
    ...typography.buttonMd,
    color: textTokens.primary,
    fontWeight: "600",
  },
  desktopFlatBtn: {
    backgroundColor: "transparent",
    borderColor: "rgba(255, 255, 255, 0.13)",
  },
  // F.10b — Send Now light-tinted button (middle). Primary-light: orange
  // tint at lower opacity than the rightmost Schedule primary, so the
  // visual hierarchy still reads "scheduling = the most affirmative
  // action" while send-now is an equally-weighted alternative.
  lightBtn: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
    backgroundColor: "rgba(235, 120, 37, 0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  lightBtnPressed: {
    opacity: 0.85,
  },
  lightBtnLabel: {
    ...typography.buttonMd,
    color: textTokens.primary,
    fontWeight: "600",
  },
  desktopAccentOutlineBtn: {
    backgroundColor: "transparent",
    borderColor: "rgba(235, 120, 37, 0.58)",
  },
  // F.10b — Schedule primary button (rightmost). Solid orange fill.
  primaryBtn: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnEnabled: {
    backgroundColor: "rgba(235, 120, 37, 0.42)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.warm,
  },
  desktopPrimaryBtnEnabled: {
    backgroundColor: accent.warm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.warm,
  },
  primaryBtnPressed: {
    opacity: 0.85,
  },
  primaryBtnDisabled: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
  primaryBtnLabel: {
    ...typography.buttonMd,
    color: textTokens.primary,
    fontWeight: "700",
  },
  primaryBtnLabelDisabled: {
    color: textTokens.tertiary,
  },
});
