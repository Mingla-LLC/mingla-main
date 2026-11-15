/**
 * ORCH-1092: web schedule picker for Marketing Composer.
 *
 * Native keeps the spinner implementation in SchedulePickerSheet.native.tsx.
 * Web uses hidden browser-native date/time inputs triggered from the same
 * visible pills, keeping @react-native-community/datetimepicker out of the
 * reopened composer route.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Sheet } from "../../ui/Sheet";
import { color, radius, space, type } from "../../../constants/designSystem";

export interface SchedulePickerSheetProps {
  visible: boolean;
  initialIso: string;
  onClose: () => void;
  onContinue: (iso: string) => void;
}

type PickerMode = "date" | "time";

const HIDDEN_WEB_INPUT_STYLE = {
  position: "absolute",
  width: 1,
  height: 1,
  opacity: 0,
  pointerEvents: "none",
} as const;

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

function dateInputValue(d: Date): string {
  const pad = (n: number): string => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeInputValue(d: Date): string {
  const pad = (n: number): string => `${n}`.padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openNativeInput(input: HTMLInputElement | null): void {
  if (input === null) return;
  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
      return;
    } catch {
      input.click();
      return;
    }
  }
  input.click();
}

export const SchedulePickerSheet: React.FC<SchedulePickerSheetProps> = ({
  visible,
  initialIso,
  onClose,
  onContinue,
}) => {
  const [value, setValue] = useState<Date>(() => parseOrDefault(initialIso));
  const [mode, setMode] = useState<PickerMode>("date");
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const timeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (visible) {
      setValue(parseOrDefault(initialIso));
      setMode("date");
    }
  }, [visible, initialIso]);

  const dateLabel = useMemo(() => formatDateLabel(value), [value]);
  const timeLabel = useMemo(() => formatTimeLabel(value), [value]);
  const dateValue = useMemo(() => dateInputValue(value), [value]);
  const timeValue = useMemo(() => timeInputValue(value), [value]);

  const handleOpenPicker = (nextMode: PickerMode): void => {
    setMode(nextMode);
    openNativeInput(nextMode === "date" ? dateInputRef.current : timeInputRef.current);
  };

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="half">
      <View style={styles.host}>
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
            onPress={() => handleOpenPicker("date")}
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
            onPress={() => handleOpenPicker("time")}
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

        <View style={styles.webInputHost}>
          <input
            ref={dateInputRef}
            type="date"
            value={dateValue}
            min={dateInputValue(new Date())}
            onChange={(event) => {
              const nextValue = (event.target as HTMLInputElement).value;
              if (nextValue.length === 0) return;
              const [year, month, day] = nextValue.split("-").map(Number);
              const next = new Date(value);
              next.setFullYear(year, month - 1, day);
              setValue(next);
            }}
            aria-label="Send date"
            style={HIDDEN_WEB_INPUT_STYLE}
          />
          <input
            ref={timeInputRef}
            type="time"
            value={timeValue}
            onChange={(event) => {
              const nextValue = (event.target as HTMLInputElement).value;
              if (nextValue.length === 0) return;
              const [hour, minute] = nextValue.split(":").map(Number);
              const next = new Date(value);
              next.setHours(hour, minute, 0, 0);
              setValue(next);
            }}
            aria-label="Send time"
            style={HIDDEN_WEB_INPUT_STYLE}
          />
        </View>
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: space[4],
    paddingTop: space[1],
    paddingBottom: space[4],
    gap: space[4],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.lineStrong,
  },
  headerBtn: {
    minHeight: 32,
    paddingHorizontal: space[1],
    justifyContent: "center",
  },
  headerBtnPressed: {
    opacity: 0.6,
  },
  headerBtnGhost: {
    ...type.body,
    color: color.text2,
    fontWeight: "500",
  },
  headerBtnPrimary: {
    ...type.body,
    color: color.text1,
    fontWeight: "700",
  },
  headerTitle: {
    ...type.row,
    color: color.text1,
    fontWeight: "600",
  },
  pillRow: {
    flexDirection: "row",
    gap: space[2],
  },
  pickerPill: {
    flex: 1,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.inset,
    gap: 2,
  },
  pickerPillActive: {
    borderColor: color.lineStrong,
    backgroundColor: color.fill.tabOn,
  },
  pickerPillPressed: {
    opacity: 0.8,
  },
  pickerPillLabel: {
    ...type.caption,
    color: color.text3,
  },
  pickerPillValue: {
    ...type.body,
    color: color.text1,
    fontWeight: "600",
  },
  webInputHost: {
    minHeight: 1,
  },
});
