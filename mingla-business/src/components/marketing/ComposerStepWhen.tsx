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

import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
// issue #1027 Thread B — the ONE shared visible-native-input for web date/time.
// Class 2 fix: @react-native-community/datetimepicker has NO web build, so the
// marketing send-schedule picker was broken on web.
import { HostDateTimeField } from "../ui/HostCalendarFields";

export type SendMode = "now" | "schedule";

export interface ComposerStepWhenProps {
  mode: SendMode;
  onModeChange: (mode: SendMode) => void;
  /** ISO datetime string in the brand's local zone. Empty string means unset. */
  scheduledForIso: string;
  onScheduledForChange: (value: string) => void;
  validationMessage?: string | null;
}

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
  const currentValue = useMemo(
    () => parseOrDefault(scheduledForIso),
    [scheduledForIso],
  );

  const hasValue = scheduledForIso.length > 0;

  return (
    <View style={styles.host}>
      {/* F.8: dropped "STEP 3 — WHEN" label + replaced two large radio rows
          with a compact 2-pill segmented control per ORCH-0864 brief. */}
      <View
        style={styles.segmented}
        accessibilityRole="radiogroup"
        accessibilityLabel="When to send"
      >
        <Pressable
          onPress={() => onModeChange("now")}
          accessibilityRole="radio"
          accessibilityLabel="Send now"
          accessibilityState={{ selected: mode === "now" }}
          style={({ pressed }) => [
            styles.segmentedPill,
            mode === "now" ? styles.segmentedPillActive : null,
            pressed ? styles.segmentedPillPressed : null,
          ]}
        >
          <Text
            style={[
              styles.segmentedLabel,
              mode === "now" ? styles.segmentedLabelActive : null,
            ]}
          >
            Send now
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onModeChange("schedule")}
          accessibilityRole="radio"
          accessibilityLabel="Schedule for later"
          accessibilityState={{ selected: mode === "schedule" }}
          style={({ pressed }) => [
            styles.segmentedPill,
            mode === "schedule" ? styles.segmentedPillActive : null,
            pressed ? styles.segmentedPillPressed : null,
          ]}
        >
          <Text
            style={[
              styles.segmentedLabel,
              mode === "schedule" ? styles.segmentedLabelActive : null,
            ]}
          >
            Schedule
          </Text>
        </Pressable>
      </View>
      {mode === "schedule" ? (
        <View style={styles.scheduleHost}>
          <HostDateTimeField
            label="Send on"
            accessibilityLabel="Send date and time"
            placeholder="Pick date and time"
            value={{
              date: hasValue ? toLocalIso(currentValue).slice(0, 10) : "",
              time: hasValue ? toLocalIso(currentValue).slice(11, 16) : "",
            }}
            min={toLocalIso(new Date()).slice(0, 10)}
            timeStepMinutes={15}
            onChangeValue={(next) => onScheduledForChange(`${next.date}T${next.time}`)}
            testID="composer-when-datetime"
          />
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
    gap: space[1],
  },
  // F.8: compact segmented control replacing two large radio rows.
  segmented: {
    flexDirection: "row",
    borderRadius: radius.full,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    padding: 2,
  },
  segmentedPill: {
    flex: 1,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  segmentedPillActive: {
    backgroundColor: color.fill.tabOn,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.accent,
  },
  segmentedPillPressed: {
    opacity: 0.85,
  },
  segmentedLabel: {
    ...type.small,
    color: color.text2,
    fontWeight: "600",
  },
  segmentedLabelActive: {
    color: color.text1,
  },
  scheduleHost: {
    gap: space[2],
    marginTop: space[1],
  },
  pillRow: {
    flexDirection: "row",
    gap: space[2],
  },
  // issue #1027 Thread B — web date/time cell (label + visible native input).
  webPickerCell: {
    flex: 1,
    gap: 4,
  },
  pickerPill: {
    flex: 1,
    minHeight: 44, // F.8: was 56
    paddingHorizontal: space[4],
    paddingVertical: space[1], // F.8: was spacing.sm
    borderRadius: radius.md, // F.8: was radius.lg
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    gap: 2,
  },
  pickerPillActive: {
    borderColor: color.lineStrong,
    backgroundColor: color.fill.tabOn,
  },
  pickerPillPressed: {
    opacity: 0.85,
  },
  pickerPillLabel: {
    ...type.label,
    color: color.text3,
  },
  pickerPillValue: {
    ...type.body,
    color: color.text1,
    fontWeight: "600",
  },
  pickerHost: {
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    paddingVertical: space[2],
    alignItems: "center",
  },
  doneBtn: {
    marginTop: space[1],
    paddingHorizontal: space[6],
    paddingVertical: space[1],
    borderRadius: radius.full,
    // #4420: the one primary of the view is Paper with ink text.
    backgroundColor: color.paper,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  doneBtnPressed: {
    opacity: 0.85,
  },
  doneBtnLabel: {
    ...type.small,
    color: color.ink,
    fontWeight: "600",
  },
  helperText: {
    ...type.small,
    color: color.text3,
  },
  validationMessage: {
    ...type.small,
    color: color.text1,
  },
});
