/**
 * Chip — the filter / tag chip (#4420), on = the selected material with its rim.
 *
 * Its own module so a screen that needs only a chip never loads
 * `react-native-reanimated` through the animated status pill (#4490: the venue
 * availability screen). `Pill.tsx` re-exports it, so every existing
 * `import { Chip } from "../ui/Pill"` is unchanged.
 */

import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import {
  color,
  materials,
  radius as radiusTokens,
  space,
  type,
} from "../../constants/designSystem";

export interface ChipProps {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  error?: boolean;
  count?: number;
  onPress?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const Chip: React.FC<ChipProps> = ({ label, selected = false, disabled = false, error = false, count, onPress, testID, style }) => (
  <Pressable
    onPress={disabled ? undefined : onPress}
    disabled={disabled || onPress === undefined}
    accessibilityRole={onPress !== undefined ? "button" : "text"}
    accessibilityState={{ selected, disabled }}
    accessibilityLabel={count !== undefined ? `${label}, ${count}` : label}
    testID={testID}
    style={[
      chipStyles.chip,
      selected ? chipStyles.on : null,
      error ? chipStyles.error : null,
      disabled ? chipStyles.disabled : null,
      style,
    ]}
  >
    <Text style={[chipStyles.label, selected ? chipStyles.labelOn : null]} numberOfLines={1}>
      {label}
    </Text>
    {count !== undefined ? (
      <Text style={[chipStyles.count, selected ? chipStyles.countOn : null]}>{count}</Text>
    ) : null}
  </Pressable>
);

const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    minHeight: 36,
    paddingHorizontal: space[3],
    borderRadius: radiusTokens.full,
    backgroundColor: color.fill.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    alignSelf: "flex-start",
  },
  on: {
    backgroundColor: materials.selected.solidFill,
    borderColor: materials.selected.rim.edge,
    borderTopColor: materials.selected.rim.top ?? materials.selected.rim.edge,
  },
  error: { borderColor: color.errorLine },
  disabled: { opacity: 0.4 },
  label: { ...type.chip, color: color.text2 },
  labelOn: { color: color.textStrong },
  count: { ...type.caption, color: color.text3 },
  countOn: { color: color.textSelectedChipMeta },
});
