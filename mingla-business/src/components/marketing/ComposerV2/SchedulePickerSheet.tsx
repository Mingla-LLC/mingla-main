/**
 * ORCH-0864 [Marketing Composer V2] Stage F.10b — SchedulePickerSheet.
 *
 * Bottom sheet with a date + time picker. Opens from the new footer
 * "Schedule" button. After the operator picks a date and time and taps
 * Continue, the parent (compose.tsx) sets sendMode="schedule" + the
 * scheduledForIso, then opens the review-confirmation sheet.
 *
 * Mirrors the picker UX from the legacy ComposerStepWhen (iOS spinner
 * + date / time pill toggle) but isolated as a one-shot sheet rather
 * than always-mounted form. Compact + dismissible.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";

import { Sheet } from "../../ui/Sheet";
import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";

export interface SchedulePickerSheetProps {
  visible: boolean;
  /** Existing scheduledForIso (if any) — seeds the picker on open. */
  initialIso: string;
  onClose: () => void;
  /** Fires when operator taps Continue. Receives a local ISO string. */
  onContinue: (iso: string) => void;
}

type PickerMode = "date" | "time";

function defaultDate(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 1);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return d;
}

function parseOrDefault(iso: string): Date {
  if (iso.length === 0) return defaultDate();
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? defaultDate() : parsed;
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
  const pad = (n: number): string => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const SchedulePickerSheet: React.FC<SchedulePickerSheetProps> = ({
  visible,
  initialIso,
  onClose,
  onContinue,
}) => {
  const [value, setValue] = useState<Date>(() => parseOrDefault(initialIso));
  const [mode, setMode] = useState<PickerMode>("date");

  // Re-seed when the sheet reopens — operator may have picked a different
  // date in a prior session and the parent passed the new initialIso.
  useEffect(() => {
    if (visible) {
      setValue(parseOrDefault(initialIso));
      setMode("date");
    }
  }, [visible, initialIso]);

  const dateLabel = useMemo(() => formatDateLabel(value), [value]);
  const timeLabel = useMemo(() => formatTimeLabel(value), [value]);

  const handleChange = (
    event: DateTimePickerEvent,
    selected?: Date,
  ): void => {
    if (event.type === "dismissed") return;
    if (selected === undefined) return;
    const next = new Date(value);
    if (mode === "date") {
      next.setFullYear(
        selected.getFullYear(),
        selected.getMonth(),
        selected.getDate(),
      );
    } else {
      next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    }
    setValue(next);
  };

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="half">
      <View style={styles.host}>
        {/* F.10b: pinned-top header with Cancel / Continue so the actions
            stay visible regardless of how tall the iOS spinner expands.
            Mirrors iOS native picker UX (Cancel left, Done right). */}
        <View style={styles.headerRow}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel scheduling"
            hitSlop={8}
            style={({ pressed }) => [
              styles.headerBtn,
              pressed ? styles.headerBtnPressed : null,
            ]}
          >
            <Text style={styles.headerBtnGhost}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Schedule send</Text>
          <Pressable
            onPress={() => onContinue(toLocalIso(value))}
            accessibilityRole="button"
            accessibilityLabel="Continue to review"
            hitSlop={8}
            style={({ pressed }) => [
              styles.headerBtn,
              pressed ? styles.headerBtnPressed : null,
            ]}
          >
            <Text style={styles.headerBtnPrimary}>Continue</Text>
          </Pressable>
        </View>

        <View style={styles.pillRow}>
          <Pressable
            onPress={() => setMode("date")}
            accessibilityRole="button"
            accessibilityLabel={`Send date: ${dateLabel}`}
            style={({ pressed }) => [
              styles.pickerPill,
              mode === "date" ? styles.pickerPillActive : null,
              pressed ? styles.pickerPillPressed : null,
            ]}
          >
            <Text style={styles.pickerPillLabel}>Date</Text>
            <Text style={styles.pickerPillValue}>{dateLabel}</Text>
          </Pressable>
          <Pressable
            onPress={() => setMode("time")}
            accessibilityRole="button"
            accessibilityLabel={`Send time: ${timeLabel}`}
            style={({ pressed }) => [
              styles.pickerPill,
              mode === "time" ? styles.pickerPillActive : null,
              pressed ? styles.pickerPillPressed : null,
            ]}
          >
            <Text style={styles.pickerPillLabel}>Time</Text>
            <Text style={styles.pickerPillValue}>{timeLabel}</Text>
          </Pressable>
        </View>

        <View style={styles.pickerHost}>
          <DateTimePicker
            value={value}
            mode={mode}
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={handleChange}
            themeVariant="dark"
            minimumDate={mode === "date" ? new Date() : undefined}
          />
        </View>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  // F.10b: pinned-top action header replacing the old title + subtitle +
  // bottom actions row pattern. Keeps Cancel / Continue always visible
  // even when the iOS spinner picker takes ~250pt vertical space.
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.chrome,
  },
  headerBtn: {
    minHeight: 32,
    paddingHorizontal: spacing.xs,
    justifyContent: "center",
  },
  headerBtnPressed: {
    opacity: 0.6,
  },
  headerBtnGhost: {
    ...typography.body,
    color: textTokens.secondary,
    fontWeight: "500",
  },
  headerBtnPrimary: {
    ...typography.body,
    color: accent.warm,
    fontWeight: "700",
  },
  headerTitle: {
    ...typography.bodyLg,
    color: textTokens.primary,
    fontWeight: "600",
  },
  pillRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  pickerPill: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
    backgroundColor: glass.tint.profileBase,
    gap: 2,
  },
  pickerPillActive: {
    borderColor: accent.warm,
    backgroundColor: accent.tint,
  },
  pickerPillPressed: {
    opacity: 0.8,
  },
  pickerPillLabel: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  pickerPillValue: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "600",
  },
  pickerHost: {
    alignItems: "center",
    justifyContent: "center",
  },
});
