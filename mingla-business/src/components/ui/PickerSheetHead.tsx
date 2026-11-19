/**
 * #4490 F2 - the head of every picker sheet (a list to choose from, a clock list,
 * a calendar): a title and an always-visible Close button. Tapping outside still
 * closes the sheet; this is the second, visible way out, so a picker is never a
 * dead end on a phone, with a keyboard or with a screen reader.
 *
 * One component so a new picker cannot ship without the control
 * (regression: pickerSheetClose.issue4490.implementor.test.tsx).
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { Icon } from "./Icon";

export interface PickerSheetHeadProps {
  /** Shown as the sheet heading. Omit for a sheet whose own row is the heading (a calendar). */
  title?: string;
  onClose: () => void;
  /**
   * A wide side panel draws its own Close (Sheet.web); pass true there so the head
   * shows only the title and the panel's button is the one control.
   */
  plain?: boolean;
  testID?: string;
}

export function PickerSheetHead({ title, onClose, plain = false, testID }: PickerSheetHeadProps): React.ReactElement {
  return (
    <View style={styles.row} testID={testID}>
      <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
        {title ?? ""}
      </Text>
      {plain ? null : (
      <Pressable
        onPress={onClose}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        testID={testID !== undefined ? `${testID}-close` : undefined}
      >
        <Icon name="close" size={18} color={color.text1} />
      </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2], minHeight: 44 },
  title: { ...type.h2, color: color.text1, flexShrink: 1 },
  close: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.inset,
  },
  pressed: { backgroundColor: color.fill.tile },
});
