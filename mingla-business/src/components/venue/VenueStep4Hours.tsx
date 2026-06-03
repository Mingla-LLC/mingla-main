/**
 * Ve1 wizard — Step 4: Weekly hours (Mon–Sun).
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { BrandHourEntry } from "../../types/brand";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import { Button } from "../ui/Button";

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

function hmToDate(hm: string | null, fallbackHour: number): Date {
  const d = new Date(2020, 0, 1);
  if (hm === null || hm.length < 4) {
    d.setHours(fallbackHour, 0, 0, 0);
    return d;
  }
  const parts = hm.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    d.setHours(fallbackHour, 0, 0, 0);
    return d;
  }
  d.setHours(h, m, 0, 0);
  return d;
}

function dateToHm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export interface VenueStep4HoursProps {
  showErrors: boolean;
}

export const VenueStep4Hours: React.FC<VenueStep4HoursProps> = ({
  showErrors,
}) => {
  const hours = useDraftVenueStore((s) => s.hours);
  const setHoursRow = useDraftVenueStore((s) => s.setHoursRow);
  const setHoursRows = useDraftVenueStore((s) => s.setHoursRows);
  // WS3: days selected for the "apply to multiple" quick-set bar.
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set());
  const [picker, setPicker] = useState<{
    weekday: number;
    field: "open" | "close";
    temp: Date;
    // WS3: when present, the picked time applies to ALL these weekdays at once.
    bulk?: number[];
  } | null>(null);

  const toggleDay = useCallback((weekday: number): void => {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(weekday)) next.delete(weekday);
      else next.add(weekday);
      return next;
    });
  }, []);

  const openBulkPicker = useCallback(
    (field: "open" | "close"): void => {
      if (selectedDays.size === 0) return;
      setPicker({
        weekday: -1,
        field,
        temp: hmToDate(null, field === "open" ? 9 : 17),
        bulk: Array.from(selectedDays),
      });
    },
    [selectedDays],
  );

  const stepErr = useMemo((): string | null => {
    if (!showErrors) return null;
    for (const h of hours) {
      if (h.isClosed) continue;
      const o = h.openTime ?? "";
      const c = h.closeTime ?? "";
      if (o.length === 0 || c.length === 0) {
        return "Open and close times are required for open days.";
      }
      if (o >= c) return "Close time must be after open time.";
    }
    return null;
  }, [hours, showErrors]);

  const openPicker = useCallback(
    (weekday: number, field: "open" | "close", row: BrandHourEntry): void => {
      const hm = field === "open" ? row.openTime : row.closeTime;
      const fb = field === "open" ? 9 : 17;
      setPicker({
        weekday,
        field,
        temp: hmToDate(hm, fb),
      });
    },
    [],
  );

  const onPickerChange = useCallback(
    (_e: DateTimePickerEvent, selected?: Date): void => {
      if (Platform.OS === "android") {
        if (selected === undefined) {
          setPicker(null);
          return;
        }
        if (picker !== null) {
          const key = picker.field === "open" ? "openTime" : "closeTime";
          if (picker.bulk !== undefined) {
            // Applying a time to many days also marks them open.
            setHoursRows(picker.bulk, { isClosed: false, [key]: dateToHm(selected) });
          } else {
            setHoursRow(picker.weekday, { [key]: dateToHm(selected) });
          }
        }
        setPicker(null);
        return;
      }
      if (selected !== undefined && picker !== null) {
        setPicker({ ...picker, temp: selected });
      }
    },
    [picker, setHoursRow, setHoursRows],
  );

  const commitIos = useCallback((): void => {
    if (picker === null) return;
    const key = picker.field === "open" ? "openTime" : "closeTime";
    if (picker.bulk !== undefined) {
      setHoursRows(picker.bulk, { isClosed: false, [key]: dateToHm(picker.temp) });
    } else {
      setHoursRow(picker.weekday, { [key]: dateToHm(picker.temp) });
    }
    setPicker(null);
  }, [picker, setHoursRow, setHoursRows]);

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Opening hours</Text>
      <Text style={styles.helper}>Default: Mon–Sat 9–5, Sun closed.</Text>
      {stepErr !== null ? <Text style={styles.err}>{stepErr}</Text> : null}

      {/* WS3: set multiple days at once. Pick days, then apply one open/close
          time to all of them (or close them together). */}
      <View style={styles.bulkBar}>
        <Text style={styles.bulkTitle}>Set multiple days at once</Text>
        <View style={styles.bulkDayRow}>
          {DAY_NAMES.map((name, weekday) => {
            const on = selectedDays.has(weekday);
            return (
              <Pressable
                key={weekday}
                onPress={() => toggleDay(weekday)}
                accessibilityRole="button"
                accessibilityLabel={`${on ? "Deselect" : "Select"} ${name}`}
                style={[styles.bulkDayChip, on && styles.bulkDayChipOn]}
              >
                <Text style={[styles.bulkDayChipText, on && styles.bulkDayChipTextOn]}>
                  {name.slice(0, 1)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.bulkQuickRow}>
          <Pressable
            onPress={() => setSelectedDays(new Set([0, 1, 2, 3, 4]))}
            style={styles.bulkQuickBtn}
          >
            <Text style={styles.bulkQuickText}>Weekdays</Text>
          </Pressable>
          <Pressable
            onPress={() => setSelectedDays(new Set([5, 6]))}
            style={styles.bulkQuickBtn}
          >
            <Text style={styles.bulkQuickText}>Weekend</Text>
          </Pressable>
          <Pressable
            onPress={() => setSelectedDays(new Set([0, 1, 2, 3, 4, 5, 6]))}
            style={styles.bulkQuickBtn}
          >
            <Text style={styles.bulkQuickText}>All</Text>
          </Pressable>
          {selectedDays.size > 0 ? (
            <Pressable onPress={() => setSelectedDays(new Set())} style={styles.bulkQuickBtn}>
              <Text style={styles.bulkQuickText}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
        {selectedDays.size > 0 ? (
          <View style={styles.timeRow}>
            <Pressable
              style={styles.timeBtn}
              onPress={() => openBulkPicker("open")}
              accessibilityRole="button"
              accessibilityLabel="Set opening time for selected days"
            >
              <Text style={styles.timeLbl}>Set opens →</Text>
              <Text style={styles.timeVal}>{selectedDays.size} day{selectedDays.size === 1 ? "" : "s"}</Text>
            </Pressable>
            <Pressable
              style={styles.timeBtn}
              onPress={() => openBulkPicker("close")}
              accessibilityRole="button"
              accessibilityLabel="Set closing time for selected days"
            >
              <Text style={styles.timeLbl}>Set closes →</Text>
              <Text style={styles.timeVal}>{selectedDays.size} day{selectedDays.size === 1 ? "" : "s"}</Text>
            </Pressable>
            <Pressable
              style={styles.timeBtn}
              onPress={() => {
                setHoursRows(Array.from(selectedDays), {
                  isClosed: true,
                  openTime: null,
                  closeTime: null,
                });
              }}
              accessibilityRole="button"
              accessibilityLabel="Mark selected days closed"
            >
              <Text style={styles.timeLbl}>Mark closed</Text>
              <Text style={styles.timeVal}>{selectedDays.size} day{selectedDays.size === 1 ? "" : "s"}</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.bulkHint}>Pick days above, then set one time for all of them.</Text>
        )}
      </View>

      {hours.map((row) => (
        <View key={row.weekday} style={styles.dayRow}>
          <View style={styles.dayHead}>
            <Text style={styles.dayName}>{DAY_NAMES[row.weekday]}</Text>
            <Switch
              value={!row.isClosed}
              onValueChange={(on) =>
                setHoursRow(row.weekday, {
                  isClosed: !on,
                  openTime: on ? row.openTime ?? "09:00" : null,
                  closeTime: on ? row.closeTime ?? "17:00" : null,
                })
              }
              accessibilityLabel={`${DAY_NAMES[row.weekday]} open`}
            />
          </View>
          {!row.isClosed ? (
            <View style={styles.timeRow}>
              <Pressable
                style={styles.timeBtn}
                onPress={() => openPicker(row.weekday, "open", row)}
                accessibilityRole="button"
                accessibilityLabel={`Pick ${DAY_NAMES[row.weekday]} opening time`}
              >
                <Text style={styles.timeLbl}>Opens</Text>
                <Text style={styles.timeVal}>{row.openTime ?? "—"}</Text>
              </Pressable>
              <Pressable
                style={styles.timeBtn}
                onPress={() => openPicker(row.weekday, "close", row)}
                accessibilityRole="button"
                accessibilityLabel={`Pick ${DAY_NAMES[row.weekday]} closing time`}
              >
                <Text style={styles.timeLbl}>Closes</Text>
                <Text style={styles.timeVal}>{row.closeTime ?? "—"}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ))}

      {Platform.OS === "ios" && picker !== null ? (
        <Modal transparent visible animationType="fade">
          <View style={styles.iosBackdrop}>
            <View style={styles.iosSheet}>
              <View style={styles.iosDone}>
                <Button
                  label="Done"
                  variant="primary"
                  size="md"
                  onPress={commitIos}
                />
              </View>
              <DateTimePicker
                value={picker.temp}
                mode="time"
                display="spinner"
                onChange={onPickerChange}
                themeVariant="dark"
              />
            </View>
          </View>
        </Modal>
      ) : null}

      {Platform.OS === "android" && picker !== null ? (
        <DateTimePicker
          value={picker.temp}
          mode="time"
          display="default"
          onChange={onPickerChange}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  err: {
    fontSize: typography.caption.fontSize,
    color: "#EF4444",
  },
  bulkBar: {
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.sm,
  },
  bulkTitle: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  bulkDayRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  bulkDayChip: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  bulkDayChipOn: {
    borderColor: accent.warm,
    backgroundColor: accent.tint,
  },
  bulkDayChipText: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
    color: textTokens.secondary,
  },
  bulkDayChipTextOn: {
    color: textTokens.primary,
  },
  bulkQuickRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  bulkQuickBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radiusTokens.sm,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  bulkQuickText: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    fontWeight: "600",
  },
  bulkHint: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  dayRow: {
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  dayHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dayName: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  timeRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  timeBtn: {
    flex: 1,
    padding: spacing.sm,
    borderRadius: radiusTokens.sm,
    backgroundColor: accent.tint,
  },
  timeLbl: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
  },
  timeVal: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
    marginTop: 2,
  },
  iosBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  iosSheet: {
    backgroundColor: "#1a1a1e",
    paddingBottom: spacing.lg,
    borderTopLeftRadius: radiusTokens.lg,
    borderTopRightRadius: radiusTokens.lg,
  },
  iosDone: {
    alignItems: "flex-end",
    padding: spacing.md,
  },
});

export default VenueStep4Hours;
