/**
 * #4490 — the ONE time control for venue hours, special days and offer
 * editors (click-test D20, D21, D22). 24-hour "HH:mm", never seconds, never
 * AM/PM, and the same look on every platform:
 *
 *   - a text field you can type into ("22:00", "2200", "22", "9:30"); a full
 *     time commits as you type, anything else is checked when you leave it;
 *   - a clock button that opens a list of times (every 30 minutes) to tap or
 *     click.
 *
 * Neither part is a native browser `<input type="time">`: that widget shows
 * 12-hour AM/PM in some locales, cannot be driven by plain clicks and typing
 * in every browser, and looked different from the rest of the editor.
 *
 * The field re-reads `value` whenever it changes and the field is not being
 * typed in, so a saved value that comes back from the server always shows.
 *
 * The picker for the older programs screens stays at `programs/TimeField.tsx`
 * (its #3872 pins). #4490 fix1: this file no longer re-exports its helpers
 * (no caller used them, and the re-export pulled the native date picker and
 * expo-router into every screen that uses this field).
 */
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useTouchFloor } from "../../hooks/useTouchFloor";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { Icon } from "./Icon";
import { PickerSheetHead } from "./PickerSheetHead";
import { Sheet } from "./Sheet";
import { normalizeTime24, timeOptions } from "./fieldModels";

const OPTIONS = timeOptions(30);
/** One list row: its 44 height plus the 4 gap. */
const OPTION_STRIDE = 48;

/** A complete time typed so far ("22:00", "2200", "9:30") that should commit now. */
export function isCompleteTimeTyping(text: string): boolean {
  const t = text.trim();
  return /^\d{1,2}:\d{2}$/.test(t) || /^\d{4}$/.test(t);
}

export interface TimeFieldProps {
  label: string;
  /** "HH:mm" (a stored "HH:mm:ss" is shown without seconds) or "" for unset. */
  value: string;
  onChangeValue: (value: string) => void;
  accessibilityLabel: string;
  placeholder?: string;
  hasError?: boolean;
  disabled?: boolean;
  testID?: string;
}

export function TimeField({
  label,
  value,
  onChangeValue,
  accessibilityLabel,
  placeholder = "HH:MM",
  hasError = false,
  disabled = false,
  testID,
}: TimeFieldProps): React.ReactElement {
  const shown = normalizeTime24(value) ?? "";
  const [text, setText] = useState(shown);
  const [typingError, setTypingError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const focused = useRef(false);
  const listRef = useRef<React.ElementRef<typeof ScrollView> | null>(null);
  const { isWideDesktop } = useResponsiveLayout();
  // #4490: hitSlop does nothing in a phone browser, so the field parts are drawn 44 there.
  const touchFloor = useTouchFloor();

  // Re-read the value from the owner unless the host is typing in this field.
  useEffect(() => {
    if (!focused.current) {
      setText(shown);
      setTypingError(null);
    }
  }, [shown]);

  const commit = (next: string): void => {
    setTypingError(null);
    setText(next);
    if (next !== shown) onChangeValue(next);
  };

  const onBlur = (): void => {
    focused.current = false;
    if (text.trim().length === 0) {
      setText(shown);
      return;
    }
    const next = normalizeTime24(text);
    if (next === null) {
      setTypingError("Use 24-hour time, like 22:00.");
      return;
    }
    commit(next);
  };

  const listValue = OPTIONS.some((o) => o.value === shown) ? shown : null;
  // The list opens at the current time (or the nearest half hour before it).
  const startIndex = Math.max(0, OPTIONS.findIndex((o) => o.value >= (shown || "09:00")) - 2);
  const showError = hasError || typingError !== null;

  return (
    <View style={styles.host} testID={testID}>
      {label.length > 0 ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.field, showError && styles.fieldError, disabled && styles.disabled]}>
        <TextInput
          value={text}
          editable={!disabled}
          placeholder={placeholder}
          placeholderTextColor={color.text4}
          accessibilityLabel={accessibilityLabel}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          selectTextOnFocus
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={onBlur}
          onSubmitEditing={onBlur}
          onChangeText={(next) => {
            setText(next);
            setTypingError(null);
            if (isCompleteTimeTyping(next)) {
              const normalized = normalizeTime24(next);
              if (normalized !== null && normalized !== shown) onChangeValue(normalized);
            }
          }}
          style={[styles.input, touchFloor > 0 ? { minHeight: touchFloor } : null]}
          testID={testID !== undefined ? `${testID}-input` : undefined}
        />
        <Pressable
          onPress={() => setOpen(true)}
          disabled={disabled}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Choose ${accessibilityLabel.toLowerCase()} from a list`}
          style={({ pressed }) => [styles.listButton, touchFloor > 0 ? { width: touchFloor, height: touchFloor } : null, pressed && styles.pressed]}
          testID={testID !== undefined ? `${testID}-list` : undefined}
        >
          <Icon name="clock" size={16} color={color.text2} />
        </Pressable>
      </View>
      {typingError !== null ? <Text style={styles.error}>{typingError}</Text> : null}
      {/* I-SUB-SHEET-INSIDE-PARENT: the list renders as this field's child. */}
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        snapPoint={0.6}
        presentation={isWideDesktop ? "modal" : undefined}
      >
        <View style={styles.sheetBody}>
          <PickerSheetHead title={label} onClose={() => setOpen(false)} testID={testID !== undefined ? `${testID}-head` : undefined} />
          <ScrollView
            ref={listRef}
            style={styles.scroll}
            contentContainerStyle={styles.list}
            onContentSizeChange={() => {
              listRef.current?.scrollTo?.({ y: startIndex * OPTION_STRIDE, animated: false });
            }}
          >
            {OPTIONS.map((option) => {
              const on = option.value === listValue;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    commit(option.value);
                    setOpen(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={option.label}
                  style={[styles.option, on && styles.optionOn]}
                  testID={testID !== undefined ? `${testID}-option-${option.value}` : undefined}
                >
                  <Text style={[styles.optionText, on && styles.optionTextOn]}>{option.label}</Text>
                  {on ? <Icon name="check" size={16} color={color.text1} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: space[1], flex: 1, minWidth: 0 },
  label: { ...type.small, color: color.text2 },
  field: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    paddingLeft: space[3],
    paddingRight: space[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  fieldError: { borderColor: color.danger },
  disabled: { opacity: 0.5 },
  input: {
    flex: 1,
    minWidth: 0,
    ...type.body,
    color: color.text1,
    paddingVertical: space[2],
    fontVariant: ["tabular-nums"],
  },
  listButton: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { backgroundColor: color.fill.tile },
  error: { ...type.caption, color: color.errorText },
  sheetBody: { flex: 1, paddingHorizontal: space[4], paddingTop: space[2], gap: space[2] },
  scroll: { flex: 1 },
  list: { gap: space[1], paddingBottom: space[6] },
  option: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    backgroundColor: color.fill.inset,
  },
  optionOn: { backgroundColor: color.accentLine },
  optionText: { ...type.body, color: color.text2, fontVariant: ["tabular-nums"] },
  optionTextOn: { color: color.text1, fontWeight: "600" },
});
