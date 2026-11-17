import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius,
  reservationCalendarLayout,
  color,
  space,
  type,
} from "../../constants/designSystem";
import type { Reservation } from "../../types/venueReservation";
import { GlassCard } from "../ui/GlassCard";
import { ReservationCard } from "./ReservationCard";
import type { FocusableReservationEntry } from "./ReservationCard";
import {
  formatCalendarDay,
  projectMonthDay,
} from "./reservationCalendarModel";
import type { ReservationCalendarDay } from "./reservationCalendarModel";

export interface ReservationMonthViewProps {
  days: readonly ReservationCalendarDay[];
  grouped: ReadonlyMap<string, Reservation[]>;
  todayKey: string;
  timeZone: string;
  tableDisplayFor: (reservation: Reservation) => string | null;
  onSelect: (reservation: Reservation) => void;
  onOverflow: (dayKey: string) => void;
  entryRefFor?: (
    reservationId: string,
  ) => (node: FocusableReservationEntry | null) => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function ReservationMonthView({
  days,
  grouped,
  todayKey,
  timeZone,
  tableDisplayFor,
  onSelect,
  onOverflow,
  entryRefFor,
}: ReservationMonthViewProps): React.ReactElement {
  return (
    <GlassCard variant="base" radius="lg" padding={0} style={styles.surface}>
      <View style={styles.weekdayRow} accessibilityElementsHidden>
        {WEEKDAYS.map((weekday) => (
          <View key={weekday} style={styles.weekdayCell}>
            <Text style={styles.weekday}>{weekday.toUpperCase()}</Text>
          </View>
        ))}
      </View>
      <View style={styles.grid} testID="reservation-calendar-month">
        {days.map((day) => {
          const reservations = grouped.get(day.key) ?? [];
          const projection = projectMonthDay(
            reservations,
            reservationCalendarLayout.monthVisibleEntryLimit,
          );
          const isToday = day.key === todayKey;
          return (
            <View
              key={day.key}
              testID={`reservation-month-day-${day.key}`}
              style={[
                styles.dayCell,
                !day.inAnchorMonth ? styles.adjacentDay : null,
                isToday ? styles.todayCell : null,
              ]}
            >
              <View style={styles.dayHeader}>
                <Text
                  style={[
                    styles.dayNumber,
                    !day.inAnchorMonth ? styles.adjacentText : null,
                  ]}
                >
                  {formatCalendarDay(day.key, { day: "numeric" })}
                </Text>
                {reservations.length > 0 ? (
                  <Text style={styles.dayCount}>{reservations.length}</Text>
                ) : null}
              </View>
              <View style={styles.slots}>
                {projection.visible.map((reservation) => (
                  <ReservationCard
                    key={reservation.id}
                    reservation={reservation}
                    tableDisplay={tableDisplayFor(reservation)}
                    timeZone={timeZone}
                    onPress={onSelect}
                    density="month"
                    testID={`reservation-month-entry-${reservation.id}`}
                    entryRef={entryRefFor?.(reservation.id)}
                  />
                ))}
                {projection.overflowCount > 0 ? (
                  <Pressable
                    onPress={() => onOverflow(day.key)}
                    accessibilityRole="button"
                    accessibilityLabel={`${projection.overflowCount} more reservations on ${formatCalendarDay(
                      day.key,
                      { weekday: "long", month: "long", day: "numeric" },
                    )}`}
                    style={({ pressed }) => [
                      styles.overflowButton,
                      pressed ? styles.pressed : null,
                    ]}
                    testID={`reservation-month-more-${day.key}`}
                  >
                    <Text style={styles.overflowText}>
                      +{projection.overflowCount} more
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  surface: {
    width: "100%",
    alignSelf: "stretch",
    overflow: "hidden",
  },
  weekdayRow: {
    minHeight: 40,
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  weekdayCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: color.line,
  },
  weekday: {
    ...type.label,
    color: color.text2,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dayCell: {
    flexBasis: "14.285714%",
    flexGrow: 0,
    flexShrink: 0,
    minHeight: reservationCalendarLayout.monthCellMinHeight,
    padding: space[1],
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
  },
  adjacentDay: {
    backgroundColor: color.fill.inset,
  },
  todayCell: {
    borderWidth: 2,
    borderColor: color.accent,
  },
  dayHeader: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[1],
  },
  dayNumber: {
    ...type.caption,
    color: color.text1,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  adjacentText: {
    color: color.text3,
  },
  dayCount: {
    ...type.label,
    color: color.text2,
  },
  slots: {
    gap: space[1],
  },
  overflowButton: {
    minHeight: reservationCalendarLayout.entryMinTarget,
    paddingHorizontal: space[1],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.accentLine,
    backgroundColor: color.fill.tile,
  },
  overflowText: {
    ...type.label,
    color: color.accent,
  },
  pressed: {
    opacity: 0.72,
  },
});

export default ReservationMonthView;
