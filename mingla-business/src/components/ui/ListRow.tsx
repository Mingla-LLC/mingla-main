/**
 * ListRow — #4420 Graphite Glass (spec §3.2). The one row: optional icon tile
 * or leading node, a title with an optional sub line, an optional right
 * value / status node, and a chevron when it navigates. 56 high (64 `lg`),
 * 16 side padding, hairline between rows (`divider`). `selected` uses the
 * selected material wash; `danger` turns the title red.
 *
 * Long titles wrap to two lines and the right value never runs off the row.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PressableStateCallbackType, StyleProp, ViewStyle } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";

import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  /** A custom leading node (Avatar, cover thumb). Wins over `icon`. */
  leading?: React.ReactNode;
  /** Right-aligned text value (amount, count). */
  value?: string;
  /** Right-aligned node (StatusPill, Switch). Rendered after `value`. */
  trailing?: React.ReactNode;
  /** Show the navigation chevron. Defaults to true when `onPress` is set and no `trailing` node is given. */
  chevron?: boolean;
  onPress?: () => void;
  size?: "md" | "lg";
  selected?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** Hairline above this row (rows after the first in a list). */
  divider?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const LIST_ROW_HEIGHT = { md: 56, lg: 64 } as const;

export const ListRow: React.FC<ListRowProps> = ({
  title,
  subtitle,
  icon,
  leading,
  value,
  trailing,
  chevron,
  onPress,
  size = "md",
  selected = false,
  danger = false,
  disabled = false,
  divider = false,
  accessibilityLabel,
  testID,
  style,
}) => {
  const showChevron = chevron ?? (onPress !== undefined && trailing === undefined);
  const body = (pressed: boolean): React.ReactNode => (
    <View
      style={[
        styles.row,
        { minHeight: LIST_ROW_HEIGHT[size] },
        divider ? styles.divider : null,
        selected ? styles.selected : null,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      {leading !== undefined ? (
        <View style={styles.leading}>{leading}</View>
      ) : icon !== undefined ? (
        <View style={styles.iconTile}>
          <Icon name={icon} size={18} color={danger ? color.errorText : color.text1} />
        </View>
      ) : null}
      <View style={styles.text}>
        <Text style={[styles.title, danger ? styles.dangerText : null]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle !== undefined && subtitle.length > 0 ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value !== undefined ? (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {trailing !== undefined ? <View style={styles.trailing}>{trailing}</View> : null}
      {showChevron ? <Icon name="chevR" size={16} color={color.text3} /> : null}
    </View>
  );

  if (onPress === undefined) {
    return <View testID={testID}>{body(false)}</View>;
  }
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)}
      accessibilityState={{ disabled, selected }}
      testID={testID}
    >
      {(state: PressableStateCallbackType & { hovered?: boolean }) => body(state.pressed || state.hovered === true)}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  selected: { backgroundColor: color.fill.railOn },
  pressed: { backgroundColor: color.fill.rowHover },
  disabled: { opacity: 0.45 },
  leading: { flexShrink: 0 },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: color.fill.tile,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...type.row, color: color.text1 },
  dangerText: { color: color.errorText },
  subtitle: { ...type.caption, color: color.text3 },
  value: { ...type.small, fontWeight: "600", color: color.text1, flexShrink: 0, maxWidth: "40%" },
  trailing: { flexShrink: 0 },
});

export default ListRow;
