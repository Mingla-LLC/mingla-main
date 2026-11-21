/**
 * #4522 — one tappable chip for the 4-step builder (inclusions, refunds, the
 * traveler-question library). Graphite Glass tokens only: a selected chip is
 * white on a raised fill with a check, never orange (accent is for Create,
 * progress and steppers).
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { Icon, type IconName } from "../ui/Icon";

export interface TripBuilderChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
  /** Spoken name; defaults to the label. */
  accessibilityLabel?: string;
  testID?: string;
}

export const TripBuilderChip: React.FC<TripBuilderChipProps> = ({
  label,
  selected = false,
  onPress,
  icon,
  disabled = false,
  accessibilityLabel,
  testID,
}) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ selected, disabled }}
    hitSlop={4}
    style={({ pressed }) => [
      styles.chip,
      selected ? styles.chipOn : null,
      pressed ? styles.chipPressed : null,
      disabled ? styles.chipDisabled : null,
    ]}
    testID={testID}
  >
    <View style={styles.row}>
      {selected ? (
        <Icon name="check" size={14} color={color.textStrong} />
      ) : icon !== undefined ? (
        <Icon name={icon} size={14} color={color.text2} />
      ) : null}
      <Text style={[styles.label, selected ? styles.labelOn : null]}>{label}</Text>
    </View>
  </Pressable>
);

const styles = StyleSheet.create({
  chip: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
  },
  chipOn: {
    backgroundColor: color.fill.step,
    borderColor: color.textStrong,
  },
  chipPressed: {
    opacity: 0.8,
  },
  chipDisabled: {
    opacity: 0.45,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  label: {
    fontSize: type.chip.fontSize,
    lineHeight: type.chip.lineHeight,
    fontWeight: type.chip.fontWeight,
    color: color.text2,
  },
  labelOn: {
    color: color.textStrong,
  },
});
