/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — <IntakeQuestionTypePill />.
 *
 * Per DESIGN_ORCH-0880 §3.4 type chip row. Selectable pill primitive used in
 * IntakeQuestionEditor type chip row + IntakeTypePickerSheet 2-col grid (as a
 * label-only chip; the grid wraps it in a card for the icon layout).
 *
 * Composes no new primitives — pure Pressable + Text on token-only styles.
 */

import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";

export interface IntakeQuestionTypePillProps {
  label: string;
  active: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
  testID?: string;
}

export const IntakeQuestionTypePill: React.FC<IntakeQuestionTypePillProps> = ({
  label,
  active,
  onPress,
  accessibilityLabel,
  disabled = false,
  testID,
}) => {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active, disabled }}
      hitSlop={8}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        disabled && styles.chipDisabled,
        pressed && !disabled && styles.chipPressed,
      ]}
      testID={testID}
    >
      <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 36,
    borderRadius: radius.full,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    justifyContent: "center",
  },
  chipActive: {
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  chipDisabled: {
    opacity: 0.4,
  },
  chipPressed: {
    opacity: 0.8,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: textTokens.secondary,
  },
  labelActive: {
    color: textTokens.primary,
  },
});

export default IntakeQuestionTypePill;
