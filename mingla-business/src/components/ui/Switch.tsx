/**
 * Switch — #4420 Graphite Glass (spec §3.2). A binary toggle: paper knob on
 * a paper track when on, a muted track when off. 51×31 (the iOS switch
 * size) so the hit target is 44 with hitSlop. Controlled.
 */

import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { color, radius, shadow } from "../../constants/designSystem";

export interface SwitchProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const SWITCH_WIDTH = 51;
export const SWITCH_HEIGHT = 31;
const KNOB = 27;

export const Switch: React.FC<SwitchProps> = ({ value, onValueChange, disabled = false, accessibilityLabel, testID, style }) => (
  <Pressable
    onPress={() => {
      if (!disabled) onValueChange(!value);
    }}
    disabled={disabled}
    hitSlop={{ top: 7, bottom: 7, left: 0, right: 0 }}
    accessibilityRole="switch"
    accessibilityLabel={accessibilityLabel}
    accessibilityState={{ checked: value, disabled }}
    testID={testID}
    style={[
      styles.track,
      { backgroundColor: value ? color.paper : color.fill.step },
      disabled ? styles.disabled : null,
      style,
    ]}
  >
    <View
      style={[
        styles.knob,
        shadow.paper,
        { backgroundColor: value ? color.ink : color.text1, alignSelf: value ? "flex-end" : "flex-start" },
      ]}
    />
  </Pressable>
);

const styles = StyleSheet.create({
  track: {
    width: SWITCH_WIDTH,
    height: SWITCH_HEIGHT,
    borderRadius: radius.full,
    padding: 2,
    justifyContent: "center",
  },
  knob: { width: KNOB, height: KNOB, borderRadius: radius.full },
  disabled: { opacity: 0.4 },
});

export default Switch;
