/**
 * #4490 click-test D25 — the design-system date field for venue special days
 * and closing a day. Day first, always: it shows "Fri 25 Dec 2026", reads
 * typed dates day first ("25/12/2026", "25 Dec 2026", "25 December"), and a
 * calendar button opens a month grid to click or tap.
 *
 * Not a native browser `<input type="date">`: that shows "mm/dd/yyyy" in US
 * locales and cannot be driven by plain clicks and typing in every browser.
 * Same control on phones (the grid is touch-sized) and desktop.
 *
 * Value contract: `value` / `onChangeValue` are "YYYY-MM-DD" or "".
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { color, materials, radius, space, type } from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useTouchFloor } from "../../hooks/useTouchFloor";
import { Icon } from "./Icon";
import { PickerSheetHead } from "./PickerSheetHead";
import { Sheet } from "./Sheet";
import {
  dayDateLabel,
  monthGrid,
  monthTitle,
  parseDayDateInput,
  shiftMonth,
} from "./fieldModels";

const WEEK_HEAD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export interface DayDateFieldProps {
  label: string;
  value: string;
  onChangeValue: (value: string) => void;
  accessibilityLabel: string;
  /** "YYYY-MM-DD": the first day that can be picked (today, usually). */
  min?: string;
  /** Today, "YYYY-MM-DD" (also used for a typed date with no year). */
  today: string;
  placeholder?: string;
  /** Error copy shown under THIS field. */
  error?: string | null;
  disabled?: boolean;
  testID?: string;
}

function ym(iso: string): { year: number; month1: number } | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  return m === null ? null : { year: Number(m[1]), month1: Number(m[2]) };
}

