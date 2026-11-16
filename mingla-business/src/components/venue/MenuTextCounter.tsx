import React from "react";
import { StyleSheet, Text } from "react-native";

import {
  color,
  type,
} from "../../constants/designSystem";

export interface MenuTextCounterProps {
  used: number;
  limit: number;
  invalid?: boolean;
  nativeID: string;
  testID?: string;
}

/** Visual-only count state; validation and announcement timing stay with the form. */
export function MenuTextCounter({
  used,
  limit,
  invalid = false,
  nativeID,
  testID,
}: MenuTextCounterProps): React.ReactElement {
  return (
    <Text
      accessibilityRole="text"
      nativeID={nativeID}
      testID={testID}
      style={[styles.counter, invalid && styles.invalid]}
    >
      {used} / {limit}
    </Text>
  );
}

const styles = StyleSheet.create({
  counter: {
    ...type.caption,
    color: color.text3,
  },
  invalid: {
    color: color.errorText,
    fontWeight: "600",
  },
});
