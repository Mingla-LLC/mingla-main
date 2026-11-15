import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { color, radius, shadow, space, type } from "../../constants/designSystem";
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
      <Icon name={action.icon} size={compact ? 20 : 18} color={color.textStrong} />
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
    gap: space[1],
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    backgroundColor: color.paper,
  },
  compact: {
    width: 40,
    minWidth: 40,
    paddingHorizontal: 0,
  },
  floating: {
    position: "absolute",
    right: space[4],
    minHeight: 48,
    zIndex: 30,
    ...shadow.menu,
  },
  pressed: { opacity: 0.86, transform: [{ scale: 0.98 }] },
  label: {
    ...type.btnSm,
    color: color.ink,
    fontWeight: "800",
  },
});
