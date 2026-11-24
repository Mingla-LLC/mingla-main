/**
 * Schedule picker for the Marketing Composer (#4523): one Mingla calendar
 * (date + time) on every platform. The browser date/time inputs, the
 * `showPicker()` bridge and the OS spinners this sheet used to carry are gone,
 * and so is the `.native.tsx` twin.
 */

import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Sheet } from "../../ui/Sheet";
import { HostDateTimeField } from "../../ui/HostCalendarFields";
import { color, space, type } from "../../../constants/designSystem";

export interface SchedulePickerSheetProps {
  visible: boolean;
  initialIso: string;
  onClose: () => void;
  onContinue: (iso: string) => void;
}

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

  useEffect(() => {
    if (visible) setValue(parseOrDefault(initialIso));
  }, [visible, initialIso]);

  const local = toLocalIso(value);

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="half">
      <View style={styles.host}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel scheduling"
            hitSlop={8}
            style={({ pressed }) => [styles.headerBtn, pressed ? styles.headerBtnPressed : null]}
          >
            <Text style={styles.headerBtnGhost}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Schedule send</Text>
          <Pressable
            onPress={() => onContinue(toLocalIso(value))}
            accessibilityRole="button"
            accessibilityLabel="Continue to review"
            hitSlop={8}
            style={({ pressed }) => [styles.headerBtn, pressed ? styles.headerBtnPressed : null]}
          >
            <Text style={styles.headerBtnPrimary}>Continue</Text>
          </Pressable>
        </View>

        <HostDateTimeField
          label="Send on"
          accessibilityLabel="Send date and time"
          value={{ date: local.slice(0, 10), time: local.slice(11, 16) }}
          min={toLocalIso(new Date()).slice(0, 10)}
          timeStepMinutes={15}
          onChangeValue={(next) => {
            const picked = new Date(`${next.date}T${next.time}`);
            if (!Number.isNaN(picked.getTime())) setValue(picked);
          }}
          testID="composer-schedule-datetime"
        />
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
});
