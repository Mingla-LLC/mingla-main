/**
 * #3872 round 2 — a time picker that matches DateField: native time picker
 * on phones, `<input type="time">` on web. Value is "HH:MM" or "" (unset).
 *
 * iOS: the spinner opens in the app's Sheet at full width. Rendered inline it
 * sat inside the half-width Time column and its AM/PM wheel was clipped off
 * the right edge of the screen. Android keeps its own dialog.
 */
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "../ui/Button";
import { ProgramSheet } from "./ProgramSheet";
import { SheetBody } from "./ProgramKit";

import {
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { WebDateTimeInput } from "../ui/WebDateTimeInput";

/** "6:00 PM" from "18:00"; "" for unset. */
export function timeLabel(value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return "";
  const hours = Number(match[1]);
  const suffix = hours >= 12 ? "PM" : "AM";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${match[2]} ${suffix}`;
}

/** "18:00" from a Date. */
function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Where the native time picker shows: iOS in a full-width sheet (never inline
 * inside a narrow column), Android in its own dialog, web as an input.
 */
export function timePickerPresentation(os: string): "sheet" | "dialog" | "web" {
  if (os === "web") return "web";
  return os === "ios" ? "sheet" : "dialog";
}

export function TimeField({
  label,
  value,
  onChangeValue,
  accessibilityLabel,
  placeholder = "Choose",
  hasError = false,
}: {
  label: string;
  value: string;
  onChangeValue: (value: string) => void;
  accessibilityLabel: string;
  placeholder?: string;
  hasError?: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date | null>(null);
  const presentation = timePickerPresentation(Platform.OS);
  if (presentation === "web") {
    return (
      <View style={styles.host}>
        <Text style={styles.label}>{label}</Text>
        <WebDateTimeInput
          type="time"
          value={value}
          hasError={hasError}
          ariaLabel={accessibilityLabel}
          onChangeValue={onChangeValue}
        />
      </View>
    );
  }
  const anchor = new Date();
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  anchor.setHours(match ? Number(match[1]) : 18, match ? Number(match[2]) : 0, 0, 0);
  const close = () => {
    setOpen(false);
    setDraft(null);
  };
  return (
    <View style={styles.host}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel}, currently ${value ? timeLabel(value) : "not set"}`}
        onPress={() => setOpen(true)}
        style={[styles.row, hasError && styles.rowError]}
      >
        <Text style={value ? styles.value : styles.placeholder}>
          {value ? timeLabel(value) : placeholder}
        </Text>
      </Pressable>
      {presentation === "sheet" ? (
        <ProgramSheet visible={open} onClose={close} snapPoint="half">
          <SheetBody
            title={accessibilityLabel}
            footer={
              <Button
                fullWidth
                label="Done"
                onPress={() => {
                  onChangeValue(hhmm(draft ?? anchor));
                  close();
                }}
              />
            }
          >
            {open ? (
              <DateTimePicker
                value={draft ?? anchor}
                mode="time"
                minuteInterval={15}
                display="spinner"
                themeVariant="dark"
                style={styles.spinner}
                onChange={(_event: DateTimePickerEvent, selected?: Date) => {
                  if (selected) setDraft(selected);
                }}
              />
            ) : null}
          </SheetBody>
        </ProgramSheet>
      ) : open ? (
        <DateTimePicker
          value={anchor}
          mode="time"
          minuteInterval={15}
          display="default"
          themeVariant="dark"
          onChange={(event: DateTimePickerEvent, selected?: Date) => {
            setOpen(false);
            if (event.type === "dismissed" || !selected) return;
            onChangeValue(hhmm(selected));
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: spacing.xxs, flex: 1 },
  label: { ...typography.bodySm, color: textTokens.secondary },
  row: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  rowError: { borderColor: semantic.error },
  value: { fontSize: 16, color: textTokens.primary },
  placeholder: { fontSize: 16, color: textTokens.quaternary },
  // Full width of the sheet body (inside its 16pt gutter), never wider.
  spinner: { alignSelf: "stretch", width: "100%" },
});
