/**
 * ComposerStepWho — Step 1 of the composer. Audience picker pressable +
 * reach counts caption.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";

export interface ComposerStepWhoProps {
  audienceName: string | null;
  reachableEmail: number | null;
  totalAudience: number | null;
  onOpenPicker: () => void;
  disabled?: boolean;
  /**
   * #2262 bpShort ladder, step 1. On a short viewport (< 720pt tall — the
   * 1024x700 desktop case and every phone with the keyboard up) the reach
   * caption moves INTO the picker row as a right-aligned count instead of
   * occupying its own line, recovering ~20pt for the composer sheet.
   *
   * Nothing is lost: the same two numbers are still on screen, and the full
   * sentence stays in the picker's `accessibilityLabel`. The commit bar is
   * never a step in this ladder — it is the last thing standing.
   */
  compact?: boolean;
}

export const ComposerStepWho: React.FC<ComposerStepWhoProps> = ({
  audienceName,
  reachableEmail,
  totalAudience,
  onOpenPicker,
  disabled,
  compact,
}) => {
  const { isWideDesktop } = useResponsiveLayout();
  const isEmpty = audienceName === null;
  const reachText =
    totalAudience !== null && reachableEmail !== null
      ? `${totalAudience} people · ${reachableEmail} with marketing consent`
      : null;
  const reachCount = totalAudience !== null ? `${totalAudience}` : null;
  const isCompact = compact === true;
  return (
    <View style={styles.host}>
      {/* F.8: dropped "STEP 1 — WHO" label per ORCH-0864 compact-layout brief.
          The Pick-an-audience button is self-explanatory; the step prefix
          was a V1 wizard affordance not needed in the dense V2 layout. */}
      <Pressable
        onPress={onOpenPicker}
        disabled={disabled === true}
        accessibilityRole="button"
        accessibilityLabel={
          isEmpty
            ? "Pick an audience"
            : `Change audience: ${audienceName ?? ""}${reachText !== null ? `. ${reachText}` : ""}`
        }
        accessibilityState={{ disabled: disabled === true }}
        style={({ pressed }) => [
          styles.picker,
          isEmpty ? styles.pickerEmpty : styles.pickerFilled,
          isWideDesktop ? styles.desktopPicker : null,
          isWideDesktop && !isEmpty ? styles.desktopPickerFilled : null,
          pressed && disabled !== true ? styles.pickerPressed : null,
          disabled === true ? styles.pickerDisabled : null,
        ]}
      >
        <Text style={styles.pickerLabel} numberOfLines={1}>
          {isEmpty ? "Pick an audience" : (audienceName ?? "Audience")}
        </Text>
        {isCompact && reachCount !== null ? (
          <Text style={styles.pickerCount} testID="composer-who-compact-count">
            {reachCount}
          </Text>
        ) : null}
        <Text style={styles.pickerChevron}>›</Text>
      </Pressable>
      {isCompact ? null : reachText !== null ? (
        <Text style={styles.reachText}>{reachText}</Text>
      ) : disabled === true ? (
        <Text style={styles.disabledCaption}>
          No audiences yet — your buyers fill in as people purchase tickets.
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.xxs,
  },
  picker: {
    minHeight: 48, // F.8: was 56
    paddingHorizontal: spacing.md,
    borderRadius: radius.md, // F.8: was radius.lg
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  pickerEmpty: {
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  pickerFilled: {
    borderColor: accent.border,
    backgroundColor: "rgba(235, 120, 37, 0.12)",
  },
  desktopPicker: {
    borderColor: "rgba(255, 255, 255, 0.11)",
    backgroundColor: "transparent",
  },
  desktopPickerFilled: {
    borderColor: "rgba(235, 120, 37, 0.5)",
  },
  pickerPressed: {
    opacity: 0.85,
  },
  pickerDisabled: {
    opacity: 0.5,
  },
  pickerLabel: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "600",
    flex: 1,
  },
  pickerCount: {
    ...typography.caption,
    color: textTokens.tertiary,
    flexShrink: 0,
  },
  pickerChevron: {
    ...typography.bodyLg,
    color: textTokens.secondary,
  },
  reachText: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  disabledCaption: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
});
