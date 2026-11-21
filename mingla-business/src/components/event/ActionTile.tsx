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
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, motion, radius, space, type } from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";

export interface ActionTileProps {
  icon: IconName;
  label: string;
  sub?: string;
  /** Kept for source compatibility. #4420: the tile page has no orange lead tile. */
  primary?: boolean;
  /** #3872 round 2 — full-width tile. */
  wide?: boolean;
  /** #4420 — fill an equal-width cell of a row (the event tile page lays rows of 3). */
  fill?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  /** #4514: a tile that is still loading its chunk (a transient, labelled state). */
  disabled?: boolean;
  onPress: () => void;
}

/**
 * #4420 (round-3 item 10, TILE_MATRIX) — one tile on the shared event / RSVP /
 * trip / experience home: a pane tile, the icon in a small inset square, the
 * label at the bottom and an optional one-line count under it. Three per row.
 */
export const ActionTile: React.FC<ActionTileProps> = ({
  icon,
  label,
  sub,
  wide = false,
  fill = false,
  accessibilityLabel,
  testID,
  disabled = false,
  onPress,
}) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    accessibilityState={disabled ? { disabled: true } : undefined}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? label}
    testID={testID}
    style={({ pressed }) => [
      styles.host,
      wide && styles.hostWide,
      fill && styles.hostFill,
      pressed && styles.hostPressed,
    ]}
  >
    <GlassCard variant="base" radius="lg" padding={space[3]} fillHeight contentStyle={styles.content}>
      <View style={styles.iconWell}>
        <Icon name={icon} size={20} color={color.text1} />
      </View>
      <View style={styles.copy}>
        {/* Two lines before truncating: no clipped labels on a narrow phone. */}
        <Text style={styles.label} numberOfLines={2}>
          {label}
        </Text>
        {sub !== undefined ? (
          <Text style={styles.sub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
    </GlassCard>
  </Pressable>
);

const styles = StyleSheet.create({
  host: {
    flexBasis: "31%",
    flexGrow: 1,
    maxWidth: "34%",
    minHeight: 112,
  },
  hostWide: {
    flexBasis: "100%",
    maxWidth: "100%",
  },
  hostFill: {
    flexBasis: 0,
    flexGrow: 1,
    maxWidth: "100%",
  },
  hostPressed: {
    transform: [{ scale: motion.pressScale }],
  },
  content: {
    flex: 1,
    justifyContent: "space-between",
    gap: space[3],
  },
  iconWell: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.tile,
  },
  copy: {
    gap: 2,
  },
  label: {
    ...type.row,
    color: color.text1,
  },
  sub: {
    ...type.caption,
    color: color.text3,
  },
});

export default ActionTile;
