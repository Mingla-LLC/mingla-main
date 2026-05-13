/**
 * ComposerStepWhen — Step 3. Send-now vs Schedule radio + native datetime
 * picker (`@react-native-community/datetimepicker` 8.4.4, already in the
 * project's dependency tree).
 *
 * UX:
 *   - iOS: tapping the date/time pill opens an inline spinner picker
 *     beneath the pill (`display="inline"` on iOS 14+).
 *   - Android: tapping opens the native modal picker dialog.
 *
 * Operator picks date first, then time — two separate Pressables that each
 * surface a DateTimePicker in `date` or `time` mode. The component owns the
 * "is the picker visible" state internally and emits the merged ISO string
 * upstream via `onScheduledForChange`.
 *
 * Helper text: "Brand's local time · best between 10am–2pm".
 */

import React, { useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export type SendMode = "now" | "schedule";

export interface ComposerStepWhenProps {
  mode: SendMode;
  onModeChange: (mode: SendMode) => void;
  /** ISO datetime string in the brand's local zone. Empty string means unset. */
  scheduledForIso: string;
  onScheduledForChange: (value: string) => void;
  validationMessage?: string | null;
}

type PickerVisible = "none" | "date" | "time";

function parseOrDefault(iso: string): Date {
  if (iso.length === 0) {
    // Default to "now + 1 hour, rounded to next 15 min" — a sensible
    // first guess when the operator just toggled into Schedule mode.
    const d = new Date();
    d.setHours(d.getHours() + 1);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    return d;
  }
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function formatDateLabel(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimeLabel(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function toLocalIso(d: Date): string {
  // Strip seconds + milliseconds for a clean ISO that round-trips through
  // `new Date(...)` in both the DB and other clients. Treat the value as
  // wall-clock local time — Postgres timestamptz interprets the offset
  // when the row is inserted; the operator intent is "the brand's clock".
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const ComposerStepWhen: React.FC<ComposerStepWhenProps> = ({
  mode,
  onModeChange,
  scheduledForIso,
  onScheduledForChange,
  validationMessage,
}) => {
  const [pickerVisible, setPickerVisible] = useState<PickerVisible>("none");
  const currentValue = useMemo(
    () => parseOrDefault(scheduledForIso),
    [scheduledForIso],
  );

  const handleChange = (kind: "date" | "time") =>
    (event: DateTimePickerEvent, selected?: Date) => {
      // Android: 'set' on confirm, 'dismissed' on cancel. iOS: only 'set'.
      if (Platform.OS === "android") setPickerVisible("none");
      if (event.type === "dismissed") return;
      if (selected === undefined) return;
      const next = new Date(currentValue);
      if (kind === "date") {
        next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
      } else {
        next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
      }
      onScheduledForChange(toLocalIso(next));
    };

  const hasValue = scheduledForIso.length > 0;
  const dateLabel = hasValue ? formatDateLabel(currentValue) : "Pick date";
  const timeLabel = hasValue ? formatTimeLabel(currentValue) : "Pick time";

  return (
    <View style={styles.host}>
      <Text style={styles.stepLabel} accessibilityRole="header">STEP 3 — WHEN</Text>
      <Pressable
        onPress={() => onModeChange("now")}
        accessibilityRole="radio"
        accessibilityLabel="Send now"
        accessibilityState={{ selected: mode === "now" }}
        style={({ pressed }) => [
          styles.radioRow,
          mode === "now" ? styles.radioRowActive : null,
          pressed ? styles.radioRowPressed : null,
        ]}
      >
        <View style={[styles.radio, mode === "now" ? styles.radioActive : null]} />
        <Text style={styles.radioLabel}>Send now</Text>
      </Pressable>
      <Pressable
        onPress={() => onModeChange("schedule")}
        accessibilityRole="radio"
        accessibilityLabel="Schedule for later"
        accessibilityState={{ selected: mode === "schedule" }}
        style={({ pressed }) => [
          styles.radioRow,
          mode === "schedule" ? styles.radioRowActive : null,
          pressed ? styles.radioRowPressed : null,
        ]}
      >
        <View style={[styles.radio, mode === "schedule" ? styles.radioActive : null]} />
        <Text style={styles.radioLabel}>Schedule</Text>
      </Pressable>
      {mode === "schedule" ? (
        <View style={styles.scheduleHost}>
          <View style={styles.pillRow}>
            <Pressable
              onPress={() =>
                setPickerVisible(pickerVisible === "date" ? "none" : "date")
              }
              accessibilityRole="button"
              accessibilityLabel={`Send date: ${dateLabel}`}
              style={({ pressed }) => [
                styles.pickerPill,
                pickerVisible === "date" ? styles.pickerPillActive : null,
                pressed ? styles.pickerPillPressed : null,
              ]}
            >
              <Text style={styles.pickerPillLabel}>Date</Text>
              <Text style={styles.pickerPillValue}>{dateLabel}</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                setPickerVisible(pickerVisible === "time" ? "none" : "time")
              }
              accessibilityRole="button"
              accessibilityLabel={`Send time: ${timeLabel}`}
              style={({ pressed }) => [
                styles.pickerPill,
                pickerVisible === "time" ? styles.pickerPillActive : null,
                pressed ? styles.pickerPillPressed : null,
              ]}
            >
              <Text style={styles.pickerPillLabel}>Time</Text>
              <Text style={styles.pickerPillValue}>{timeLabel}</Text>
            </Pressable>
          </View>
          {pickerVisible !== "none" ? (
            <View style={styles.pickerHost}>
              <DateTimePicker
                value={currentValue}
                mode={pickerVisible}
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={handleChange(pickerVisible)}
                themeVariant="dark"
                minimumDate={pickerVisible === "date" ? new Date() : undefined}
              />
              {Platform.OS === "ios" ? (
                <Pressable
                  onPress={() => setPickerVisible("none")}
                  accessibilityRole="button"
                  accessibilityLabel="Done picking"
                  style={({ pressed }) => [
                    styles.doneBtn,
                    pressed ? styles.doneBtnPressed : null,
                  ]}
                >
                  <Text style={styles.doneBtnLabel}>Done</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {validationMessage !== null && validationMessage !== undefined ? (
            <Text style={styles.validationMessage}>{validationMessage}</Text>
          ) : (
            <Text style={styles.helperText}>
              Brand's local time · best between 10am–2pm.
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.xs,
  },
  stepLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    marginBottom: spacing.xs,
  },
  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  radioRowActive: {
    borderColor: accent.border,
    backgroundColor: "rgba(235, 120, 37, 0.12)",
  },
  radioRowPressed: {
    opacity: 0.85,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: textTokens.secondary,
  },
  radioActive: {
    borderColor: accent.warm,
    backgroundColor: accent.warm,
  },
  radioLabel: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "500",
  },
  scheduleHost: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  pillRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  pickerPill: {
    flex: 1,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    gap: 2,
  },
  pickerPillActive: {
    borderColor: accent.border,
    backgroundColor: "rgba(235, 120, 37, 0.12)",
  },
  pickerPillPressed: {
    opacity: 0.85,
  },
  pickerPillLabel: {
    ...typography.labelCap,
    color: textTokens.tertiary,
  },
  pickerPillValue: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "600",
  },
  pickerHost: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  doneBtn: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: "rgba(235, 120, 37, 0.42)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  doneBtnPressed: {
    opacity: 0.85,
  },
  doneBtnLabel: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "600",
  },
  helperText: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
  validationMessage: {
    ...typography.bodySm,
    color: accent.warm,
  },
});
