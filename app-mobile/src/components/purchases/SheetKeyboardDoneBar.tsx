/**
 * #4473 — the one Done bar over the keyboard in the dark purchase sheets.
 *
 * On iOS it is an InputAccessoryView, so it is PART of the keyboard: the sheet
 * (gorhom `keyboardBehavior="interactive"`) lifts above keyboard + bar, and
 * nothing floats over the focused field or the primary button. The sheet
 * turns the shared floating KeyboardToolbar off (`keyboardToolbar="none"` on
 * iOS), and PhoneInput keeps its own accessory (themed dark), so every field
 * has exactly one dark bar. Fields opt in with
 * `inputAccessoryViewID={SHEET_KEYBOARD_DONE_BAR_ID}`.
 *
 * Android has no accessory view; there the sheet keeps the shared toolbar in
 * its dark tone.
 */
import React from "react";
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { PURCHASE_SHEET_COLORS as C } from "./purchaseSheetTheme";

export const SHEET_KEYBOARD_DONE_BAR_ID = "mingla-purchase-sheet-done";

/** The shared toolbar mode a dark purchase sheet asks BaseBottomSheet for. */
export const PURCHASE_SHEET_KEYBOARD_TOOLBAR: "none" | "dark" =
  Platform.OS === "ios" ? "none" : "dark";

export function SheetKeyboardDoneBar(): React.ReactElement | null {
  const { t } = useTranslation("purchases");
  if (Platform.OS !== "ios") return null;
  return (
    <InputAccessoryView nativeID={SHEET_KEYBOARD_DONE_BAR_ID}>
      <View style={styles.bar} testID="sheet-keyboard-done-bar">
        <Pressable
          accessibilityLabel={t("keyboardDone")}
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => Keyboard.dismiss()}
          style={({ pressed }) => [styles.done, pressed && styles.pressed]}
        >
          <Text style={styles.doneText}>{t("keyboardDone")}</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: 44,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 16,
    backgroundColor: C.sheet,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  done: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "flex-end" },
  doneText: { color: C.accent, fontSize: 17, fontWeight: "600" },
  pressed: { opacity: 0.6 },
});
