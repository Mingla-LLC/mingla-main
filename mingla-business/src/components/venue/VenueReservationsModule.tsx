import React, { useCallback, useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { AlertTriangle, Calendar } from "lucide-react-native";

import {
  androidOpaque,
  glass,
  radius,
  reservationCalendarLayout,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useVenueAvailabilityConfig } from "../../hooks/useVenueAvailability";
import {
  useCreateReservation,
  useTransitionReservation,
  useVenueReservations,
} from "../../hooks/useVenueReservations";
import { useVenueTables } from "../../hooks/useVenueTables";
import { BRAND_ROLE_RANK } from "../../utils/brandRole";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { ReservationCalendarToolbar } from "./ReservationCalendarToolbar";
import { ReservationCard } from "./ReservationCard";
import { ReservationCreateSheet } from "./ReservationCreateSheet";
import { ReservationDetailSheet } from "./ReservationDetailSheet";
import { ReservationMonthView } from "./ReservationMonthView";
import { ReservationWeekView } from "./ReservationWeekView";
import { ACTION_TARGET } from "./reservationViews";
import {
  addCalendarDays,
  calendarRange,
  calendarWeek,
  formatCalendarDay,
  formatCalendarPeriod,
  groupReservationsByVenueDay,
  moveCalendarPeriod,
  projectReservations,
  reservationScopeCounts,
  resolveVenueTimeZone,
  venueTodayKey,
} from "./reservationCalendarModel";
import type {
  ReservationCalendarMode,
  ReservationStatusScope,
} from "./reservationCalendarModel";
import type {
  Reservation,
  ReservationAction,
  ReservationCreateInput,
} from "../../types/venueReservation";

const MANAGER_PLUS_RANK = BRAND_ROLE_RANK.event_manager;

const SCOPE_COPY: Record<ReservationStatusScope, string> = {
  active: "active reservations",
  waitlist: "waitlisted reservations",
  completed: "completed reservations",
  no_shows: "no-shows",
  canceled: "canceled reservations",
};

export interface VenueReservationsModuleProps {
  brandId: string | null;
  venueId?: string | null;
  testID?: string;
}

export function VenueReservationsModule({
  brandId,
  venueId = null,
  testID,
}: VenueReservationsModuleProps): React.ReactElement {
  const { rank } = useCurrentBrandRole(brandId);
  const canMutate = rank >= MANAGER_PLUS_RANK;
  const { isWideDesktop } = useResponsiveLayout();

  const reservationsQuery = useVenueReservations(brandId, venueId);
  const tablesQuery = useVenueTables(brandId, venueId);
  const availabilityQuery = useVenueAvailabilityConfig(brandId, venueId);
  const create = useCreateReservation(brandId, venueId);
  const transition = useTransitionReservation(brandId, venueId);

  const resolvedZone = useMemo(
    () => resolveVenueTimeZone(availabilityQuery.data?.ianaTimezone),
    [availabilityQuery.data?.ianaTimezone],
  );
  const todayKey = venueTodayKey(resolvedZone.timeZone);
  const [anchorDate, setAnchorDate] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [desktopMode, setDesktopMode] = useState<ReservationCalendarMode>("week");
  const [scope, setScope] = useState<ReservationStatusScope>("active");
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [selected, setSelected] = useState<Reservation | null>(null);

  const effectiveMode: ReservationCalendarMode = isWideDesktop
    ? desktopMode
    : "agenda";
  const effectiveAnchor = anchorDate ?? todayKey;
  const effectiveSelectedDay = selectedDay ?? todayKey;
  const range = useMemo(
    () => calendarRange(effectiveAnchor, effectiveMode),
    [effectiveAnchor, effectiveMode],
  );

  const tableNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const table of tablesQuery.data ?? []) map.set(table.id, table.name);
    return map;
  }, [tablesQuery.data]);

  const tableDisplayFor = useCallback(
    (reservation: Reservation): string | null => {
      if (reservation.tableId === null) return null;
      if (tablesQuery.isLoading) return "Loading table…";
      if (tablesQuery.isError) return "Table unavailable";
      const tableName = tableNameById.get(reservation.tableId);
      return tableName === undefined ? "Table unavailable" : `Table ${tableName}`;
    },
    [tableNameById, tablesQuery.isError, tablesQuery.isLoading],
  );

  const reservations = useMemo(
    () => reservationsQuery.data ?? [],
    [reservationsQuery.data],
  );
  const visible = useMemo(
    () =>
      projectReservations(
        reservations,
        range,
        scope,
        resolvedZone.timeZone,
      ),
    [range, reservations, resolvedZone.timeZone, scope],
  );
  const grouped = useMemo(
    () => groupReservationsByVenueDay(visible, resolvedZone.timeZone),
    [resolvedZone.timeZone, visible],
  );
  const counts = useMemo(
    () => reservationScopeCounts(reservations, range, resolvedZone.timeZone),
    [range, reservations, resolvedZone.timeZone],
  );
  const stripDays = useMemo(() => {
    const week = calendarWeek(effectiveAnchor);
    return week.days.map((day) => ({
      key: day.key,
      weekday: formatCalendarDay(day.key, { weekday: "short" }),
      dayNumber: formatCalendarDay(day.key, { day: "numeric" }),
      count: grouped.get(day.key)?.length ?? 0,
      fullLabel: formatCalendarDay(day.key, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
      isToday: day.key === todayKey,
    }));
  }, [effectiveAnchor, grouped, todayKey]);

  const handleSave = useCallback(
    (input: ReservationCreateInput): void => {
      create.mutate(input, { onSuccess: () => setCreateOpen(false) });
    },
    [create],
  );

  const handleAction = useCallback(
    (reservation: Reservation, action: ReservationAction): void => {
      transition.mutate(
        { reservationId: reservation.id, toStatus: ACTION_TARGET[action] },
        { onSuccess: () => setSelected(null) },
      );
    },
    [transition],
  );

  const movePeriod = useCallback(
    (direction: -1 | 1): void => {
      const nextAnchor = moveCalendarPeriod(effectiveAnchor, effectiveMode, direction);
      setAnchorDate(nextAnchor);
      setSelectedDay(
        effectiveMode === "month"
          ? nextAnchor
          : addCalendarDays(effectiveSelectedDay, direction * 7),
      );
    },
    [effectiveAnchor, effectiveMode, effectiveSelectedDay],
  );

  const showInitialSkeleton =
    reservationsQuery.isLoading ||
    (availabilityQuery.isLoading && availabilityQuery.data === undefined);
  const hasStaleData = reservationsQuery.isError && reservations.length > 0;
  const hasBlockingError = reservationsQuery.isError && reservations.length === 0;
  const timezoneDegraded =
    availabilityQuery.isError ||
    availabilityQuery.data === null ||
    resolvedZone.degraded;

  const selectOverflowDay = useCallback((dayKey: string): void => {
    setAnchorDate(dayKey);
    setSelectedDay(dayKey);
    setDesktopMode("agenda");
  }, []);

  const periodLabel = formatCalendarPeriod(effectiveAnchor, effectiveMode);
  const selectedTableName =
    selected?.tableId === null || selected?.tableId === undefined
      ? null
      : (tableNameById.get(selected.tableId) ?? null);

  return (
    <View style={styles.host} testID={testID ?? "venue-reservations-module"}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title} accessibilityRole="header">
            Reservations
          </Text>
          <Text style={styles.subtitle}>
            Bookings from Mingla and your own — all in one list.
          </Text>
        </View>
        {canMutate ? (
          <Button
            label="New"
            onPress={() => setCreateOpen(true)}
            variant="primary"
            size="sm"
            leadingIcon="plus"
            style={styles.newButtonTarget}
            testID="venue-reservations-new"
          />
        ) : null}
      </View>

      <ReservationCalendarToolbar
        isWideDesktop={isWideDesktop}
        mode={effectiveMode}
        periodLabel={periodLabel}
        selectedDayKey={effectiveSelectedDay}
        days={stripDays}
        scope={scope}
        scopeCounts={counts}
        onModeChange={setDesktopMode}
        onPrevious={() => movePeriod(-1)}
        onNext={() => movePeriod(1)}
        onToday={() => {
          setAnchorDate(todayKey);
          setSelectedDay(todayKey);
        }}
        onDaySelect={(dayKey) => {
          setAnchorDate(dayKey);
          setSelectedDay(dayKey);
        }}
        onScopeChange={setScope}
      />

      {timezoneDegraded ? (
        <View
          style={styles.warningBanner}
          accessibilityRole="alert"
          testID="reservation-calendar-timezone-warning"
        >
          <AlertTriangle size={18} color={semantic.warning} />
          <Text style={styles.warningText}>
            Venue timezone unavailable — showing UTC.
          </Text>
        </View>
      ) : null}

      {hasStaleData ? (
        <View style={styles.errorBanner} accessibilityRole="alert">
          <Text style={styles.errorBannerText}>
            Couldn&apos;t refresh. Showing the last update.
          </Text>
          <Button
            label="Retry"
            onPress={async () => {
              await reservationsQuery.refetch();
            }}
            variant="secondary"
            size="md"
            loading={reservationsQuery.isFetching}
            testID="reservation-calendar-stale-retry"
          />
        </View>
      ) : null}

      {showInitialSkeleton ? (
        <CalendarSkeleton mode={effectiveMode} />
      ) : hasBlockingError ? (
        <GlassCard
          variant="base"
          style={styles.stateCard}
          contentStyle={styles.stateCardContent}
          testID="reservation-calendar-error"
        >
          <AlertTriangle size={28} color={semantic.error} />
          <Text style={styles.stateTitle}>Couldn&apos;t load reservations.</Text>
          <Button
            label="Try again"
            onPress={async () => {
              await reservationsQuery.refetch();
            }}
            variant="secondary"
            size="md"
            loading={reservationsQuery.isFetching}
            testID="reservation-calendar-error-retry"
          />
        </GlassCard>
      ) : visible.length === 0 ? (
        <GlassCard
          variant="base"
          style={styles.stateCard}
          contentStyle={styles.stateCardContent}
          testID="reservation-calendar-empty"
        >
          <Calendar size={28} color={textTokens.primary} />
          <Text style={styles.stateTitle}>
            No {SCOPE_COPY[scope]} {effectiveMode === "month" ? "this month" : "this week"}.
          </Text>
          <Text style={styles.stateBody}>
            Try another date{canMutate ? " or add a reservation" : ""}.
          </Text>
          {canMutate ? (
            <Button
              label="New reservation"
              onPress={() => setCreateOpen(true)}
              variant="primary"
              size="md"
              leadingIcon="plus"
              testID="reservation-calendar-empty-add"
            />
          ) : null}
        </GlassCard>
      ) : effectiveMode === "week" ? (
        <ReservationWeekView
          days={range.days}
          grouped={grouped}
          todayKey={todayKey}
          timeZone={resolvedZone.timeZone}
          tableDisplayFor={tableDisplayFor}
          onSelect={setSelected}
        />
      ) : effectiveMode === "month" ? (
        <ReservationMonthView
          days={range.days}
          grouped={grouped}
          todayKey={todayKey}
          timeZone={resolvedZone.timeZone}
          tableDisplayFor={tableDisplayFor}
          onSelect={setSelected}
          onOverflow={selectOverflowDay}
        />
      ) : (
        <View style={styles.agenda} testID="reservation-calendar-agenda">
          {range.days.map((day) => {
            const dayReservations = grouped.get(day.key) ?? [];
            if (dayReservations.length === 0 && day.key !== effectiveSelectedDay) {
              return null;
            }
            return (
              <View key={day.key} style={styles.agendaGroup}>
                <View style={styles.dayHeader}>
                  <Text style={styles.dayHeaderTitle} accessibilityRole="header">
                    {formatCalendarDay(day.key, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                  </Text>
                  <Text style={styles.dayHeaderCount}>
                    {dayReservations.length} booking{dayReservations.length === 1 ? "" : "s"}
                  </Text>
                </View>
                {dayReservations.length === 0 ? (
                  <Text style={styles.dayEmpty}>
                    No {SCOPE_COPY[scope]} on this day.
                  </Text>
                ) : (
                  <View style={styles.agendaRows}>
                    {dayReservations.map((reservation) => (
                      <ReservationCard
                        key={reservation.id}
                        reservation={reservation}
                        tableDisplay={tableDisplayFor(reservation)}
                        timeZone={resolvedZone.timeZone}
                        onPress={setSelected}
                      />
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}

      <ReservationCreateSheet
        venueId={venueId}
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        brandId={brandId}
        onSave={handleSave}
        saving={create.isPending}
      />
      <ReservationDetailSheet
        visible={selected !== null}
        onClose={() => setSelected(null)}
        reservation={selected}
        tableName={selectedTableName}
        onAction={handleAction}
        acting={transition.isPending}
      />
    </View>
  );
}

function CalendarSkeleton({
  mode,
}: {
  mode: ReservationCalendarMode;
}): React.ReactElement {
  const rowCount = mode === "month" ? 12 : mode === "week" ? 7 : 4;
  return (
    <View style={styles.skeleton} accessibilityLabel="Loading reservations">
      <View style={styles.skeletonHeader} />
      {Array.from({ length: rowCount }, (_, index) => (
        <View key={index} style={styles.skeletonRow} />
      ))}
    </View>
  );
}

const warningFill =
  Platform.OS === "android" ? androidOpaque.warningFill : semantic.warningTint;
const errorFill =
  Platform.OS === "android" ? androidOpaque.errorFill : semantic.errorTint;

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 220,
    gap: spacing.xxs,
  },
  title: {
    ...typography.h3,
    color: textTokens.primary,
  },
  subtitle: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  newButtonTarget: {
    minHeight: reservationCalendarLayout.entryMinTarget,
    justifyContent: "center",
  },
  warningBanner: {
    minHeight: reservationCalendarLayout.entryMinTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: semantic.warning,
    backgroundColor: warningFill,
  },
  warningText: {
    ...typography.bodySm,
    color: textTokens.primary,
    flex: 1,
  },
  errorBanner: {
    minHeight: reservationCalendarLayout.entryMinTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: semantic.error,
    backgroundColor: errorFill,
  },
  errorBannerText: {
    ...typography.bodySm,
    color: textTokens.primary,
    flex: 1,
    minWidth: 200,
  },
  stateCard: {
    width: "100%",
    alignSelf: "stretch",
  },
  stateCardContent: {
    maxWidth: 560,
    width: "100%",
    alignSelf: "center",
    alignItems: "center",
    gap: spacing.sm,
  },
  stateTitle: {
    ...typography.h3,
    color: textTokens.primary,
    textAlign: "center",
  },
  stateBody: {
    ...typography.bodySm,
    color: textTokens.secondary,
    textAlign: "center",
  },
  agenda: {
    width: "100%",
    maxWidth: reservationCalendarLayout.agendaMaxWidth,
    alignSelf: "flex-start",
    gap: spacing.lg,
  },
  agendaGroup: {
    gap: spacing.sm,
  },
  dayHeader: {
    minHeight: 36,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    backgroundColor: "rgba(12,14,18,0.94)",
  },
  dayHeaderTitle: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "600",
  },
  dayHeaderCount: {
    ...typography.caption,
    color: textTokens.secondary,
  },
  dayEmpty: {
    ...typography.bodySm,
    color: textTokens.secondary,
    paddingHorizontal: spacing.xs,
  },
  agendaRows: {
    gap: spacing.sm,
  },
  skeleton: {
    gap: spacing.sm,
  },
  skeletonHeader: {
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: glass.tint.profileElevated,
  },
  skeletonRow: {
    minHeight: reservationCalendarLayout.agendaRowMinHeight,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
});

export default VenueReservationsModule;
