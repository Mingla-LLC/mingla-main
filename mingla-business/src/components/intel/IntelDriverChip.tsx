import React from "react";
import { Platform, Pressable, StyleSheet, Text } from "react-native";

import {
  androidOpaque,
  glass,
  radius,
  semantic,
  spacing,
  text,
  typography,
} from "../../constants/designSystem";

export type IntelDriverTone = "help" | "watch" | "hurt" | "info";

const fill = (tone: IntelDriverTone): string => {
  if (Platform.OS === "android") {
    if (tone === "help") return androidOpaque.successFill;
    if (tone === "watch") return androidOpaque.warningFill;
    if (tone === "hurt") return androidOpaque.errorFill;
    return androidOpaque.infoFill;
  }
  if (tone === "help") return semantic.successTint;
  if (tone === "watch") return semantic.warningTint;
  if (tone === "hurt") return semantic.errorTint;
  return semantic.infoTint;
};

export interface IntelDriverChipProps {
  label: string;
  tone: IntelDriverTone;
  expanded: boolean;
  onPress: () => void;
}

export const IntelDriverChip: React.FC<IntelDriverChipProps> = ({
  label,
  tone,
  expanded,
  onPress,
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ expanded }}
    accessibilityLabel={`${label}. ${expanded ? "Collapse" : "Show details"}`}
    hitSlop={6}
    style={[styles.chip, { backgroundColor: fill(tone) }]}
  >
    <Text style={styles.label}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  chip: {
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
  },
  label: { ...typography.caption, color: text.primary },
});