export function DayDateField({
  label,
  value,
  onChangeValue,
  accessibilityLabel,
  min,
  today,
  placeholder = "Like 25 Dec 2026",
  error = null,
  disabled = false,
  testID,
}: DayDateFieldProps): React.ReactElement {
  const shown = dayDateLabel(value);
  const [text, setText] = useState(shown);
  const [typingError, setTypingError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const focused = useRef(false);
  const { isWideDesktop } = useResponsiveLayout();
  // #4490: hitSlop does nothing in a phone browser, so the field parts are drawn 44 there.
  const touchFloor = useTouchFloor();
  const start = ym(value) ?? ym(min ?? today) ?? ym(today) ?? { year: 2026, month1: 1 };
  const [month, setMonth] = useState(start);

  useEffect(() => {
    if (!focused.current) {
      setText(shown);
      setTypingError(null);
    }
  }, [shown]);

  useEffect(() => {
    if (open) setMonth(ym(value) ?? ym(min ?? today) ?? start);
    // Open on the picked month (or the first pickable one) each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (iso: string): void => {
    setTypingError(null);
    setText(dayDateLabel(iso));
    if (iso !== value) onChangeValue(iso);
  };

  const onBlur = (): void => {
    focused.current = false;
    if (text.trim().length === 0) {
      setText(shown);
      return;
    }
    const iso = parseDayDateInput(text, today);
    if (iso === null) {
      setTypingError("Type the day first, like 25 Dec 2026, or pick from the calendar.");
      return;
    }
    if (min !== undefined && iso < min) {
      setTypingError("Pick today or a later date.");
      return;
    }
    pick(iso);
  };

  const weeks = useMemo(() => monthGrid(month.year, month.month1), [month]);
  const minMonth = ym(min ?? "") ?? null;
  const canGoBack =
    minMonth === null || month.year * 12 + month.month1 > minMonth.year * 12 + minMonth.month1;
  const message = typingError ?? error;

  return (
    <View style={styles.host} testID={testID}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.field, message !== null && styles.fieldError, disabled && styles.disabled]}>
        <TextInput
          value={text}
          editable={!disabled}
          placeholder={placeholder}
          placeholderTextColor={color.text4}
          accessibilityLabel={accessibilityLabel}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={onBlur}
          onSubmitEditing={onBlur}
          onChangeText={(next) => {
            setText(next);
            setTypingError(null);
          }}
          style={[styles.input, touchFloor > 0 ? { minHeight: touchFloor } : null]}
          testID={testID !== undefined ? `${testID}-input` : undefined}
        />
        <Pressable
          onPress={() => setOpen(true)}
          disabled={disabled}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Choose ${accessibilityLabel.toLowerCase()} from a calendar`}
          style={({ pressed }) => [styles.iconButton, touchFloor > 0 ? { width: touchFloor, height: touchFloor } : null, pressed && styles.pressed]}
          testID={testID !== undefined ? `${testID}-calendar` : undefined}
        >
          <Icon name="calendar" size={16} color={color.text2} />
        </Pressable>
      </View>
      {message !== null ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" testID={testID !== undefined ? `${testID}-error` : undefined}>
          {message}
        </Text>
      ) : null}
      {/* I-SUB-SHEET-INSIDE-PARENT: the calendar renders as this field's child. */}
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        snapPoint={0.7}
        presentation={isWideDesktop ? "modal" : undefined}
      >
        <View style={styles.sheetBody}>
          <PickerSheetHead title={label} onClose={() => setOpen(false)} testID={testID !== undefined ? `${testID}-head` : undefined} />
          <View style={styles.monthRow}>
            <Pressable
              onPress={() => canGoBack && setMonth((m) => shiftMonth(m.year, m.month1, -1))}
              disabled={!canGoBack}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              style={[styles.navButton, !canGoBack && styles.disabled]}
              testID={testID !== undefined ? `${testID}-prev` : undefined}
            >
              <Icon name="chevL" size={18} color={color.text1} />
            </Pressable>
            <Text style={styles.monthTitle} accessibilityRole="header">
              {monthTitle(month.year, month.month1)}
            </Text>
            <Pressable
              onPress={() => setMonth((m) => shiftMonth(m.year, m.month1, 1))}
              accessibilityRole="button"
              accessibilityLabel="Next month"
              style={styles.navButton}
              testID={testID !== undefined ? `${testID}-next` : undefined}
            >
              <Icon name="chevR" size={18} color={color.text1} />
            </Pressable>
          </View>
          <View style={styles.week}>
            {WEEK_HEAD.map((d) => (
              <Text key={d} style={styles.weekHead}>
                {d}
              </Text>
            ))}
          </View>
          {weeks.map((week, wi) => (
            <View key={wi} style={styles.week}>
              {week.map((iso, di) => {
                if (iso === null) return <View key={`b${di}`} style={styles.dayCell} />;
                const before = min !== undefined && iso < min;
                const on = iso === value;
                const isToday = iso === today;
                return (
                  <Pressable
                    key={iso}
                    onPress={() => {
                      pick(iso);
                      setOpen(false);
                    }}
                    disabled={before}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on, disabled: before }}
                    accessibilityLabel={dayDateLabel(iso)}
                    style={({ pressed }) => [
                      styles.dayCell,
                      styles.day,
                      isToday && styles.dayToday,
                      on && styles.dayOn,
                      pressed && styles.pressed,
                      before && styles.disabled,
                    ]}
                    testID={testID !== undefined ? `${testID}-day-${iso}` : undefined}
                  >
                    <Text style={[styles.dayText, on && styles.dayTextOn]}>{Number(iso.slice(8))}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: space[1] },
  label: { ...type.small, color: color.text2 },
  field: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    paddingLeft: space[3],
    paddingRight: space[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  fieldError: { borderColor: color.danger },
  disabled: { opacity: 0.4 },
  input: { flex: 1, minWidth: 0, ...type.body, color: color.text1, paddingVertical: space[2] },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { backgroundColor: color.fill.tile },
  error: { ...type.caption, color: color.errorText },
  sheetBody: { paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[4], gap: space[1] },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space[2] },
  monthTitle: { ...type.h2, color: color.text1 },
  navButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.inset,
  },
  week: { flexDirection: "row", gap: space[1] },
  weekHead: { flex: 1, textAlign: "center", ...type.caption, color: color.text3, paddingVertical: space[1] },
  dayCell: { flex: 1, height: 44 },
  day: { alignItems: "center", justifyContent: "center", borderRadius: radius.md },
  dayToday: { borderWidth: 1, borderColor: color.line },
  dayOn: { backgroundColor: materials.selected.glassFill, borderWidth: 1.5, borderColor: color.paper },
  dayText: { ...type.body, color: color.text1, fontVariant: ["tabular-nums"] },
  dayTextOn: { color: color.text1, fontWeight: "700" },
});
