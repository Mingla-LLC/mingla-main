/**
 * ORCH-1186-A — controlled, reusable 7-day opening-hours editor extracted from
 * VenueStep4Hours (subtract-before-adding: one editor, two consumers — the
 * creation wizard draft + the live venue Settings tab).
 *
 * Props are fully controlled: the host owns the `hours` array and receives every
 * change via `onChange`. No store coupling lives here (the wizard wrapper binds
 * the draft store; Settings binds a local draft + the upsert mutation).
 *
 * Per-platform time control (D.3/D.10):
 *  - iOS: DateTimePicker spinner in a fade Modal.
 *  - Android: DateTimePicker display="default" dialog.
 *  - Web: a native <input type="time"> field (RN-web passes unknown props to the
 *    DOM node) — the iOS/Android DateTimePicker has no web spinner.
 *
 * The 34px bulk day-chips carry hitSlop to reach a ≥44pt effective target (D.9).
 * This component does NOT carry the wizard host's outer padding — the GlassCard
 * (Settings) / the wizard wrapper supply their own padding.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
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

const IS_WEB = Platform.OS === "web";

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

/** Normalize a web <input type="time"> value (already "HH:MM") defensively. */
function normalizeHm(raw: string): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(raw.trim());
  if (m === null) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export interface BrandHoursEditorProps {
  hours: BrandHourEntry[];
  onChange: (next: BrandHourEntry[]) => void;
  showErrors?: boolean;
  /** Disable all controls (non-manager / saving). */
  disabled?: boolean;
}

