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
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";

import {
  radius as radiusTokens,
  color,
  space,
  type,
  scrim,
} from "../../constants/designSystem";
import type { BrandHourEntry, BrandHourWindow } from "../../types/brand";
import { hoursWeekIssue } from "../../utils/venueBrandHours";
import { BrandSwitch } from "../ui/BrandSwitch";
import { Button } from "../ui/Button";
import { TimeField } from "../ui/TimeField";

/** #4490 — up to four windows a day (window 0 + three extras). */
const MAX_EXTRA_WINDOWS = 3;

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
  /**
   * #4490 — several windows a day (split shifts, "Add a window"). Off for the
   * create wizard, whose RPC takes one window a day.
   */
  allowWindows?: boolean;
}

export const BrandHoursEditor: React.FC<BrandHoursEditorProps> = ({
  hours,
  onChange,
  showErrors = false,
  disabled = false,
  allowWindows = false,
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
    if (allowWindows) return hoursWeekIssue(hours);
    for (const h of hours) {
      if (h.isClosed) continue;
      const o = h.openTime ?? "";
      const c = h.closeTime ?? "";
      if (o.length === 0 || c.length === 0) {
        return "Open and close times are required for open days.";
      }
      // ORCH-1263 D-D — overnight (close < open) is valid; only equality is
      // rejected (DESIGN §6.3 copy; 24h venues are out of scope).
      if (o === c) return "Open and close can't be the same time.";
    }
    return null;
  }, [allowWindows, hours, showErrors]);

  // #4490 — extra windows (2nd..4th) of one day.
  const setExtraWindow = useCallback(
    (weekday: number, index: number, patch: Partial<BrandHourWindow>): void => {
      onChange(
        hours.map((r) => {
          if (r.weekday !== weekday) return r;
          const extras = [...(r.extraWindows ?? [])];
          const current = extras[index];
          if (current === undefined) return r;
          extras[index] = { ...current, ...patch };
          return { ...r, extraWindows: extras };
        }),
      );
    },
    [hours, onChange],
  );
  const addExtraWindow = useCallback(
    (weekday: number): void => {
      onChange(
        hours.map((r) => {
          if (r.weekday !== weekday) return r;
          const extras = r.extraWindows ?? [];
          if (extras.length >= MAX_EXTRA_WINDOWS) return r;
          // Start the new window an hour after the last one closes.
          const last = extras.length > 0 ? extras[extras.length - 1] : { openTime: r.openTime, closeTime: r.closeTime };
          const lastClose = /^(\d{2}):(\d{2})/.exec(last.closeTime ?? "");
          const startHour = lastClose !== null ? (Number(lastClose[1]) + 1) % 24 : 18;
          const open = `${String(startHour).padStart(2, "0")}:00`;
          const close = `${String((startHour + 3) % 24).padStart(2, "0")}:00`;
          return { ...r, extraWindows: [...extras, { openTime: open, closeTime: close }] };
        }),
      );
    },
    [hours, onChange],
  );
  const removeExtraWindow = useCallback(
    (weekday: number, index: number): void => {
      onChange(
        hours.map((r) =>
          r.weekday !== weekday
            ? r
            : { ...r, extraWindows: (r.extraWindows ?? []).filter((_, i) => i !== index) },
        ),
      );
    },
    [hours, onChange],
  );

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

      {hours.map((row) => {
        // ORCH-1263 D-D display contract (DESIGN §6.3): close <= open on an
        // open day with both times set = an OVERNIGHT span — say "next day"
        // in plain words inside the Closes control (no "+1" jargon).
        const isOvernight =
          !row.isClosed &&
          (row.openTime ?? "").length > 0 &&
          (row.closeTime ?? "").length > 0 &&
          (row.closeTime as string) < (row.openTime as string);
        return (
        <View key={row.weekday} style={styles.dayRow}>
          <View style={styles.dayHead}>
            <Text style={styles.dayName}>{DAY_NAMES[row.weekday]}</Text>
            <BrandSwitch
              value={!row.isClosed}
              disabled={disabled}
              onValueChange={(on) =>
                setHoursRow(row.weekday, {
                  isClosed: !on,
                  openTime: on ? row.openTime ?? "09:00" : null,
                  closeTime: on ? row.closeTime ?? "17:00" : null,
                  // #4490 — a closed day has no windows.
                  ...(on ? {} : { extraWindows: [] }),
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
                    {isOvernight ? (
                      <Text style={styles.nextDay}>next day</Text>
                    ) : null}
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
                    accessibilityLabel={
                      isOvernight
                        ? `Pick ${DAY_NAMES[row.weekday]} closing time, currently ${row.closeTime} next day`
                        : `Pick ${DAY_NAMES[row.weekday]} closing time`
                    }
                  >
                    <Text style={styles.timeLbl}>Closes</Text>
                    <Text style={styles.timeVal}>{row.closeTime ?? "—"}</Text>
                    {isOvernight ? (
                      <Text style={styles.nextDay}>next day</Text>
                    ) : null}
                  </Pressable>
                </>
              )}
            </View>
          ) : null}
          {allowWindows && !row.isClosed ? (
            <View style={styles.windowsBlock}>
              {(row.extraWindows ?? []).map((w, index) => (
                <View key={index} style={styles.extraWindowRow} testID={`hours-window-${row.weekday}-${index + 1}`}>
                  <TimeField
                    label={`Opens again`}
                    value={(w.openTime ?? "").slice(0, 5)}
                    onChangeValue={(v) => setExtraWindow(row.weekday, index, { openTime: v })}
                    accessibilityLabel={`${DAY_NAMES[row.weekday]} window ${index + 2} opening time`}
                  />
                  <TimeField
                    label="Closes"
                    value={(w.closeTime ?? "").slice(0, 5)}
                    onChangeValue={(v) => setExtraWindow(row.weekday, index, { closeTime: v })}
                    accessibilityLabel={`${DAY_NAMES[row.weekday]} window ${index + 2} closing time`}
                  />
                  <Pressable
                    onPress={() => removeExtraWindow(row.weekday, index)}
                    disabled={disabled}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${DAY_NAMES[row.weekday]} window ${index + 2}`}
                    style={styles.removeWindow}
                  >
                    <Text style={styles.removeWindowText}>Remove</Text>
                  </Pressable>
                </View>
              ))}
              {(row.extraWindows?.length ?? 0) < MAX_EXTRA_WINDOWS ? (
                <Pressable
                  onPress={() => addExtraWindow(row.weekday)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Add a window on ${DAY_NAMES[row.weekday]}`}
                  style={styles.addWindow}
                  testID={`hours-add-window-${row.weekday}`}
                >
                  <Text style={styles.addWindowText}>+ Add a window</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
        );
      })}

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
      placeholderTextColor={color.text4}
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
    gap: space[2],
  },
  err: {
    fontSize: type.caption.fontSize,
    color: color.errorText,
  },
  bulkBar: {
    gap: space[2],
    padding: space[2],
    borderRadius: radiusTokens.md,
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
    marginBottom: space[2],
  },
  bulkTitle: {
    fontSize: type.small.fontSize,
    fontWeight: "700",
    color: color.text1,
  },
  bulkDayRow: {
    flexDirection: "row",
    gap: space[1],
  },
  bulkDayChip: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  bulkDayChipOn: {
    borderColor: color.accent,
    backgroundColor: color.accentLine,
  },
  bulkDayChipText: {
    fontSize: type.small.fontSize,
    fontWeight: "700",
    color: color.text2,
  },
  bulkDayChipTextOn: {
    color: color.text1,
  },
  bulkQuickRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[1],
  },
  bulkQuickBtn: {
    paddingHorizontal: space[2],
    paddingVertical: 6,
    borderRadius: radiusTokens.sm,
    backgroundColor: color.fill.tile,
  },
  bulkQuickText: {
    fontSize: type.caption.fontSize,
    color: color.text2,
    fontWeight: "600",
  },
  bulkHint: {
    fontSize: type.caption.fontSize,
    color: color.text3,
  },
  dayRow: {
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
    padding: space[2],
    marginBottom: space[1],
  },
  dayHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dayName: {
    fontSize: type.body.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
  timeRow: {
    flexDirection: "row",
    gap: space[2],
    marginTop: space[2],
  },
  timeBtn: {
    flex: 1,
    padding: space[2],
    borderRadius: radiusTokens.sm,
    backgroundColor: color.accentLine,
  },
  timeLbl: {
    fontSize: type.caption.fontSize,
    color: color.text2,
  },
  timeVal: {
    fontSize: type.body.fontSize,
    fontWeight: "600",
    color: color.text1,
    marginTop: 2,
  },
  // ORCH-1263 — overnight micro-line (DESIGN §6.3: type.label,
  // text.tertiary, marginTop 1, inside the Closes control).
  nextDay: {
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    fontWeight: type.label.fontWeight,
    letterSpacing: type.label.letterSpacing,
    color: color.text3,
    marginTop: 1,
  },
  windowsBlock: {
    gap: space[2],
    marginTop: space[2],
  },
  extraWindowRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space[2],
  },
  removeWindow: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: space[2],
  },
  removeWindowText: {
    fontSize: type.small.fontSize,
    color: color.text2,
    fontWeight: "600",
  },
  addWindow: {
    alignSelf: "flex-start",
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: space[2],
    borderRadius: radiusTokens.sm,
    backgroundColor: color.fill.tile,
  },
  addWindowText: {
    fontSize: type.small.fontSize,
    color: color.text1,
    fontWeight: "600",
  },
  webTimeInput: {
    fontSize: type.body.fontSize,
    fontWeight: "600",
    color: color.text1,
    marginTop: 2,
    paddingVertical: 2,
  },
  iosBackdrop: {
    flex: 1,
    backgroundColor: scrim.modal,
    justifyContent: "flex-end",
  },
  iosSheet: {
    backgroundColor: color.canvas,
    paddingBottom: space[6],
    borderTopLeftRadius: radiusTokens.lg,
    borderTopRightRadius: radiusTokens.lg,
  },
  iosDone: {
    alignItems: "flex-end",
    padding: space[4],
  },
});

export default BrandHoursEditor;
