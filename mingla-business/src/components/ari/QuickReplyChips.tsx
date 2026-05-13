/**
 * ORCH-0821 — QuickReplyChips
 * Horizontal/vertical chip list for tap-to-send shortcuts.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export interface QuickReplyChipsProps {
  chips: string[];
  onSelect: (chip: string) => void;
  layout?: "stack" | "row";
}

export const QuickReplyChips: React.FC<QuickReplyChipsProps> = ({
  chips,
  onSelect,
  layout = "stack",
}) => {
  if (chips.length === 0) return null;
  return (
    <View style={[layout === "row" ? styles.row : styles.stack]}>
      {chips.map((chip) => (
        <Pressable
          key={chip}
          onPress={() => onSelect(chip)}
          style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
          accessibilityRole="button"
          accessibilityLabel={chip}
          accessibilityHint="Sends this message to Ari"
        >
          <Text style={styles.chipText} numberOfLines={layout === "row" ? 1 : 2}>
            {chip}
          </Text>
        </Pressable>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  stack: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  chip: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: "center",
  },
  chipPressed: {
    backgroundColor: glass.tint.profileElevated,
    opacity: 0.95,
  },
  chipText: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "500",
    color: textTokens.primary,
  },
});

export default QuickReplyChips;
