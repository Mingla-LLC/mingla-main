import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  SectionList,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { SectionList as SectionListType } from "react-native";
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
import type { FocusableReservationEntry } from "./ReservationCard";
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

interface AgendaSection {
  dayKey: string;
  data: Reservation[];
}

interface FocusableAgendaHeader {
  focus?: () => void;
}

interface PendingAgendaNavigation {
  requestId: number;
  dayKey: string;
  sectionIndex: number | null;
  retryCount: number;
}

interface AgendaScrollFailure {
  index: number;
  highestMeasuredFrameIndex: number;
  averageItemLength: number;
}

const MAX_AGENDA_SCROLL_RETRIES = 2;

export interface VenueReservationsModuleProps {
  brandId: string | null;
  venueId?: string | null;
  scrollBottomPad?: number;
  testID?: string;
}

export function VenueReservationsModule({
  brandId,
  venueId = null,
  scrollBottomPad = 0,
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
  const [retrying, setRetrying] = useState(false);
  const [agendaNavigationVersion, setAgendaNavigationVersion] = useState(0);
  const retryInFlightRef = useRef(false);
  const agendaRef = useRef<SectionListType<Reservation, AgendaSection> | null>(null);
  const agendaHeaderRefs = useRef<Record<string, FocusableAgendaHeader | null>>({});
  const reservationEntryRefs = useRef<
    Record<string, FocusableReservationEntry | null>
  >({});
  const selectedInvokerIdRef = useRef<string | null>(null);
  const pendingAgendaNavigationRef = useRef<PendingAgendaNavigation | null>(null);
  const agendaNavigationSequenceRef = useRef(0);
  const activeAgendaAttemptRef = useRef<number | null>(null);
  const readyAgendaHeadersRef = useRef<Set<string>>(new Set());
  const agendaMountedRef = useRef(true);

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
  const agendaSections = useMemo<AgendaSection[]>(
    () =>
      range.days.flatMap((day) => {
        const dayReservations = grouped.get(day.key) ?? [];
        return dayReservations.length > 0 || day.key === effectiveSelectedDay
          ? [{ dayKey: day.key, data: dayReservations }]
          : [];
      }),
    [effectiveSelectedDay, grouped, range.days],
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

  const closeDetail = useCallback((): void => {
    const invokingId = selectedInvokerIdRef.current;
    setSelected(null);
    if (invokingId === null) return;
    const restore = (): void => {
      reservationEntryRefs.current[invokingId]?.focus?.();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore);
    else setTimeout(restore, 0);
  }, []);

  const handleAction = useCallback(
    (reservation: Reservation, action: ReservationAction): void => {
      transition.mutate(
        { reservationId: reservation.id, toStatus: ACTION_TARGET[action] },
        { onSuccess: () => closeDetail() },
      );
    },
    [closeDetail, transition],
  );

  const handleRetry = useCallback(async (): Promise<void> => {
    if (retryInFlightRef.current || reservationsQuery.isFetching) return;
    retryInFlightRef.current = true;
    setRetrying(true);
    try {
      await reservationsQuery.refetch();
    } finally {
      retryInFlightRef.current = false;
      setRetrying(false);
    }
  }, [reservationsQuery]);

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

  const beginAgendaNavigation = useCallback((dayKey: string): void => {
    const requestId = agendaNavigationSequenceRef.current + 1;
    agendaNavigationSequenceRef.current = requestId;
    pendingAgendaNavigationRef.current = {
      requestId,
      dayKey,
      sectionIndex: null,
      retryCount: 0,
    };
    activeAgendaAttemptRef.current = null;
    setAgendaNavigationVersion((version) => version + 1);
  }, []);

  const selectOverflowDay = useCallback((dayKey: string): void => {
    beginAgendaNavigation(dayKey);
    setAnchorDate(dayKey);
    setSelectedDay(dayKey);
    setDesktopMode("agenda");
  }, [beginAgendaNavigation]);

  const selectAgendaDay = useCallback((dayKey: string): void => {
    beginAgendaNavigation(dayKey);
    setAnchorDate(dayKey);
    setSelectedDay(dayKey);
  }, [beginAgendaNavigation]);

  const selectReservation = useCallback((reservation: Reservation): void => {
    selectedInvokerIdRef.current = reservation.id;
    setSelected(reservation);
  }, []);

  const entryRefFor = useCallback(
    (reservationId: string) =>
      (node: FocusableReservationEntry | null): void => {
        reservationEntryRefs.current[reservationId] = node;
      },
    [],
  );

  const focusAgendaHeader = useCallback((dayKey: string): void => {
    const header = agendaHeaderRefs.current[dayKey];
    if (Platform.OS === "web") header?.focus?.();
    else {
      const handle = findNodeHandle(header as never);
      if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
    }
  }, []);

  const requestExactAgendaNavigation = useCallback(
    (requestId: number): void => {
      if (!agendaMountedRef.current) return;
      const pending = pendingAgendaNavigationRef.current;
      if (
        pending === null ||
        pending.requestId !== requestId ||
        pending.sectionIndex === null
      ) {
        return;
      }
      activeAgendaAttemptRef.current = requestId;
      agendaRef.current?.scrollToLocation({
        animated: false,
        itemIndex: 0,
        sectionIndex: pending.sectionIndex,
        viewOffset: 0,
        viewPosition: 0,
      });
      if (!readyAgendaHeadersRef.current.has(pending.dayKey)) return;
      focusAgendaHeader(pending.dayKey);
      activeAgendaAttemptRef.current = null;
      pendingAgendaNavigationRef.current = null;
    },
    [focusAgendaHeader],
  );

  const scheduleExactAgendaNavigation = useCallback(
    (requestId: number): void => {
      const run = (): void => requestExactAgendaNavigation(requestId);
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
      else setTimeout(run, 0);
    },
    [requestExactAgendaNavigation],
  );

  const handleAgendaHeaderLayout = useCallback(
    (dayKey: string): void => {
      readyAgendaHeadersRef.current.add(dayKey);
      const pending = pendingAgendaNavigationRef.current;
      if (pending?.dayKey === dayKey && pending.sectionIndex !== null) {
        scheduleExactAgendaNavigation(pending.requestId);
      }
    },
    [scheduleExactAgendaNavigation],
  );

  const handleAgendaScrollFailure = useCallback(
    ({ index, averageItemLength }: AgendaScrollFailure): void => {
      const pending = pendingAgendaNavigationRef.current;
      if (
        pending === null ||
        pending.sectionIndex === null ||
        activeAgendaAttemptRef.current !== pending.requestId
      ) {
        return;
      }
      if (pending.retryCount >= MAX_AGENDA_SCROLL_RETRIES) return;

      activeAgendaAttemptRef.current = null;
      pending.retryCount += 1;
      const responder = agendaRef.current?.getScrollResponder();
      if (responder === undefined) return;
      responder.scrollTo({
        animated: false,
        x: 0,
        y: Math.max(0, index * averageItemLength),
      });
      scheduleExactAgendaNavigation(pending.requestId);
    },
    [scheduleExactAgendaNavigation],
  );

  useEffect(() => {
    const pending = pendingAgendaNavigationRef.current;
    if (pending === null) return;
    if (effectiveMode !== "agenda") {
      activeAgendaAttemptRef.current = null;
      pendingAgendaNavigationRef.current = null;
      return;
    }
    const sectionIndex = agendaSections.findIndex(
      (section) => section.dayKey === pending.dayKey,
    );
    if (sectionIndex < 0) {
      activeAgendaAttemptRef.current = null;
      pendingAgendaNavigationRef.current = null;
      return;
    }
    pending.sectionIndex = sectionIndex;
    scheduleExactAgendaNavigation(pending.requestId);
  }, [agendaNavigationVersion, agendaSections, effectiveMode, scheduleExactAgendaNavigation]);

  useEffect(
    () => {
      agendaMountedRef.current = true;
      return () => {
        agendaMountedRef.current = false;
        activeAgendaAttemptRef.current = null;
        pendingAgendaNavigationRef.current = null;
      };
    },
    [],
  );

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
          beginAgendaNavigation(todayKey);
          setAnchorDate(todayKey);
          setSelectedDay(todayKey);
        }}
        onDaySelect={selectAgendaDay}
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
            onPress={handleRetry}
            variant="secondary"
            size="md"
            loading={reservationsQuery.isFetching || retrying}
            testID="reservation-calendar-stale-retry"
          />
        </View>
      ) : null}

      {!showInitialSkeleton && !hasBlockingError && visible.length > 0 && effectiveMode === "agenda" ? (
        <SectionList
          ref={agendaRef}
          sections={agendaSections}
          keyExtractor={(reservation) => reservation.id}
          stickySectionHeadersEnabled
          style={[styles.scrollBody, isWideDesktop ? styles.agendaWide : null]}
          contentContainerStyle={[
            styles.agendaContent,
            { paddingBottom: spacing.lg + scrollBottomPad },
          ]}
          testID="reservation-calendar-agenda"
          renderSectionHeader={({ section }) => (
            <View
              ref={(node) => {
                agendaHeaderRefs.current[section.dayKey] =
                  node as unknown as FocusableAgendaHeader | null;
                if (node === null) readyAgendaHeadersRef.current.delete(section.dayKey);
              }}
              onLayout={() => handleAgendaHeaderLayout(section.dayKey)}
              accessible
              accessibilityRole="header"
              tabIndex={Platform.OS === "web" ? -1 : undefined}
              style={styles.dayHeader}
              testID={`reservation-agenda-header-${section.dayKey}`}
            >
              <Text style={styles.dayHeaderTitle}>
                {formatCalendarDay(section.dayKey, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </Text>
              <Text style={styles.dayHeaderCount}>
                {section.data.length} booking{section.data.length === 1 ? "" : "s"}
              </Text>
            </View>
          )}
          renderItem={({ item }) => (
            <ReservationCard
              reservation={item}
              tableDisplay={tableDisplayFor(item)}
              timeZone={resolvedZone.timeZone}
              onPress={selectReservation}
              entryRef={entryRefFor(item.id)}
            />
          )}
          renderSectionFooter={({ section }) =>
            section.data.length === 0 ? (
              <Text style={styles.dayEmpty}>
                No {SCOPE_COPY[scope]} on this day.
              </Text>
            ) : null
          }
          ItemSeparatorComponent={() => <View style={styles.agendaRowSeparator} />}
          SectionSeparatorComponent={() => <View style={styles.agendaGroupSeparator} />}
          onScrollToIndexFailed={handleAgendaScrollFailure}
        />
      ) : (
        <ScrollView
          style={styles.scrollBody}
          contentContainerStyle={[
            styles.modeScrollContent,
            { paddingBottom: spacing.lg + scrollBottomPad },
          ]}
          showsVerticalScrollIndicator={false}
          testID="reservation-calendar-mode-scroll"
        >
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
                onPress={handleRetry}
                variant="secondary"
                size="md"
                loading={reservationsQuery.isFetching || retrying}
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
              onSelect={selectReservation}
              entryRefFor={entryRefFor}
            />
          ) : effectiveMode === "month" ? (
            <ReservationMonthView
              days={range.days}
              grouped={grouped}
              todayKey={todayKey}
              timeZone={resolvedZone.timeZone}
              tableDisplayFor={tableDisplayFor}
              onSelect={selectReservation}
              onOverflow={selectOverflowDay}
              entryRefFor={entryRefFor}
            />
          ) : null}
        </ScrollView>
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
        onClose={closeDetail}
        reservation={selected}
        tableName={selectedTableName}
        timeZone={resolvedZone.timeZone}
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
    flex: 1,
    minHeight: 0,
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
  scrollBody: {
    flex: 1,
    minHeight: 0,
    width: "100%",
    alignSelf: "flex-start",
  },
  agendaWide: {
    maxWidth: reservationCalendarLayout.agendaMaxWidth,
  },
  agendaContent: {
    flexGrow: 1,
  },
  modeScrollContent: {
    flexGrow: 1,
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
  agendaRowSeparator: {
    height: spacing.sm,
  },
  agendaGroupSeparator: {
    height: spacing.lg,
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
