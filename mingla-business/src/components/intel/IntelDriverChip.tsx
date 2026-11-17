import React from "react";
import { Platform, Pressable, StyleSheet, Text } from "react-native";

import {
  radius,
  color,
  space,
  type,
} from "../../constants/designSystem";

export type IntelDriverTone = "help" | "watch" | "hurt" | "info";

const fill = (tone: IntelDriverTone): string => {
  if (Platform.OS === "android") {
    if (tone === "help") return color.solidTint.success;
    if (tone === "watch") return color.solidTint.warning;
    if (tone === "hurt") return color.solidTint.error;
    return color.solidTint.info;
  }
  if (tone === "help") return color.successTint;
  if (tone === "watch") return color.warningTint;
  if (tone === "hurt") return color.errorTint;
  return color.infoTint;
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
    paddingHorizontal: space[2],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.lineStrong,
  },
  label: { ...type.caption, color: color.text1 },
});
