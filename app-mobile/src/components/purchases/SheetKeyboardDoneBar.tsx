/**
 * #4473 — the one Done bar over the keyboard in the dark purchase sheets.
 *
 * On iOS it is an InputAccessoryView, so it is PART of the keyboard: the sheet
 * (gorhom `keyboardBehavior="interactive"`) lifts above keyboard + bar, and
 * nothing floats over the focused field or the primary button. The sheet
 * turns the shared floating KeyboardToolbar off (`keyboardToolbar="none"` on
 * iOS), and PhoneInput keeps its own accessory (themed dark), so every field
 * has exactly one dark bar.
 *
 * ONE BAR PER FIELD, RENDERED RIGHT AFTER IT. On the new architecture an
 * InputAccessoryView links itself to the text input with its nativeID when the
 * accessory moves to the window, so the input must already be mounted then. A
 * single bar mounted at the top of the sheet, before the email tab or the code
 * step exists, never linked (device re-check: no bar on Email or the code).
 * Each field therefore gets its own id (`sheetDoneBarId("email")`) and its own
 * `<SheetKeyboardDoneBar nativeID={…} />` placed after it.
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

/** The accessory id for one field of a purchase sheet. */
export function sheetDoneBarId(field: string): string {
  return `${SHEET_KEYBOARD_DONE_BAR_ID}-${field}`;
}

/** The shared toolbar mode a dark purchase sheet asks BaseBottomSheet for. */
export const PURCHASE_SHEET_KEYBOARD_TOOLBAR: "none" | "dark" =
  Platform.OS === "ios" ? "none" : "dark";

export function SheetKeyboardDoneBar({
  nativeID,
}: {
  nativeID: string;
}): React.ReactElement | null {
  const { t } = useTranslation("purchases");
  if (Platform.OS !== "ios") return null;
  return (
    <InputAccessoryView nativeID={nativeID}>
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
    height: 44,
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
