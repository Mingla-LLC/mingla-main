/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — <IntakeRequiredToggle />.
 *
 * Per DESIGN_ORCH-0880 §3.4 required Switch. Thin wrapper around RN core
 * Switch with consistent "Required" label + accessibility + Mingla
 * trackColor/thumbColor matching the ORCH-0875 BookingDeadlinePicker pattern.
 *
 * Composes no new primitives.
 */

import React from "react";
import { StyleSheet, Switch, Text, View } from "react-native";

import {
  color,
  space,
} from "../../constants/designSystem";

export interface IntakeRequiredToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  testID?: string;
}

export const IntakeRequiredToggle: React.FC<IntakeRequiredToggleProps> = ({
  value,
  onValueChange,
  disabled = false,
  testID,
}) => {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>Required</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: color.line, true: color.accentLine }}
        thumbColor={value ? color.accent : color.text3}
        ios_backgroundColor={color.line}
        accessibilityRole="switch"
        accessibilityLabel="Required question"
        accessibilityHint={
          value
            ? "Travelers must answer this question to continue"
            : "Travelers can skip this question"
        }
        accessibilityState={{ checked: value, disabled }}
        testID={testID}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space[1],
    minHeight: 44,
  },
  label: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "500",
    color: color.text1,
  },
});

export default IntakeRequiredToggle;
