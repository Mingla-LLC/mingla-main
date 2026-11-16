/**
 * FieldErrorLine — #4420. The error line under a checkout buyer field.
 *
 * It is ALWAYS mounted and always one line tall, so an error appearing or
 * clearing never pushes the fields, the consent box or the pay bar below it.
 * When to show the message is decided by `useRevealedFieldErrors`.
 */
import React from "react";
import { StyleSheet, Text } from "react-native";
import type { StyleProp, TextStyle } from "react-native";

interface FieldErrorLineProps {
  message: string | null;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

export const FieldErrorLine: React.FC<FieldErrorLineProps> = ({
  message,
  style,
  testID,
}) => (
  <Text
    style={[style, styles.slot]}
    accessibilityRole={message !== null ? "alert" : undefined}
    aria-live="polite"
    testID={testID}
  >
    {message ?? ""}
  </Text>
);

const styles = StyleSheet.create({
  slot: {
    minHeight: 16,
    lineHeight: 16,
  },
});

export default FieldErrorLine;
