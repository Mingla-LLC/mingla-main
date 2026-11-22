/**
 * #4541 R2.3 — the form screen's two small sheets ("This link is just for one
 * person", "Leave without sending?"): a title, a body and two buttons. Closes
 * by the first button, a scrim tap, swipe down or Android back (all run
 * `onClose`). Dark, like the screen under it.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { FORM_DARK } from "./useFormPrimitives";

export interface FormChoiceSheetProps {
  visible: boolean;
  title: string;
  body: string;
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
  onClose: () => void;
  testID: string;
}

export function FormChoiceSheet({
  visible,
  title,
  body,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  onClose,
  testID,
}: FormChoiceSheetProps): React.ReactElement {
  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel={title}
      enablePanDownToClose
      enableDynamicSizing
      scrollMode="scroll"
      theme="dark"
      wrapInRNModal
    >
      <View style={styles.body} testID={testID}>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        <Text style={styles.text}>{body}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={onPrimary}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          testID={`${testID}-primary`}
        >
          <Text style={styles.primaryText}>{primaryLabel}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onSecondary}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          testID={`${testID}-secondary`}
        >
          <Text style={styles.secondaryText}>{secondaryLabel}</Text>
        </Pressable>
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 32, gap: 12 },
  title: { color: FORM_DARK.text1, fontSize: 20, lineHeight: 26, fontWeight: "700", textAlign: "left" },
  text: { color: FORM_DARK.text2, fontSize: 15, lineHeight: 22, textAlign: "left", marginBottom: 8 },
  primary: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: FORM_DARK.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primaryText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
  secondary: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: FORM_DARK.line,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  secondaryText: { color: FORM_DARK.text1, fontSize: 16, fontWeight: "600" },
  pressed: { opacity: 0.7 },
});
