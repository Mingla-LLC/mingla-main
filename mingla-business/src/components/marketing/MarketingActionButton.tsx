import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import {
  accent,
  radius,
  shadows,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import type { MarketingAction } from "./MarketingActionContext";

export function MarketingActionButton({
  action,
  compact = false,
  floating = false,
  bottom,
}: {
  action: MarketingAction;
  compact?: boolean;
  floating?: boolean;
  bottom?: number;
}): React.ReactElement {
  return (
    <Pressable
      onPress={action.onPress}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      testID={floating ? "marketing-floating-action" : "marketing-tab-action"}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        floating && styles.floating,
        floating && typeof bottom === "number" ? { bottom } : null,
        pressed && styles.pressed,
      ]}
    >
      <Icon name={action.icon} size={compact ? 20 : 18} color={textTokens.inverse} />
      {compact ? null : (
        <Text style={styles.label}>{floating ? action.label : action.label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: accent.warm,
  },
  compact: {
    width: 40,
    minWidth: 40,
    paddingHorizontal: 0,
  },
  floating: {
    position: "absolute",
    right: spacing.md,
    minHeight: 48,
    zIndex: 30,
    ...shadows.glassCardElevated,
  },
  pressed: { opacity: 0.86, transform: [{ scale: 0.98 }] },
  label: {
    ...typography.buttonMd,
    color: textTokens.inverse,
    fontWeight: "800",
  },
});
