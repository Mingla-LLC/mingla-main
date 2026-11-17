import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import {
  reservationCalendarLayout,
  color,
  space,
  type,
} from "../../constants/designSystem";
import type { Reservation } from "../../types/venueReservation";
import { GlassCard } from "../ui/GlassCard";
import { ReservationCard } from "./ReservationCard";
import type { FocusableReservationEntry } from "./ReservationCard";
import { formatCalendarDay } from "./reservationCalendarModel";
import type { ReservationCalendarDay } from "./reservationCalendarModel";

export interface ReservationWeekViewProps {
  days: readonly ReservationCalendarDay[];
  grouped: ReadonlyMap<string, Reservation[]>;
  todayKey: string;
  timeZone: string;
  tableDisplayFor: (reservation: Reservation) => string | null;
  onSelect: (reservation: Reservation) => void;
  entryRefFor?: (
    reservationId: string,
  ) => (node: FocusableReservationEntry | null) => void;
}

export function ReservationWeekView({
  days,
  grouped,
  todayKey,
  timeZone,
  tableDisplayFor,
  onSelect,
  entryRefFor,
}: ReservationWeekViewProps): React.ReactElement {
  return (
    <GlassCard variant="base" radius="lg" padding={0} style={styles.surface}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        style={styles.scroller}
        contentContainerStyle={styles.grid}
        testID="reservation-calendar-week"
      >
        {days.map((day) => {
          const reservations = grouped.get(day.key) ?? [];
          const isToday = day.key === todayKey;
          return (
            <View key={day.key} style={styles.column}>
              <View style={[styles.header, isToday ? styles.todayHeader : null]}>
                <Text style={styles.weekday}>
                  {formatCalendarDay(day.key, { weekday: "short" }).toUpperCase()}
                </Text>
                <Text style={styles.date}>
                  {formatCalendarDay(day.key, { month: "short", day: "numeric" })}
                </Text>
                <Text style={styles.count}>
                  {reservations.length} booking{reservations.length === 1 ? "" : "s"}
                </Text>
              </View>
              <View style={styles.bookingStack}>
                {reservations.length === 0 ? (
                  <Text style={styles.noBookings}>No bookings</Text>
                ) : (
                  reservations.map((reservation) => (
                    <ReservationCard
                      key={reservation.id}
                      reservation={reservation}
                      tableDisplay={tableDisplayFor(reservation)}
                      timeZone={timeZone}
                      onPress={onSelect}
                      density="calendar"
                      testID={`reservation-week-entry-${reservation.id}`}
                      entryRef={entryRefFor?.(reservation.id)}
                    />
                  ))
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  surface: {
    width: "100%",
    alignSelf: "stretch",
    overflow: "hidden",
  },
  scroller: {
    width: "100%",
  },
  grid: {
    flexDirection: "row",
    minWidth: reservationCalendarLayout.weekDayMinWidth * 7,
    flexGrow: 1,
  },
  column: {
    flex: 1,
    minWidth: reservationCalendarLayout.weekDayMinWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: color.line,
  },
  header: {
    minHeight: 56,
    padding: space[2],
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  todayHeader: {
    borderBottomWidth: 2,
    borderBottomColor: color.accent,
  },
  weekday: {
    ...type.label,
    color: color.text2,
  },
  date: {
    ...type.small,
    color: color.text1,
    fontWeight: "600",
  },
  count: {
    ...type.label,
    color: color.text3,
  },
  bookingStack: {
    padding: space[1],
    gap: space[1],
    minHeight: 112,
  },
  noBookings: {
    ...type.caption,
    color: color.text3,
    textAlign: "center",
    marginTop: space[4],
  },
});

export default ReservationWeekView;
