/**
 * ActionTile — generic Pressable tile for Event Detail action grid.
 *
 * Originally inline in `app/event/[id]/index.tsx:868-899`. Extracted to a
 * shared component in Cycle 13 so the new ReconciliationCtaTile (Cycle 13)
 * can compose without duplication (Const #2 — one owner per truth).
 *
 * Per Cycle 13 SPEC §4.3.1 + Step 6 implementation order.
 */

import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";

export interface ActionTileProps {
  icon: IconName;
  label: string;
  sub?: string;
  primary?: boolean;
  onPress: () => void;
}

export const ActionTile: React.FC<ActionTileProps> = ({
  icon,
  label,
  sub,
  primary = false,
  onPress,
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
    style={({ pressed }) => [
      styles.host,
      primary && styles.hostPrimary,
      pressed && styles.hostPressed,
    ]}
  >
    <Icon
      name={icon}
      size={20}
      color={primary ? accent.warm : textTokens.primary}
    />
    <Text style={styles.label} numberOfLines={1}>
      {label}
    </Text>
    {sub !== undefined ? (
      <Text style={styles.sub} numberOfLines={1}>
        {sub}
      </Text>
    ) : null}
  </Pressable>
);

const styles = StyleSheet.create({
  host: {
    flexBasis: "48%",
    flexGrow: 0,
    minHeight: 76,
    padding: spacing.md - 2,
    backgroundColor: glass.tint.profileBase,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 4,
  },
  hostPrimary: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  hostPressed: {
    opacity: 0.7,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.primary,
  },
  sub: {
    fontSize: 11,
    color: textTokens.tertiary,
  },
});

export default ActionTile;
