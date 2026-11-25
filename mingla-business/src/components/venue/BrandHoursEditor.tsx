/**
 * ORCH-1186-A — controlled, reusable 7-day opening-hours editor extracted from
 * VenueStep4Hours (subtract-before-adding: one editor, two consumers — the
 * creation wizard draft + the live venue Settings tab).
 *
 * Props are fully controlled: the host owns the `hours` array and receives every
 * change via `onChange`. No store coupling lives here (the wizard wrapper binds
 * the draft store; Settings binds a local draft + the upsert mutation).
 *
 * Time control (#4490 click-test D20/D21/D22): every time on every platform
 * is the shared 24-hour `TimeField` (type "22:00" or pick from a list), for
 * the first window, the extra windows and the bulk row alike. No native
 * browser time input, no seconds, no AM/PM.
 *
 * The 34px bulk day-chips carry hitSlop to reach a ≥44pt effective target (D.9).
 * This component does NOT carry the wizard host's outer padding — the GlassCard
 * (Settings) / the wizard wrapper supply their own padding.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  color,
  space,
  type,
} from "../../constants/designSystem";
import { useTouchFloor } from "../../hooks/useTouchFloor";
import type { BrandHourEntry, BrandHourWindow } from "../../types/brand";
import { hoursWeekIssue } from "../../utils/venueBrandHours";
import { BrandSwitch } from "../ui/BrandSwitch";
import { Button } from "../ui/Button";
import { normalizeTime24 } from "../ui/fieldModels";
import { Icon } from "../ui/Icon";
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
  // #4490: hitSlop does nothing in a phone browser, so small controls are drawn 44 there.
  const touchFloor = useTouchFloor();

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

  // ----- time fields commit an "HH:mm" straight to the row -------------------
  const onWebTime = useCallback(
    (weekday: number, field: "open" | "close", raw: string): void => {
      const hm = normalizeTime24(raw);
      if (hm === null) return;
      const key = field === "open" ? "openTime" : "closeTime";
      setHoursRow(weekday, { isClosed: false, [key]: hm });
    },
    [setHoursRow],
  );

  // #4490 N7: the bulk row keeps what was picked and opens a closed day only
  // once it has both times, so "Open and close times are required" never
  // flashes (and shifts the layout) while the second field is still empty.
  const [bulkOpen, setBulkOpen] = useState<string>("");
  const [bulkClose, setBulkClose] = useState<string>("");
  const onWebBulkTime = useCallback(
    (field: "open" | "close", raw: string): void => {
      const hm = normalizeTime24(raw);
      if (hm === null || selectedDays.size === 0) return;
      const open = field === "open" ? hm : bulkOpen;
      const close = field === "close" ? hm : bulkClose;
      if (field === "open") setBulkOpen(hm);
      else setBulkClose(hm);
      onChange(
        hours.map((r) => {
          if (!selectedDays.has(r.weekday)) return r;
          const nextOpen = open.length > 0 ? open : r.isClosed ? null : r.openTime;
          const nextClose = close.length > 0 ? close : r.isClosed ? null : r.closeTime;
          if (nextOpen === null || nextClose === null) return r; // wait for the other time
          return { ...r, isClosed: false, openTime: nextOpen, closeTime: nextClose };
        }),
      );
    },
    [bulkClose, bulkOpen, hours, onChange, selectedDays],
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
                style={[styles.bulkDayChip, touchFloor > 0 ? { width: touchFloor, height: touchFloor, borderRadius: touchFloor / 2 } : null, on && styles.bulkDayChipOn]}
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
            style={[styles.bulkQuickBtn, touchFloor > 0 ? { minHeight: touchFloor, minWidth: touchFloor, justifyContent: "center", alignItems: "center" } : null]}
          >
            <Text style={styles.bulkQuickText}>Weekdays</Text>
          </Pressable>
          <Pressable
            onPress={() => setSelectedDays(new Set([5, 6]))}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Select weekend"
            style={[styles.bulkQuickBtn, touchFloor > 0 ? { minHeight: touchFloor, minWidth: touchFloor, justifyContent: "center", alignItems: "center" } : null]}
          >
            <Text style={styles.bulkQuickText}>Weekend</Text>
          </Pressable>
          <Pressable
            onPress={() => setSelectedDays(new Set([0, 1, 2, 3, 4, 5, 6]))}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Select all days"
            style={[styles.bulkQuickBtn, touchFloor > 0 ? { minHeight: touchFloor, minWidth: touchFloor, justifyContent: "center", alignItems: "center" } : null]}
          >
            <Text style={styles.bulkQuickText}>All</Text>
          </Pressable>
          {selectedDays.size > 0 ? (
            <Pressable
              onPress={() => setSelectedDays(new Set())}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel="Clear day selection"
              style={[styles.bulkQuickBtn, touchFloor > 0 ? { minHeight: touchFloor, minWidth: touchFloor, justifyContent: "center", alignItems: "center" } : null]}
            >
              <Text style={styles.bulkQuickText}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
        {selectedDays.size > 0 ? (
          <View style={styles.timeRow}>
            <TimeField
              label="Opens (all selected)"
              value={bulkOpen}
              disabled={disabled}
              onChangeValue={(v) => onWebBulkTime("open", v)}
              accessibilityLabel="Opening time for selected days"
              testID="hours-bulk-open"
            />
            <TimeField
              label="Closes (all selected)"
              value={bulkClose}
              disabled={disabled}
              onChangeValue={(v) => onWebBulkTime("close", v)}
              accessibilityLabel="Closing time for selected days"
              testID="hours-bulk-close"
            />
            <View style={styles.bulkClosedCol}>
              <Button
                label={`Mark ${selectedDays.size} closed`}
                variant="secondary"
                size="sm"
                disabled={disabled}
                onPress={() =>
                  setHoursRows(Array.from(selectedDays), {
                    isClosed: true,
                    openTime: null,
                    closeTime: null,
                    extraWindows: [],
                  })
                }
                accessibilityLabel="Mark selected days closed"
              />
            </View>
          </View>
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
              <TimeField
                label="Opens"
                value={row.openTime ?? ""}
                disabled={disabled}
                onChangeValue={(v) => onWebTime(row.weekday, "open", v)}
                accessibilityLabel={`${DAY_NAMES[row.weekday]} opening time`}
                testID={`hours-open-${row.weekday}`}
              />
              <View style={styles.closesCol}>
                <TimeField
                  label="Closes"
                  value={row.closeTime ?? ""}
                  disabled={disabled}
                  onChangeValue={(v) => onWebTime(row.weekday, "close", v)}
                  accessibilityLabel={`${DAY_NAMES[row.weekday]} closing time`}
                  testID={`hours-close-${row.weekday}`}
                />
                {isOvernight ? <Text style={styles.nextDay}>next day</Text> : null}
              </View>
              {allowWindows ? <View style={styles.removeSpacer} /> : null}
            </View>
          ) : null}
          {allowWindows && !row.isClosed ? (
            <View style={styles.windowsBlock}>
              {(row.extraWindows ?? []).map((w, index) => (
                <View key={index} style={styles.extraWindowRow} testID={`hours-window-${row.weekday}-${index + 1}`}>
                  <TimeField
                    label="Opens again"
                    value={w.openTime ?? ""}
                    disabled={disabled}
                    onChangeValue={(v) => setExtraWindow(row.weekday, index, { openTime: v })}
                    accessibilityLabel={`${DAY_NAMES[row.weekday]} window ${index + 2} opening time`}
                    testID={`hours-window-${row.weekday}-${index + 1}-open`}
                  />
                  <View style={styles.closesCol}>
                    <TimeField
                      label="Closes"
                      value={w.closeTime ?? ""}
                      disabled={disabled}
                      onChangeValue={(v) => setExtraWindow(row.weekday, index, { closeTime: v })}
                      accessibilityLabel={`${DAY_NAMES[row.weekday]} window ${index + 2} closing time`}
                      testID={`hours-window-${row.weekday}-${index + 1}-close`}
                    />
                    {(w.openTime ?? "").length > 0 &&
                    (w.closeTime ?? "").length > 0 &&
                    (normalizeTime24(w.closeTime) ?? "") < (normalizeTime24(w.openTime) ?? "") ? (
                      <Text style={styles.nextDay}>next day</Text>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => removeExtraWindow(row.weekday, index)}
                    disabled={disabled}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${DAY_NAMES[row.weekday]} window ${index + 2}`}
                    style={({ pressed }) => [styles.removeWindow, touchFloor > 0 ? { width: touchFloor } : null, pressed && styles.removeWindowPressed]}
                    testID={`hours-window-${row.weekday}-${index + 1}-remove`}
                  >
                    <Icon name="trash" size={16} color={color.text2} />
                  </Pressable>
                </View>
              ))}
              {(row.extraWindows?.length ?? 0) < MAX_EXTRA_WINDOWS ? (
                <Pressable
                  onPress={() => addExtraWindow(row.weekday)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Add a window on ${DAY_NAMES[row.weekday]}`}
                  style={[styles.addWindow, touchFloor > 0 ? { minHeight: touchFloor } : null]}
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

    </View>
  );
};

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
    alignItems: "flex-start",
    gap: space[2],
    marginTop: space[2],
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
  // Top-aligned so a "next day" note under one Closes field never lifts it
  // above its neighbour; the remove button drops by the label's height.
  extraWindowRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
  },
  // #4490 D21 — a real small icon button (48 tall, the field's height),
  // never a bare text link.
  removeWindow: {
    marginTop: (type.small.lineHeight ?? 18) + space[1],
    width: 40,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.tile,
  },
  removeWindowPressed: {
    backgroundColor: color.fill.inset,
  },
  removeSpacer: {
    width: 40,
  },
  closesCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  bulkClosedCol: {
    justifyContent: "flex-end",
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
});

export default BrandHoursEditor;
