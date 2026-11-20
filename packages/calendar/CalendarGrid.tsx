import React, { useEffect, useMemo, useRef } from "react";
import { Pressable, Text, View } from "react-native";

import { compareDates, type CalendarDate } from "./core/calendarDate";
import { dayA11yLabel, weekdayInitials, type CalendarLabels } from "./core/labels";
import { isDisabled, monthMatrix, type DayBounds } from "./core/monthGrid";
import type { CalendarStyles } from "./styles";

export interface GridSelection {
  readonly start: CalendarDate | "";
  readonly end: CalendarDate | "";
  readonly ranged: boolean;
}

export interface CalendarGridProps {
  year: number;
  month: number; // 1-12
  weekStartsOn: 0 | 1;
  styles: CalendarStyles;
  labels: CalendarLabels;
  locale?: string;
  selection: GridSelection;
  focusedDate: CalendarDate;
  /** Bumped by keyboard moves so the focused cell takes DOM focus. */
  focusSignal: number;
  today: CalendarDate;
  bounds: DayBounds;
  onPickDay: (date: CalendarDate) => void;
  testIDPrefix: string;
}

type Focusable = { focus?: () => void } | null;

/** One month of days. Pure presentation: it only reports taps upward. */
export function CalendarGrid(props: CalendarGridProps): React.ReactElement {
  const { year, month, weekStartsOn, styles, labels, locale, selection, focusedDate, focusSignal, today, bounds, onPickDay, testIDPrefix } = props;
  const rows = useMemo(() => monthMatrix(year, month, weekStartsOn), [year, month, weekStartsOn]);
  const initials = useMemo(() => weekdayInitials(weekStartsOn, locale), [weekStartsOn, locale]);
  const refs = useRef<Record<string, Focusable>>({});

  useEffect(() => {
    if (focusSignal === 0) return;
    refs.current[focusedDate]?.focus?.();
    // Only a keyboard move (focusSignal) should pull focus, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignal]);

  return (
    <View role="grid" testID={`${testIDPrefix}-grid`}>
      <View style={styles.weekRow}>
        {initials.map((initial, index) => (
          <Text key={index} style={styles.weekday} importantForAccessibility="no" accessibilityElementsHidden>
            {initial}
          </Text>
        ))}
      </View>
      {rows.map((row, r) => (
        <View key={r} style={styles.weekRow}>
          {row.map((cell) => {
            if (!cell.inMonth) return <View key={cell.date} style={styles.cellSlot} />;
            const disabled = isDisabled(cell.date, bounds);
            const isStart = selection.start !== "" && cell.date === selection.start;
            const isEnd = selection.end !== "" && cell.date === selection.end;
            const inRange =
              selection.ranged &&
              selection.start !== "" &&
              selection.end !== "" &&
              compareDates(cell.date, selection.start) > 0 &&
              compareDates(cell.date, selection.end) < 0;
            const selected = isStart || isEnd;
            const bandEnds = selection.ranged && selection.start !== "" && selection.end !== "";
            const spoken = [
              dayA11yLabel(cell.date, locale),
              cell.date === today ? labels.today : null,
              disabled ? labels.unavailable : null,
              selection.ranged && isStart ? labels.range_start : null,
              selection.ranged && isEnd ? labels.range_end : null,
              inRange ? labels.in_range : null,
            ]
              .filter((part): part is string => part !== null)
              .join(", ");
            return (
              <View
                key={cell.date}
                style={[
                  styles.cellSlot,
                  (inRange || (bandEnds && (isStart || isEnd))) && styles.cellRange,
                  bandEnds && isStart && styles.cellRangeStart,
                  bandEnds && isEnd && styles.cellRangeEnd,
                ]}
              >
                <Pressable
                  ref={(node: unknown) => {
                    refs.current[cell.date] = node as Focusable;
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={spoken}
                  accessibilityState={{ selected, disabled }}
                  disabled={disabled}
                  onPress={() => onPickDay(cell.date)}
                  testID={`${testIDPrefix}-day-${cell.date}`}
                  style={[
                    styles.cell,
                    selected && styles.cellSelected,
                    cell.date === focusedDate && focusSignal > 0 && styles.cellFocused,
                    disabled && styles.cellDisabled,
                  ]}
                >
                  <Text
                    style={[
                      styles.cellText,
                      selected && styles.cellTextSelected,
                      disabled && styles.cellTextDisabled,
                    ]}
                  >
                    {Number(cell.date.slice(8, 10))}
                  </Text>
                  {cell.date === today ? <View style={styles.todayDot} /> : null}
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
