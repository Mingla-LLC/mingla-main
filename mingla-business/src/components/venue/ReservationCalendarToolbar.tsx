import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { PressableProps } from "react-native";
import { Check, ChevronLeft, ChevronRight } from "lucide-react-native";

import {
  accent,
  androidOpaque,
  canvas,
  glass,
  radius,
  reservationCalendarLayout,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type {
  ReservationCalendarMode,
  ReservationStatusScope,
} from "./reservationCalendarModel";

export interface ReservationDateControl {
  key: string;
  weekday: string;
  dayNumber: string;
  count: number;
  fullLabel: string;
  isToday: boolean;
}

export interface ReservationCalendarToolbarProps {
  isWideDesktop: boolean;
  mode: ReservationCalendarMode;
  periodLabel: string;
  selectedDayKey: string;
  days: readonly ReservationDateControl[];
  scope: ReservationStatusScope;
  scopeCounts: Record<ReservationStatusScope, number>;
  onModeChange: (mode: ReservationCalendarMode) => void;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onDaySelect: (dayKey: string) => void;
  onScopeChange: (scope: ReservationStatusScope) => void;
}

const MODES: readonly { id: ReservationCalendarMode; label: string }[] = [
  { id: "agenda", label: "Agenda" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

const SCOPES: readonly { id: ReservationStatusScope; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "waitlist", label: "Waitlist" },
  { id: "completed", label: "Completed" },
  { id: "no_shows", label: "No-shows" },
  { id: "canceled", label: "Canceled" },
];

interface CalendarKeyboardEvent {
  nativeEvent: { key: string };
  preventDefault: () => void;
}

interface KeyboardPressableProps extends PressableProps {
  onKeyDown?: (event: CalendarKeyboardEvent) => void;
}

// React Native Web forwards onKeyDown, while the installed native Pressable
// types intentionally omit that web-only prop. This one typed seam keeps the
// platform delta local instead of weakening every call site.
const KeyboardPressable = Pressable as React.ComponentType<KeyboardPressableProps>;

const keyboardTarget = (
  event: CalendarKeyboardEvent,
  currentIndex: number,
  length: number,
): number | null => {
  switch (event.nativeEvent.key) {
    case "ArrowLeft":
      event.preventDefault();
      return (currentIndex - 1 + length) % length;
    case "ArrowRight":
      event.preventDefault();
      return (currentIndex + 1) % length;
    case "Home":
      event.preventDefault();
      return 0;
    case "End":
      event.preventDefault();
      return length - 1;
    default:
      return null;
  }
};

export function ReservationCalendarToolbar({
  isWideDesktop,
  mode,
  periodLabel,
  selectedDayKey,
  days,
  scope,
  scopeCounts,
  onModeChange,
  onPrevious,
  onNext,
  onToday,
  onDaySelect,
  onScopeChange,
}: ReservationCalendarToolbarProps): React.ReactElement {
  return (
    <View style={styles.host}>
      <View style={[styles.controlBand, isWideDesktop ? styles.controlBandWide : null]}>
        {isWideDesktop ? (
          <View
            style={styles.tabList}
            accessibilityRole="tablist"
            accessibilityLabel="Calendar view"
          >
            {MODES.map((item, index) => {
              const selected = item.id === mode;
              return (
                <KeyboardPressable
                  key={item.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${item.label} calendar view`}
                  tabIndex={selected ? 0 : -1}
                  onKeyDown={(event) => {
                    const target = keyboardTarget(event, index, MODES.length);
                    if (target !== null) onModeChange(MODES[target].id);
                  }}
                  onPress={() => onModeChange(item.id)}
                  style={({ pressed }) => [
                    styles.tab,
                    selected ? styles.tabSelected : null,
                    pressed ? styles.pressed : null,
                  ]}
                  testID={`reservation-calendar-mode-${item.id}`}
                >
                  {selected ? <Check size={14} color={accent.warm} /> : null}
                  <Text style={[styles.tabText, selected ? styles.tabTextSelected : null]}>
                    {item.label}
                  </Text>
                </KeyboardPressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.periodControls}>
          <Pressable
            onPress={onPrevious}
            accessibilityRole="button"
            accessibilityLabel="Previous calendar period"
            style={({ pressed }) => [styles.iconButton, pressed ? styles.pressed : null]}
            testID="reservation-calendar-previous"
          >
            <ChevronLeft size={18} color={textTokens.primary} />
          </Pressable>
          <Text style={styles.periodLabel} accessibilityRole="header">
            {periodLabel}
          </Text>
          <Pressable
            onPress={onNext}
            accessibilityRole="button"
            accessibilityLabel="Next calendar period"
            style={({ pressed }) => [styles.iconButton, pressed ? styles.pressed : null]}
            testID="reservation-calendar-next"
          >
            <ChevronRight size={18} color={textTokens.primary} />
          </Pressable>
          <Pressable
            onPress={onToday}
            accessibilityRole="button"
            style={({ pressed }) => [styles.todayButton, pressed ? styles.pressed : null]}
            testID="reservation-calendar-today"
          >
            <Text style={styles.todayText}>Today</Text>
          </Pressable>
        </View>
      </View>

      {!isWideDesktop ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dateStrip}
          accessibilityRole="tablist"
          accessibilityLabel="Reservation dates"
          testID="reservation-calendar-date-strip"
        >
          {days.map((day, index) => {
            const selected = day.key === selectedDayKey;
            return (
              <KeyboardPressable
                key={day.key}
                onPress={() => onDaySelect(day.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`${day.fullLabel}, ${day.count} ${
                  scope === "active" ? "active " : ""
                }reservation${day.count === 1 ? "" : "s"}${
                  selected ? ", selected" : ""
                }${day.isToday ? ", today" : ""}.`}
                tabIndex={selected ? 0 : -1}
                onKeyDown={(event) => {
                  const target = keyboardTarget(event, index, days.length);
                  if (target !== null) onDaySelect(days[target].key);
                }}
                style={({ pressed }) => [
                  styles.dateCell,
                  day.isToday && !selected ? styles.dateCellToday : null,
                  selected ? styles.dateCellSelected : null,
                  pressed ? styles.pressed : null,
                ]}
                testID={`reservation-calendar-date-${day.key}`}
              >
                <Text style={[styles.weekday, selected ? styles.dateSelectedText : null]}>
                  {day.weekday.toUpperCase()}
                </Text>
                <Text style={[styles.dayNumber, selected ? styles.dateSelectedText : null]}>
                  {day.dayNumber}
                </Text>
                {day.count > 0 ? (
                  <Text style={[styles.dateCount, selected ? styles.dateSelectedText : null]}>
                    {day.count}
                  </Text>
                ) : null}
              </KeyboardPressable>
            );
          })}
        </ScrollView>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scopeList}
        accessibilityRole="tablist"
        accessibilityLabel="Reservation status"
        testID="reservation-calendar-status-filters"
      >
        {SCOPES.map((item, index) => {
          const selected = item.id === scope;
          return (
            <KeyboardPressable
              key={item.id}
              onPress={() => onScopeChange(item.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`${item.label}, ${scopeCounts[item.id]} reservations`}
              tabIndex={selected ? 0 : -1}
              onKeyDown={(event) => {
                const target = keyboardTarget(event, index, SCOPES.length);
                if (target !== null) onScopeChange(SCOPES[target].id);
              }}
              style={({ pressed }) => [
                styles.scopeChip,
                selected ? styles.scopeChipSelected : null,
                pressed ? styles.pressed : null,
              ]}
              testID={`reservation-calendar-scope-${item.id}`}
            >
              {selected ? <Check size={14} color={accent.warm} /> : null}
              <Text style={[styles.scopeText, selected ? styles.scopeTextSelected : null]}>
                {item.label}
              </Text>
              <Text style={[styles.scopeCount, selected ? styles.scopeTextSelected : null]}>
                {scopeCounts[item.id]}
              </Text>
            </KeyboardPressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const selectedFill =
  Platform.OS === "android" ? androidOpaque.accentFill : accent.tint;

const styles = StyleSheet.create({
  host: {
    gap: spacing.sm,
  },
  controlBand: {
    gap: spacing.sm,
  },
  controlBandWide: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  periodControls: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs,
  },
  iconButton: {
    width: reservationCalendarLayout.entryMinTarget,
    minHeight: reservationCalendarLayout.entryMinTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileElevated,
  },
  periodLabel: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "600",
    textAlign: "center",
    minWidth: 150,
    flexShrink: 1,
  },
  todayButton: {
    minHeight: reservationCalendarLayout.entryMinTarget,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    backgroundColor: glass.tint.profileElevated,
  },
  todayText: {
    ...typography.buttonMd,
    color: textTokens.primary,
  },
  tabList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  tab: {
    minHeight: reservationCalendarLayout.entryMinTarget,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  tabSelected: {
    borderColor: accent.border,
    backgroundColor: selectedFill,
  },
  tabText: {
    ...typography.buttonMd,
    color: textTokens.secondary,
  },
  tabTextSelected: {
    color: accent.warm,
  },
  dateStrip: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  dateCell: {
    minWidth: reservationCalendarLayout.dateCellMinWidth,
    minHeight: reservationCalendarLayout.dateCellMinHeight,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  dateCellToday: {
    borderWidth: spacing.xxs,
    borderColor: accent.warm,
  },
  dateCellSelected: {
    borderColor: accent.warm,
    backgroundColor: accent.warm,
  },
  weekday: {
    ...typography.micro,
    color: textTokens.secondary,
  },
  dayNumber: {
    ...typography.bodyLg,
    color: textTokens.primary,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  dateCount: {
    ...typography.micro,
    color: textTokens.secondary,
    position: "absolute",
    top: spacing.xs,
    right: spacing.xs,
  },
  dateSelectedText: {
    color: canvas.discover,
  },
  scopeList: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  scopeChip: {
    minHeight: reservationCalendarLayout.entryMinTarget,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  scopeChipSelected: {
    borderColor: accent.border,
    backgroundColor: selectedFill,
  },
  scopeText: {
    ...typography.buttonMd,
    color: textTokens.secondary,
  },
  scopeCount: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  scopeTextSelected: {
    color: accent.warm,
  },
  pressed: {
    opacity: 0.72,
  },
});

export default ReservationCalendarToolbar;
