import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  reservationCalendarLayout,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { Reservation } from "../../types/venueReservation";
import { GlassCard } from "../ui/GlassCard";
import { ReservationCard } from "./ReservationCard";
import { formatCalendarDay } from "./reservationCalendarModel";
import type { ReservationCalendarDay } from "./reservationCalendarModel";

export interface ReservationWeekViewProps {
  days: readonly ReservationCalendarDay[];
  grouped: ReadonlyMap<string, Reservation[]>;
  todayKey: string;
  timeZone: string;
  tableDisplayFor: (reservation: Reservation) => string | null;
  onSelect: (reservation: Reservation) => void;
}

export function ReservationWeekView({
  days,
  grouped,
  todayKey,
  timeZone,
  tableDisplayFor,
  onSelect,
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
    borderRightColor: glass.border.profileBase,
  },
  header: {
    minHeight: 56,
    padding: spacing.sm,
    gap: spacing.xxs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
  },
  todayHeader: {
    borderBottomWidth: spacing.xxs,
    borderBottomColor: accent.warm,
  },
  weekday: {
    ...typography.micro,
    color: textTokens.secondary,
  },
  date: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "600",
  },
  count: {
    ...typography.micro,
    color: textTokens.tertiary,
  },
  bookingStack: {
    padding: spacing.xs,
    gap: spacing.xs,
    minHeight: 112,
  },
  noBookings: {
    ...typography.caption,
    color: textTokens.tertiary,
    textAlign: "center",
    marginTop: spacing.md,
  },
});

export default ReservationWeekView;
