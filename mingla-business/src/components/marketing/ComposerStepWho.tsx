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

export interface ComposerStepWhoProps {
  audienceName: string | null;
  reachableEmail: number | null;
  totalAudience: number | null;
  onOpenPicker: () => void;
  disabled?: boolean;
}

export const ComposerStepWho: React.FC<ComposerStepWhoProps> = ({
  audienceName,
  reachableEmail,
  totalAudience,
  onOpenPicker,
  disabled,
}) => {
  const isEmpty = audienceName === null;
  const reachText =
    totalAudience !== null && reachableEmail !== null
      ? `${totalAudience} people · ${reachableEmail} with marketing consent`
      : null;
  return (
    <View style={styles.host}>
      <Text style={styles.stepLabel} accessibilityRole="header">STEP 1 — WHO</Text>
      <Pressable
        onPress={onOpenPicker}
        disabled={disabled === true}
        accessibilityRole="button"
        accessibilityLabel={
          isEmpty ? "Pick an audience" : `Change audience: ${audienceName ?? ""}`
        }
        accessibilityState={{ disabled: disabled === true }}
        style={({ pressed }) => [
          styles.picker,
          isEmpty ? styles.pickerEmpty : styles.pickerFilled,
          pressed && disabled !== true ? styles.pickerPressed : null,
          disabled === true ? styles.pickerDisabled : null,
        ]}
      >
        <Text style={styles.pickerLabel}>
          {isEmpty ? "Pick an audience" : (audienceName ?? "Audience")}
        </Text>
        <Text style={styles.pickerChevron}>›</Text>
      </Pressable>
      {reachText !== null ? (
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
    gap: spacing.xs,
  },
  stepLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  picker: {
    minHeight: 56,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
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