export const BrandHoursEditor: React.FC<BrandHoursEditorProps> = ({
  hours,
  onChange,
  showErrors = false,
  disabled = false,
}) => {
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set());
  const [picker, setPicker] = useState<{
    weekday: number;
    field: "open" | "close";
    temp: Date;
    bulk?: number[];
  } | null>(null);

  // ----- controlled mutators (replace the old store setters) -----------------
  const setHoursRow = useCallback(
    (weekday: number, patch: Partial<BrandHourEntry>): void => {
      onChange(
        hours.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)),
      );
    },
    [hours, onChange],
  );

  const setHoursRows = useCallback(
    (weekdays: number[], patch: Partial<BrandHourEntry>): void => {
      const targets = new Set(weekdays);
      onChange(
        hours.map((r) => (targets.has(r.weekday) ? { ...r, ...patch } : r)),
      );
    },
    [hours, onChange],
  );

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
      if (disabled) return;
      const hm = field === "open" ? row.openTime : row.closeTime;
      const fb = field === "open" ? 9 : 17;
      setPicker({ weekday, field, temp: hmToDate(hm, fb) });
    },
    [disabled],
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

  // ----- web time control: commit an HH:MM straight to the row ---------------
  const onWebTime = useCallback(
    (weekday: number, field: "open" | "close", raw: string): void => {
      const hm = normalizeHm(raw);
      if (hm === null) return;
      const key = field === "open" ? "openTime" : "closeTime";
      setHoursRow(weekday, { isClosed: false, [key]: hm });
    },
    [setHoursRow],
  );

  const onWebBulkTime = useCallback(
    (field: "open" | "close", raw: string): void => {
      const hm = normalizeHm(raw);
      if (hm === null || selectedDays.size === 0) return;
      const key = field === "open" ? "openTime" : "closeTime";
      setHoursRows(Array.from(selectedDays), { isClosed: false, [key]: hm });
    },
    [selectedDays, setHoursRows],
  );

  return (
    <View style={styles.host}>
      {stepErr !== null ? <Text style={styles.err}>{stepErr}</Text> : null}

      {/* Set multiple days at once. */}
      <View style={styles.bulkBar}>
        <Text style={styles.bulkTitle}>Set multiple days at once</Text>
        <View style={styles.bulkDayRow}>
          {DAY_NAMES.map((name, weekday) => {
            const on = selectedDays.has(weekday);
            return (
              <Pressable
                key={weekday}
                onPress={() => toggleDay(weekday)}
                disabled={disabled}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
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
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Select weekdays"
            style={styles.bulkQuickBtn}
          >
            <Text style={styles.bulkQuickText}>Weekdays</Text>
          </Pressable>
          <Pressable
            onPress={() => setSelectedDays(new Set([5, 6]))}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Select weekend"
            style={styles.bulkQuickBtn}
          >
            <Text style={styles.bulkQuickText}>Weekend</Text>
          </Pressable>
          <Pressable
            onPress={() => setSelectedDays(new Set([0, 1, 2, 3, 4, 5, 6]))}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Select all days"
            style={styles.bulkQuickBtn}
          >
            <Text style={styles.bulkQuickText}>All</Text>
          </Pressable>
          {selectedDays.size > 0 ? (
            <Pressable
              onPress={() => setSelectedDays(new Set())}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel="Clear day selection"
              style={styles.bulkQuickBtn}
            >
              <Text style={styles.bulkQuickText}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
        {selectedDays.size > 0 ? (
          IS_WEB ? (
            <View style={styles.timeRow}>
              <View style={styles.timeBtn}>
                <Text style={styles.timeLbl}>Opens (all selected)</Text>
                <WebTimeInput
                  value={null}
                  disabled={disabled}
                  onCommit={(v) => onWebBulkTime("open", v)}
                  ariaLabel="Set opening time for selected days"
                />
              </View>
              <View style={styles.timeBtn}>
                <Text style={styles.timeLbl}>Closes (all selected)</Text>
                <WebTimeInput
                  value={null}
                  disabled={disabled}
                  onCommit={(v) => onWebBulkTime("close", v)}
                  ariaLabel="Set closing time for selected days"
                />
              </View>
              <Pressable
                style={styles.timeBtn}
                disabled={disabled}
                onPress={() =>
                  setHoursRows(Array.from(selectedDays), {
                    isClosed: true,
                    openTime: null,
                    closeTime: null,
                  })
                }
                accessibilityRole="button"
                accessibilityLabel="Mark selected days closed"
              >
                <Text style={styles.timeLbl}>Mark closed</Text>
                <Text style={styles.timeVal}>{selectedDays.size} day{selectedDays.size === 1 ? "" : "s"}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.timeRow}>
              <Pressable
                style={styles.timeBtn}
                disabled={disabled}
                onPress={() => openBulkPicker("open")}
                accessibilityRole="button"
                accessibilityLabel="Set opening time for selected days"
              >
                <Text style={styles.timeLbl}>Set opens →</Text>
                <Text style={styles.timeVal}>{selectedDays.size} day{selectedDays.size === 1 ? "" : "s"}</Text>
              </Pressable>
              <Pressable
                style={styles.timeBtn}
                disabled={disabled}
                onPress={() => openBulkPicker("close")}
                accessibilityRole="button"
                accessibilityLabel="Set closing time for selected days"
              >
                <Text style={styles.timeLbl}>Set closes →</Text>
                <Text style={styles.timeVal}>{selectedDays.size} day{selectedDays.size === 1 ? "" : "s"}</Text>
              </Pressable>
              <Pressable
                style={styles.timeBtn}
                disabled={disabled}
                onPress={() =>
                  setHoursRows(Array.from(selectedDays), {
                    isClosed: true,
                    openTime: null,
                    closeTime: null,
                  })
                }
                accessibilityRole="button"
                accessibilityLabel="Mark selected days closed"
              >
                <Text style={styles.timeLbl}>Mark closed</Text>
                <Text style={styles.timeVal}>{selectedDays.size} day{selectedDays.size === 1 ? "" : "s"}</Text>
              </Pressable>
            </View>
          )
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
              disabled={disabled}
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
              {IS_WEB ? (
                <>
                  <View style={styles.timeBtn}>
                    <Text style={styles.timeLbl}>Opens</Text>
                    <WebTimeInput
                      value={row.openTime}
                      disabled={disabled}
                      onCommit={(v) => onWebTime(row.weekday, "open", v)}
                      ariaLabel={`${DAY_NAMES[row.weekday]} opening time`}
                    />
                  </View>
                  <View style={styles.timeBtn}>
                    <Text style={styles.timeLbl}>Closes</Text>
                    <WebTimeInput
                      value={row.closeTime}
                      disabled={disabled}
                      onCommit={(v) => onWebTime(row.weekday, "close", v)}
                      ariaLabel={`${DAY_NAMES[row.weekday]} closing time`}
                    />
                  </View>
                </>
              ) : (
                <>
                  <Pressable
                    style={styles.timeBtn}
                    disabled={disabled}
                    onPress={() => openPicker(row.weekday, "open", row)}
                    accessibilityRole="button"
                    accessibilityLabel={`Pick ${DAY_NAMES[row.weekday]} opening time`}
                  >
                    <Text style={styles.timeLbl}>Opens</Text>
                    <Text style={styles.timeVal}>{row.openTime ?? "—"}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.timeBtn}
                    disabled={disabled}
                    onPress={() => openPicker(row.weekday, "close", row)}
                    accessibilityRole="button"
                    accessibilityLabel={`Pick ${DAY_NAMES[row.weekday]} closing time`}
                  >
                    <Text style={styles.timeLbl}>Closes</Text>
                    <Text style={styles.timeVal}>{row.closeTime ?? "—"}</Text>
                  </Pressable>
                </>
              )}
            </View>
          ) : null}
        </View>
      ))}

      {Platform.OS === "ios" && picker !== null ? (
        <Modal transparent visible animationType="fade">
          <View style={styles.iosBackdrop}>
            <View style={styles.iosSheet}>
              <View style={styles.iosDone}>
                <Button label="Done" variant="primary" size="md" onPress={commitIos} />
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

/**
 * Web-only time control. RN-web forwards unknown DOM props on a TextInput, so an
 * `inputMode`/`type="time"` HTML input is rendered. Commits the value on change
 * (web pickers fire onChangeText with a complete "HH:MM").
 */
interface WebTimeInputProps {
  value: string | null;
  disabled: boolean;
  onCommit: (raw: string) => void;
  ariaLabel: string;
}

function WebTimeInput({
  value,
  disabled,
  onCommit,
  ariaLabel,
}: WebTimeInputProps): React.ReactElement {
  const [local, setLocal] = useState<string>(value ?? "");
  return (
    <TextInput
      // RN-web maps these onto the underlying <input>.
      {...({ type: "time" } as object)}
      value={local}
      editable={!disabled}
      placeholder="--:--"
      placeholderTextColor={textTokens.quaternary}
      accessibilityLabel={ariaLabel}
      onChangeText={(t) => {
        setLocal(t);
        onCommit(t);
      }}
      style={styles.webTimeInput}
    />
  );
}

const styles = StyleSheet.create({
  host: {
    gap: spacing.sm,
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
  webTimeInput: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
    marginTop: 2,
    paddingVertical: 2,
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

export default BrandHoursEditor;
