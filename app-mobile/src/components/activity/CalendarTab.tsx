/**
 * Likes → Calendar tab.
 *
 * Issue #4265 redesign (approved design: Calendar.dc.html + the List · Week ·
 * Month toggle). One agenda merges every plan the user has: scheduled saved
 * cards, ticket orders (ORCH-0829-A / ORCH-0842), venue reservations
 * (META-ORCH-1148), stays (ISSUE-1390) and "Going" RSVPs (ORCH-1163). The
 * merge, dedupe, past/upcoming split (on the effective END — ORCH-0850 /
 * ORCH-0853), grouping and the grids are pure and live in
 * `calendarAgendaModel.ts`; this file owns the data hooks, the existing
 * reschedule / remove / reservation / refund flows, and layout.
 *
 * List renders through a virtualised SectionList. There is no search box: the
 * day strip and the type chips do the narrowing.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
  type SectionListData,
  type SectionListRenderItemInfo,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import ProposeDateTimeModal from "./ProposeDateTimeModal";
import ExpandedCardModal from "../ExpandedCardModal";
import { openExpandedCardContentShare } from "../../services/contentShareController";
import { mixpanelService } from "../../services/mixpanelService";
import { logAppsFlyerEvent } from "../../services/appsFlyerService";
import { recordCardExpand } from "../../services/cardEngagementService";
import {
  ExpandedCardData,
  ReservationPass,
} from "../../types/expandedCardTypes";
// #1669 [expanded-card-one-producer]: Calendar's saved-card rows route through
// the ONE canonical producer instead of a hand-written literal.
import { savedCardToExpandedCardData } from "../utils/savedCardToExpandedCardData";
import { isBrandExperiencePayload } from "../../utils/isBrandExperiencePayload";
import { experienceRecToBusinessEventCard } from "../../utils/experienceRecToBusinessEventCard";
import type { ExpansionTarget } from "../../types/expansion";
import { useAppStore } from "../../store/appStore";
import { toastManager } from "../ui/Toast";
import { HapticFeedback } from "../../utils/hapticFeedback";
import { useFeatureGate } from "../../hooks/useFeatureGate";
import { useA11yPreferences } from "../../hooks/useA11yPreferences";
import { CustomPaywallScreen } from "../CustomPaywallScreen";
import { canonicalDiscoveryPriceFields } from "../../utils/priceTiers";
// ORCH-1019 F-1: curated reschedule validation routes through the canonical
// shared validator (extractWeekdayText + isPlaceOpenAt), same as SavedTab.
import { checkAllCuratedStopsOpen } from "../../utils/curatedStopsAvailability";
import { getUserLocale } from "../../utils/localeUtils";
import {
  useBusinessEventOrders,
  // ORCH-1163 [rsvp-shared-body] — the signed-in user's "Going" RSVPs.
  useMyGoingRsvps,
  useOrdersRealtimeSubscription,
  useRsvpsRealtimeSubscription,
  useTicketsRealtimeSubscription, // ORCH-0854
} from "../../hooks/useCalendarEntries";
import { useMyStayReservations } from "../../hooks/useStayGuest";
import {
  SourceRefundAttentionSheet,
  type SourceRefundBank,
} from "./SourceRefundAttentionSheet";
import {
  cancelMyReservation,
  type MyReservationRow,
  myReservationsKeys,
  useMyReservations,
} from "../../hooks/useMyReservations";
import { supabase } from "../../services/supabase";
import { CalendarPlanMessageButton } from "../brandEnquiry/CalendarPlanMessageButton";
import {
  reservationMessageTarget,
  rsvpMessageTarget,
  stayMessageTarget,
  ticketOrderMessageTarget,
} from "../brandEnquiry/calendarPlanMessage";
import { glass } from "../../constants/designSystem";
import {
  buildDayStrip,
  buildMonthGrid,
  buildUnifiedRows,
  buildWeekGrid,
  dayKeyOf,
  groupByDay,
  matchesTypeFilter,
  shiftMonth,
  sortPast,
  sortUpcoming,
  startOfDay,
  addDays,
  tagsByDay,
  toggleSelectedDay,
  weekStartForLocale,
  type AgendaDayLabel,
  type AgendaTypeFilter,
} from "./calendarAgendaModel";
import type { CalendarAgendaSources, CalendarEntry } from "./calendarAgendaTypes";
import { CalendarAgendaRow, CalendarPastRow, type CalendarRow } from "./CalendarAgendaRow";
import { CalendarDayStrip, CalendarTypeChips, CalendarViewToggle } from "./CalendarControls";
import { CalendarMonthView, CalendarWeekView } from "./CalendarGrids";
import { CalendarAgendaSkeleton, CalendarEmptyCard, CalendarPastToggle } from "./CalendarAgendaStates";
import CalendarPlanActionSheet, { type CalendarPlanAction } from "./CalendarPlanActionSheet";
import { useCalendarViewPref } from "./useCalendarViewPref";

const L = glass.likes;
const LIST_FADE_MS = 200;

type AgendaSection =
  | { key: string; kind: "day"; label: AgendaDayLabel; dayKey: string | null; data: CalendarRow[] }
  | { key: "past"; kind: "past"; total: number; data: CalendarRow[] };

interface CalendarTabProps {
  calendarEntries: CalendarEntry[];
  isLoading?: boolean;
  onRemoveFromCalendar: (entry: CalendarEntry) => void;
  onShareCard: (card: any) => void;
  onAddToCalendar: (entry: CalendarEntry) => void;
  /**
   * [TRANSITIONAL] unused since #4265 — the row's "Ticket" button opens the
   * canonical Purchases ticket / RSVP screen (which owns the QR). The only
   * caller passes a console.log stub. Exit: LikesPage stops passing it, then
   * this prop is deleted.
   */
  onShowQRCode?: (entryId: string) => void;
  /** #4265 — "Plan from my saves" on the empty state switches to the Saved tab. Absent → the button is hidden. */
  onPlanFromSaves?: () => void;
  userPreferences?: any;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
  /**
   * ORCH-1030: a calendar/review notification deep link carries the target
   * entry id here. v1 behavior = SELECT the matching entry (#4265: its day is
   * selected); no scroll. Null/absent → no selection.
   */
  selectedEntryId?: string | null;
  /**
   * ORCH-1189: floating-nav clearance, threaded down from LikesPage
   * (`useAppLayout().bottomNavTotalHeight`). Applied as the INNER scroll content's
   * paddingBottom so the list clears the floating GlassBottomNav while the tab's
   * frame still paints full-bleed to the physical screen bottom (no black bar).
   */
  bottomNavTotalHeight?: number;
}

const CalendarTab = ({
  calendarEntries,
  isLoading = false,
  onRemoveFromCalendar,
  onShareCard,
  onAddToCalendar,
  onPlanFromSaves,
  userPreferences,
  accountPreferences,
  selectedEntryId,
  bottomNavTotalHeight = 0,
}: CalendarTabProps) => {
  const { t } = useTranslation(["activity", "common"]);
  const router = useRouter();
  const { canAccess } = useFeatureGate();
  const { reduceMotion } = useA11yPreferences();
  const locale = getUserLocale();
  const weekStart = useMemo(() => weekStartForLocale(locale), [locale]);
  const [showLockedPaywall, setShowLockedPaywall] = useState(false);
  const [removingEntryId, setRemovingEntryId] = useState<string | null>(null);
  const [showProposeDateTimeModal, setShowProposeDateTimeModal] = useState(
    false,
  );
  const [entryToReschedule, setEntryToReschedule] = useState<
    CalendarEntry | null
  >(null);
  const [isExpandedModalVisible, setIsExpandedModalVisible] = useState(false);
  // ORCH-1064: re-open guard window (block re-present within 500ms of close so the
  // wrapInRNModal modal isn't re-presented mid-dismiss → intermittent freeze).
  const lastModalCloseAtRef = useRef(0);
  // nightOut for places/curated; businessEvent for brand experiences (#1672 Book path)
  const [modalTarget, setModalTarget] = useState<ExpansionTarget | null>(null);
  // META-ORCH-1148 2.2f — the Confirmed reservation pass injected into the
  // ExpandedCardModal when a reservation row is tapped (null for normal cards).
  const [reservationPassForModal, setReservationPassForModal] = useState<
    ReservationPass | null
  >(null);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [attentionRefundId, setAttentionRefundId] = useState<string | null>(
    null,
  );
  const [attentionSubmitting, setAttentionSubmitting] = useState(false);
  const [attentionError, setAttentionError] = useState<string | null>(null);
  const [attentionDeliveryParked, setAttentionDeliveryParked] = useState(false);
  const [attentionBanks, setAttentionBanks] = useState<SourceRefundBank[]>([]);
  const [attentionBanksLoading, setAttentionBanksLoading] = useState(false);
  // #4265 — agenda state.
  const [typeFilter, setTypeFilter] = useState<AgendaTypeFilter>("all");
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [actionRow, setActionRow] = useState<CalendarRow | null>(null);
  const afterActionSheetRef = useRef<(() => void) | null>(null);
  const { user } = useAppStore();
  const queryClient = useQueryClient();
  const { view, setView } = useCalendarViewPref(user?.id);
  const loadAttentionBanks = useCallback(async () => {
    if (!attentionRefundId) return;
    setAttentionBanksLoading(true);
    const { data, error } = await supabase.functions.invoke(
      "source-refund-attention",
      { body: { mode: "banks", refundId: attentionRefundId } },
    );
    setAttentionBanks(error ? [] : (data?.banks ?? []));
    setAttentionBanksLoading(false);
  }, [attentionRefundId]);
  useEffect(() => {
    if (attentionRefundId) void loadAttentionBanks();
  }, [attentionRefundId, loadAttentionBanks]);

  const businessOrdersQuery = useBusinessEventOrders(user?.id);
  const reservationsQuery = useMyReservations(user?.id);
  // ISSUE-1390 — Stay reservations join the same consumer itinerary.
  const staysQuery = useMyStayReservations(user?.id ?? null);
  const goingRsvpsQuery = useMyGoingRsvps(user?.id);
  const myReservations = useMemo(() => reservationsQuery.data ?? [], [reservationsQuery.data]);

  // Realtime freshness. Each hook subscribes in an effect keyed on
  // [userId, queryClient] and removes its channel on cleanup, so a re-render
  // never re-subscribes.
  // ORCH-0851 H-1: `orders` for this buyer → businessEventOrders.
  useOrdersRealtimeSubscription(user?.id);
  // ORCH-0854 H-1: `tickets` valid → used flips from the door scanner.
  useTicketsRealtimeSubscription(user?.id);
  // ORCH-1163: `event_rsvps` approval / status changes.
  useRsvpsRealtimeSubscription(user?.id);

  // Pull to refresh refreshes EVERY source the agenda reads.
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["calendarEntries", user?.id],
        }),
        businessOrdersQuery.refetch(),
        reservationsQuery.refetch(),
        staysQuery.refetch(),
        goingRsvpsQuery.refetch(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [
    queryClient,
    user?.id,
    businessOrdersQuery.refetch,
    reservationsQuery.refetch,
    staysQuery.refetch,
    goingRsvpsQuery.refetch,
  ]);

  // #1221 — cancel one of MY reservations and render only durable refund truth.
  const handleCancelReservation = useCallback(
    (reservation: MyReservationRow) => {
      Alert.alert(
        "Cancel this reservation?",
        `${
          reservation.brand_name ?? "This venue"
        } · party of ${reservation.party_size}`,
        [
          { text: "Keep it", style: "cancel" },
          {
            text: "Cancel reservation",
            style: "destructive",
            onPress: () => {
              void (async () => {
                try {
                  const result = await cancelMyReservation(reservation.id);
                  if (user?.id) {
                    await queryClient.invalidateQueries({
                      queryKey: myReservationsKeys.byUser(user.id),
                    });
                  }
                  const amount = result.refund?.amount_cents
                    ? new Intl.NumberFormat(undefined, {
                      style: "currency",
                      currency: result.refund.currency,
                    }).format(result.refund.amount_cents / 100)
                    : null;
                  const hadDeposit = (reservation.fee_cents ?? 0) > 0 &&
                    reservation.payment_status === "paid";
                  Alert.alert(
                    "Reservation cancelled",
                    result.refund?.buyer_state === "processed" && amount
                      ? `Your ${amount} deposit refund has been processed.`
                      : result.refund?.buyer_state === "needs_attention"
                      ? "Action is needed to continue your deposit refund."
                      : result.refund
                      ? "Your deposit refund is processing. You can track it here."
                      : hadDeposit
                      ? "Your reservation has been cancelled. Your deposit is non-refundable after the venue's cancellation cutoff."
                      : "Your reservation has been cancelled.",
                  );
                  if (result.refund?.buyer_state === "needs_attention") {
                    setAttentionDeliveryParked(
                      (result.refund as typeof result.refund & {
                        attentionDeliveryState?: string;
                      }).attentionDeliveryState === "parked",
                    );
                    setAttentionRefundId(result.refund.refund_id);
                  }
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  Alert.alert(
                    "Couldn't cancel",
                    msg.includes("cutoff")
                      ? "The cancellation window has passed for this reservation."
                      : "We couldn't cancel your reservation. Please try again.",
                  );
                }
              })();
            },
          },
        ],
      );
    },
    [queryClient, user?.id],
  );

  // #4111 Wave D (D6) — every plan item (ticket order, RSVP, reservation,
  // stay) carries "Message {Brand}", opening the sheet with that plan picked.
  // A reservation's "Cancel it yourself" runs THIS tab's cancel flow (with its
  // refund truth), not a second one.
  const cancelReservationById = useCallback(
    (reservationId: string): void => {
      const reservation = myReservations.find((r) => r.id === reservationId);
      if (reservation !== undefined) handleCancelReservation(reservation);
    },
    [handleCancelReservation, myReservations],
  );

  // ── The agenda: every source parsed once, deduped by entity identity ─────
  // `now` is captured per data change (not per render) so the past/upcoming
  // split is stable while the user scrolls.
  const allRows = useMemo<CalendarRow[]>(
    () =>
      buildUnifiedRows<CalendarAgendaSources>(
        {
          calendarEntries,
          ticketOrders: businessOrdersQuery.data ?? [],
          reservations: myReservations,
          stays: staysQuery.data ?? [],
          rsvps: goingRsvpsQuery.data ?? [],
        },
        Date.now(),
      ),
    [
      calendarEntries,
      businessOrdersQuery.data,
      myReservations,
      staysQuery.data,
      goingRsvpsQuery.data,
    ],
  );

  const today = useMemo(() => startOfDay(new Date()), [allRows]);
  const todayKey = dayKeyOf(today);
  const [weekAnchor, setWeekAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), monthIndex: now.getMonth() };
  });
  const [monthDayKey, setMonthDayKey] = useState<string>(() => dayKeyOf(new Date()));

  const typedRows = useMemo(
    () => allRows.filter((row) => matchesTypeFilter(row.tag, typeFilter)),
    [allRows, typeFilter],
  );
  const upcomingRows = useMemo(
    () => sortUpcoming(typedRows.filter((row) => !row.isPast)),
    [typedRows],
  );
  const pastRows = useMemo(
    () => sortPast(typedRows.filter((row) => row.isPast)),
    [typedRows],
  );
  const dayTags = useMemo(() => tagsByDay(typedRows), [typedRows]);
  const upcomingDayTags = useMemo(() => tagsByDay(upcomingRows), [upcomingRows]);

  // ORCH-1030: a notification deep link selects its entry's day.
  useEffect(() => {
    if (!selectedEntryId) return;
    const match = allRows.find(
      (row) => row.kind === "calendar" && row.entry.id === selectedEntryId,
    );
    if (match?.dayKey) {
      setView("list");
      setSelectedDayKey(match.dayKey);
    }
  }, [selectedEntryId, allRows, setView]);

  // ── Formatting (the viewer's locale and timezone) ───────────────────────
  const formats = useMemo(
    () => ({
      time: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }),
      day: new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }),
    }),
    [locale],
  );
  const timeLabel = useCallback(
    (row: CalendarRow): string =>
      Number.isFinite(row.startMs) ? formats.time.format(new Date(row.startMs)) : "",
    [formats],
  );
  const pastLabel = useCallback(
    (row: CalendarRow): string =>
      Number.isFinite(row.startMs) ? formats.day.format(new Date(row.startMs)) : "",
    [formats],
  );
  const sectionLabel = useCallback(
    (label: AgendaDayLabel, dayKey: string | null): string => {
      if (label === "today") return t("activity:calendarTab.today");
      if (label === "tomorrow") return t("activity:calendarTab.tomorrow");
      if (label === "undated" || dayKey === null) return t("activity:calendarTab.dateToBeSet");
      const [y, m, d] = dayKey.split("-").map(Number);
      return formats.day.format(new Date(y, m - 1, d));
    },
    [formats, t],
  );

  // ── Sections per view ───────────────────────────────────────────────────
  const sections = useMemo<AgendaSection[]>(() => {
    if (view === "week") return [];
    if (view === "month") {
      const data = sortUpcoming(typedRows.filter((row) => row.dayKey === monthDayKey));
      return data.length === 0
        ? []
        : [{ key: monthDayKey, kind: "day", label: groupByDay(data, todayKey)[0].label, dayKey: monthDayKey, data }];
    }
    const visible = selectedDayKey === null
      ? upcomingRows
      : upcomingRows.filter((row) => row.dayKey === selectedDayKey);
    const out: AgendaSection[] = groupByDay(visible, todayKey).map((group) => ({
      key: group.key,
      kind: "day" as const,
      label: group.label,
      dayKey: group.dayKey,
      data: group.data,
    }));
    if (pastRows.length > 0) {
      out.push({ key: "past", kind: "past", total: pastRows.length, data: showPast ? pastRows : [] });
    }
    return out;
  }, [view, typedRows, monthDayKey, todayKey, selectedDayKey, upcomingRows, pastRows, showPast]);

  const hasUpcomingInView = sections.some((s) => s.kind === "day" && s.data.length > 0);

  const strip = useMemo(
    () => buildDayStrip(today, upcomingDayTags, selectedDayKey),
    [today, upcomingDayTags, selectedDayKey],
  );
  const week = useMemo(
    () => buildWeekGrid(weekAnchor, weekStart, today, sortUpcoming(typedRows)),
    [weekAnchor, weekStart, today, typedRows],
  );
  const monthCells = useMemo(
    () => buildMonthGrid(month.year, month.monthIndex, weekStart, today, monthDayKey, dayTags),
    [month, weekStart, today, monthDayKey, dayTags],
  );

  // A single fade of the list on first mount; none under reduce motion.
  const listOpacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) {
      listOpacity.setValue(1);
      return;
    }
    Animated.timing(listOpacity, {
      toValue: 1,
      duration: LIST_FADE_MS,
      useNativeDriver: true,
    }).start();
    // First mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mainScrollContent = useMemo(
    () => [styles.listContent, { paddingBottom: bottomNavTotalHeight + 24 }],
    [bottomNavTotalHeight],
  );

  const handleReschedule = (entry: CalendarEntry) => {
    setEntryToReschedule(entry);
    setShowProposeDateTimeModal(true);
  };

  const handleProposeDateTime = async (
    date: Date,
    dateOption: "now" | "today" | "weekend" | "custom",
  ) => {
    if (!entryToReschedule || !user?.id) {
      Alert.alert(
        t("activity:calendarTab.rescheduleErrorTitle"),
        t("activity:calendarTab.rescheduleError"),
      );
      setShowProposeDateTimeModal(false);
      setEntryToReschedule(null);
      return;
    }

    // ORCH-1019 F-1(c): for curated entries, validate every stop's hours at the
    // chosen datetime BEFORE committing the reschedule — same canonical
    // validator as SavedTab (no bespoke day-key lookup). On any closed/unknown
    // stop, show "Not Safe to Schedule" and do NOT silently commit; regular
    // (single-place) entries skip this and keep their existing advisory path.
    const rescheduleStops = (entryToReschedule.experience as any)?.stops;
    if (Array.isArray(rescheduleStops) && rescheduleStops.length > 0) {
      const { allOpen, results } = checkAllCuratedStopsOpen(
        rescheduleStops,
        date,
        getUserLocale(),
      );
      if (!allOpen) {
        const unavailableList = results
          .filter((r) => !r.isOpen)
          .map((s) => `  • ${s.stopName} — ${s.reason}`)
          .join("\n");
        setShowProposeDateTimeModal(false);
        Alert.alert(
          "Not Safe to Schedule",
          `Mingla could not confirm every stop is open at the time you selected:\n\n${unavailableList}\n\nPlease choose a different time when all stops are confirmed open.`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Choose New Time",
              onPress: () => setShowProposeDateTimeModal(true),
            },
          ],
        );
        return;
      }
    }

    setIsScheduling(true);
    try {
      const { CalendarService } = await import(
        "../../services/calendarService"
      );
      const { DeviceCalendarService } = await import(
        "../../services/deviceCalendarService"
      );

      const scheduledDateISO = date.toISOString();

      // 1. Update the calendar entry in Supabase
      await CalendarService.updateEntry(entryToReschedule.id, user.id, {
        scheduled_at: scheduledDateISO,
      });

      // 2. Update device calendar
      try {
        const cardData = entryToReschedule.experience || entryToReschedule;

        if (entryToReschedule.device_calendar_event_id) {
          // Direct update by stored event ID — reliable
          const endDate = new Date(
            date.getTime() +
              (entryToReschedule.duration_minutes || 120) * 60_000,
          );
          await DeviceCalendarService.updateEventOnDeviceCalendar(
            entryToReschedule.device_calendar_event_id,
            { startDate: date, endDate },
          );
        } else {
          // Fallback: delete-then-recreate (for entries without stored ID)
          const oldDate = entryToReschedule.scheduled_at
            ? new Date(entryToReschedule.scheduled_at)
            : entryToReschedule.suggestedDates?.[0]
            ? new Date(entryToReschedule.suggestedDates[0])
            : null;

          if (oldDate && cardData.title) {
            await DeviceCalendarService.removeEventByTitleAndDate(
              cardData.title,
              oldDate,
            );
            // Curated cards use "Mingla Plan: StopA → StopB" title format
            if (cardData.stops?.length > 0) {
              const stopNames = cardData.stops.map((s: any) =>
                s.placeName || s.title
              ).join(" → ");
              await DeviceCalendarService.removeEventByTitleAndDate(
                `Mingla Plan: ${stopNames}`,
                oldDate,
              );
            }
          }

          // ORCH-1019 F-4: curated reschedule must rebuild with the multi-stop
          // builder so every stop's "Stop N / Address: …" line survives
          // (createEventFromCard emits only the first stop's address). Mirrors
          // the initial-schedule branch at SavedTab.tsx:1415-1420. Only this
          // no-stored-ID recreate fallback is touched — the stored-ID patch
          // branch above preserves notes and is NOT modified.
          const isCuratedEntry = Array.isArray(cardData.stops) &&
            cardData.stops.length > 0;
          const deviceEvent = isCuratedEntry
            ? DeviceCalendarService.createEventFromCuratedCard(
              cardData,
              date,
              cardData.estimatedDurationMinutes ||
                entryToReschedule.duration_minutes || 120,
            )
            : DeviceCalendarService.createEventFromCard(
              cardData,
              date,
              entryToReschedule.duration_minutes || 120,
            );
          const newEventId = await DeviceCalendarService
            .addEventToDeviceCalendar(deviceEvent);

          // Store the new event ID for future reschedule
          if (newEventId && entryToReschedule.id) {
            CalendarService.updateEntry(entryToReschedule.id, user!.id, {
              device_calendar_event_id: newEventId,
            }).catch((err) =>
              console.warn("Failed to store device calendar event ID:", err)
            );
          }
        }
      } catch (deviceCalendarError) {
        console.warn("Failed to update device calendar:", deviceCalendarError);
        Alert.alert(
          t("activity:calendarTab.noteTitle"),
          t("activity:calendarTab.noteCalendarNotUpdated"),
        );
      }

      // 3. Invalidate calendar entries query to refresh the list
      queryClient.invalidateQueries({ queryKey: ["calendarEntries", user.id] });

      // 4. Track experience rescheduled
      mixpanelService.trackExperienceRescheduled({
        entryId: entryToReschedule.id,
        entryTitle: entryToReschedule.title || "Unknown",
        category: entryToReschedule.category,
        newScheduledDate: scheduledDateISO,
        dateOption,
      });
      logAppsFlyerEvent("experience_rescheduled", {
        af_content_type: entryToReschedule.category,
        new_date: scheduledDateISO,
        date_option: dateOption,
      });

      // 5. Show success message
      toastManager.success(
        t("activity:calendarTab.rescheduledSuccess", {
          title: entryToReschedule.title || "Experience",
        }),
        3000,
      );

      // 6. Close modal and reset state
      setShowProposeDateTimeModal(false);
      setEntryToReschedule(null);
    } catch (error: any) {
      console.error("Error rescheduling calendar entry:", error);
      Alert.alert(
        t("activity:calendarTab.rescheduleFailed"),
        error.message ||
          t("activity:calendarTab.rescheduleFailedMsg"),
      );
      setShowProposeDateTimeModal(false);
      setEntryToReschedule(null);
    } finally {
      setIsScheduling(false);
    }
  };

  const getIconComponent = (iconName: any) => {
    if (typeof iconName === "function") {
      return iconName;
    }

    const iconMap: { [key: string]: string } = {
      Coffee: "cafe",
      TreePine: "leaf",
      Sparkles: "sparkles",
      Dumbbell: "fitness",
      Utensils: "restaurant",
      Eye: "eye",
      Heart: "heart",
      Calendar: "calendar",
      MapPin: "location",
      Clock: "time",
      Star: "star",
      Navigation: "navigate",
      Users: "people",
      Check: "checkmark",
      ThumbsUp: "thumbs-up",
      ThumbsDown: "thumbs-down",
      MessageSquare: "chatbubble",
      Share2: "share",
      X: "close",
      ChevronRight: "chevron-forward",
      ChevronLeft: "chevron-back",
      Bookmark: "bookmark",
    };

    return iconMap[iconName] || "heart";
  };

  const handleRemoveFromCalendar = async (entry: CalendarEntry) => {
    if (removingEntryId) return; // Prevent multiple simultaneous removals
    HapticFeedback.error();

    setRemovingEntryId(entry.id);
    try {
      await onRemoveFromCalendar(entry);
    } catch (error) {
      console.error("Error removing from calendar:", error);
    } finally {
      setRemovingEntryId(null);
    }
  };

  const handleCardExpand = (entry: CalendarEntry) => {
    // ORCH-1064: ignore a re-open within 500ms of the last close (re-present-mid-dismiss freeze)
    if (Date.now() - lastModalCloseAtRef.current < 500) return;
    HapticFeedback.buttonPress();
    // Transform CalendarEntry to ExpandedCardData format
    const experience = entry.experience || entry;
    const ExperienceIcon = getIconComponent(
      experience.categoryIcon || entry.categoryIcon,
    );

    // Detect curated multi-stop card
    const cardData = experience || {};
    const isCurated = Array.isArray(cardData.stops) &&
      cardData.stops.length > 0;

    // #1669 [expanded-card-one-producer]: Calendar used to hand-write this
    // object. That literal fabricated `rating || 4.5`, dropped
    // `utcOffsetMinutes` (so Open now / Closed was computed against the
    // VIEWER's clock, not the venue's), and rebuilt curated plans from a fixed
    // 9-key allowlist. It now normalises its own two-level source shape
    // (`entry` + `entry.experience`) and hands that to the ONE producer.
    //
    // The merge keeps the old `experience.X || entry.X` preference: a value on
    // the nested experience wins only when it is actually present.
    const source: Record<string, unknown> = {
      ...(entry as unknown as Record<string, unknown>),
    };
    for (const [key, value] of Object.entries(
      experience as unknown as Record<string, unknown>,
    )) {
      if (value !== undefined && value !== null && value !== "") {
        source[key] = value;
      }
    }
    // Calendar-owned identity + field-name normalisation.
    source.id = entry.id;
    source.placeId = experience.placeId || (entry as any).placeId;
    const boardCardId = (
      entry as unknown as { board_card_id?: unknown }
    ).board_card_id;
    const collaborationSourceRecordId =
      entry.source === "collaboration" &&
      typeof boardCardId === "string" &&
      boardCardId.trim().length > 0
        ? boardCardId.trim()
        : undefined;
    if (collaborationSourceRecordId) {
      source.sourceScope = "collaboration";
      source.sourceRecordId = collaborationSourceRecordId;
      source.savedCardId = collaborationSourceRecordId;
    }
    source.category = experience.category || entry.category || "Experience";
    source.categoryIcon = ExperienceIcon;
    source.phone = experience.phoneNumber || entry.phoneNumber;

    // #1672 / #3281 1d — brand experiences open the Book path, not curated.
    if (isBrandExperiencePayload(source)) {
      setModalTarget({
        kind: "businessEvent",
        data: experienceRecToBusinessEventCard(source),
      });
      setIsExpandedModalVisible(true);
      recordCardExpand((entry as any).card_id || entry.id, {
        category: experience.category || (entry as any).category,
        priceTier: undefined,
        isCurated: false,
      });
      mixpanelService.trackCardExpanded({
        cardId: (entry as any).card_id || entry.id,
        cardTitle: experience.title || entry.title,
        category: experience.category || entry.category || "Experience",
        source: "calendar",
      });
      return;
    }

    const expandedCardData = savedCardToExpandedCardData(source, {
      selectedDateTime: entry.suggestedDates?.[0]
        ? new Date(entry.suggestedDates[0])
        : entry.date && entry.time
        ? new Date(`${entry.date}T${entry.time}`)
        : new Date(),
    });
    if (!expandedCardData) return;

    setModalTarget({ kind: "nightOut", data: expandedCardData });
    setIsExpandedModalVisible(true);

    // ORCH-0408 Phase 4: Record expand — counter + user interaction log (fire-and-forget)
    recordCardExpand((entry as any).card_id || entry.id, {
      category: experience.category || (entry as any).category,
      priceTier: isCurated ? (experience as any).priceTier || null : null,
      isCurated: !!(experience as any).stops,
    });

    // Track card expanded (fixed: use card_id instead of calendar entry UUID)
    mixpanelService.trackCardExpanded({
      cardId: (entry as any).card_id || entry.id,
      cardTitle: experience.title || entry.title,
      category: experience.category || entry.category || "Experience",
      source: "calendar",
    });
  };

  const handleCloseExpandedModal = () => {
    setIsExpandedModalVisible(false);
    setModalTarget(null);
    setReservationPassForModal(null);
    lastModalCloseAtRef.current = Date.now(); // ORCH-1064: re-open guard window
  };

  // META-ORCH-1148 2.2f — tapping a reservation opens the SAME ExpandedCardModal
  // the app uses for venues (its weather / directions / gallery), with the
  // Confirmed reservation pass (banner + check-in QR + details) injected on top.
  const handleReservationPress = (reservation: MyReservationRow) => {
    if (Date.now() - lastModalCloseAtRef.current < 500) return; // re-open guard
    HapticFeedback.buttonPress();

    // Cover media for the modal's ImageGallery — which plays VIDEO covers via
    // isVideoUrl/EventCoverMedia, so pass the cover URL regardless of type
    // (image OR video); fall back to the profile photo. (Earlier this dropped
    // video covers → the "no images" placeholder.)
    const image = reservation.brand_cover_url || reservation.brand_photo_url ||
      "";
    const hasCoords = typeof reservation.brand_lat === "number" &&
      typeof reservation.brand_lng === "number";
    const startMs = Date.parse(reservation.reserved_for);

    // Minimal venue ExpandedCardData → renders the modal's place branch with
    // weather (from location) + directions (from address) + gallery.
    const venueCard: ExpandedCardData = {
      id: `reservation:${reservation.id}`,
      placeId: reservation.brand_id,
      title: reservation.brand_name ?? "Your reservation",
      category: "Restaurant",
      categoryIcon: getIconComponent("restaurant"),
      description: "",
      fullDescription: "",
      image,
      images: image ? [image] : [],
      rating: 0,
      reviewCount: 0,
      priceRange: undefined,
      distance: "",
      travelTime: undefined,
      address: reservation.brand_address ?? "",
      openingHours: undefined,
      phone: undefined,
      website: undefined,
      highlights: [],
      tags: [],
      matchScore: 0,
      matchFactors: {
        location: 0,
        budget: 0,
        category: 0,
        time: 0,
        popularity: 0,
      },
      socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
      priceTier: undefined,
      location: hasCoords
        ? {
          lat: reservation.brand_lat as number,
          lng: reservation.brand_lng as number,
        }
        : undefined,
      selectedDateTime: Number.isFinite(startMs)
        ? new Date(startMs)
        : new Date(),
    };

    const cancellable = Number.isFinite(startMs) &&
      startMs > Date.now() &&
      (reservation.status === "confirmed" ||
        reservation.status === "requested");

    const pass: ReservationPass = {
      reservationId: reservation.id,
      status: reservation.status,
      reservedForUtc: reservation.reserved_for,
      partySize: reservation.party_size,
      feeCents: reservation.fee_cents,
      feeCurrency: reservation.fee_currency,
      paymentStatus: reservation.payment_status,
      occasion: reservation.occasion,
      guestNotes: reservation.guest_notes,
      venueName: reservation.brand_name,
      address: reservation.brand_address,
      confirmationRef: `RES-${
        reservation.id.replace(/-/g, "").slice(0, 6).toUpperCase()
      }`,
      cancellable,
      onCancel: cancellable
        ? () => {
          handleCloseExpandedModal();
          handleCancelReservation(reservation);
        }
        : undefined,
    };

    setModalTarget({ kind: "nightOut", data: venueCard });
    setReservationPassForModal(pass);
    setIsExpandedModalVisible(true);
  };

  const handleSaveFromModal = async (card: ExpandedCardData) => {
    // Card is already saved (it's in calendar), so this might be a no-op
    // or could trigger a re-save/update
    handleCloseExpandedModal();
  };

  const handlePurchaseFromModal = (
    card: ExpandedCardData,
    bookingOption: any,
  ) => {
    // Handle purchase if needed
    // Could open external link or show purchase flow
    if (bookingOption.url) {
      WebBrowser.openBrowserAsync(bookingOption.url).catch(() => {
        Linking.openURL(bookingOption.url);
      });
    }
  };

  const handleShareFromModal = (card: ExpandedCardData) => {
    openExpandedCardContentShare(card, 'calendar_expanded');
  };

  // Convert CalendarEntry to SavedCard format for ProposeDateTimeModal
  const entryToCard = (entry: CalendarEntry) => {
    // ORCH-1019 F-1(a): carry the curated payload so the reschedule modal
    // routes the curated flow (canonical per-stop hours) instead of the
    // regular single-place flow. entry.experience is { ...card_data, id }
    // (AppStateManager.tsx:587), and card_data carries these via the
    // calendarService allowlist (L158-168). Presence of `stops` drives
    // isCurated downstream — see the modal render + handleProposeDateTime.
    const exp = (entry.experience || {}) as any;
    return {
      id: entry.id,
      title: entry.experience?.title || entry.title,
      category: entry.experience?.category || entry.category,
      categoryIcon: entry.experience?.categoryIcon || entry.categoryIcon,
      image: entry.experience?.image || entry.image,
      images: entry.experience?.images || entry.images,
      rating: entry.experience?.rating || entry.rating,
      reviewCount: entry.experience?.reviewCount || entry.reviewCount,
      priceRange: entry.experience?.priceRange || entry.priceRange,
      ...canonicalDiscoveryPriceFields(
        (entry.experience || entry) as Record<string, unknown>,
      ),
      travelTime: entry.experience?.travelTime,
      description: entry.experience?.description || entry.description,
      fullDescription: entry.experience?.fullDescription ||
        entry.fullDescription,
      address: entry.experience?.address || entry.address,
      openingHours: entry.experience?.openingHours,
      highlights: entry.experience?.highlights || entry.highlights,
      matchScore: entry.experience?.matchScore,
      socialStats: entry.experience?.socialStats || entry.socialStats,
      source: entry.source || "solo",
      dateAdded: entry.suggestedDates?.[0] || entry.date,
      // ORCH-1019 F-1(a): curated fields (sourced from entry.experience).
      stops: exp.stops,
      cardType: exp.cardType,
      tagline: exp.tagline,
      pairingKey: exp.pairingKey,
      experienceType: exp.experienceType,
      totalPriceMin: exp.totalPriceMin,
      totalPriceMax: exp.totalPriceMax,
      estimatedDurationMinutes: exp.estimatedDurationMinutes,
    };
  };

  // ── Row actions ─────────────────────────────────────────────────────────
  const openTicket = (row: CalendarRow): void => {
    if (row.kind === "ticket") {
      // #4063: the canonical Purchases ticket screen owns the QR / pass.
      const firstTicketId = row.row.tickets.find((ticket) => ticket.status === "valid")?.id;
      const suffix = firstTicketId
        ? `?ticket=${encodeURIComponent(firstTicketId)}`
        : "";
      router.push(`/purchases/order/${encodeURIComponent(row.row.orderId)}${suffix}` as never);
    } else if (row.kind === "rsvp") {
      router.push(`/purchases/rsvp/${row.rsvp.guestId ?? row.rsvp.rsvpId}` as never);
    }
  };

  const openRow = (row: CalendarRow): void => {
    switch (row.kind) {
      case "calendar":
        handleCardExpand(row.entry);
        return;
      case "ticket":
        if (row.row.paymentStatus === "pending") {
          // Pending-payment guard (ORCH-0829-A): no ticket yet — say so.
          toastManager.info(t("activity:calendarTab.statusFinalizing"));
          return;
        }
        openTicket(row);
        return;
      case "rsvp":
        openTicket(row);
        return;
      case "reservation":
        handleReservationPress(row.reservation);
        return;
      case "stay":
        router.push(`/stay/${row.group.groupId}` as never);
        return;
      default: {
        const never: never = row;
        return never;
      }
    }
  };

  // "Again": a scheduled card reopens the existing reschedule flow; every
  // other kind has no schedule-again path, so it opens the plan's detail.
  const againRow = (row: CalendarRow): void => {
    if (row.kind === "calendar") {
      HapticFeedback.buttonPress();
      handleReschedule(row.entry);
      return;
    }
    openRow(row);
  };

  // Stable identities for the memoised rows: the latest closures live in a
  // ref, the callbacks handed to rows never change.
  const rowHandlersRef = useRef({ openRow, openTicket, againRow });
  rowHandlersRef.current = { openRow, openTicket, againRow };
  const onOpenRow = useCallback((row: CalendarRow) => rowHandlersRef.current.openRow(row), []);
  const onTicketRow = useCallback((row: CalendarRow) => rowHandlersRef.current.openTicket(row), []);
  const onAgainRow = useCallback((row: CalendarRow) => rowHandlersRef.current.againRow(row), []);
  const onMoreRow = useCallback((row: CalendarRow) => {
    HapticFeedback.light();
    setActionRow(row);
  }, []);

  // A second modal must wait until the sheet is fully dismissed, or iOS drops
  // the presentation (same parking as SavedTab's menu).
  const runAfterSheet = (fn: () => void): void => {
    afterActionSheetRef.current = fn;
    setActionRow(null);
  };

  const sheetActions = useMemo<CalendarPlanAction[]>(() => {
    const row = actionRow;
    if (row === null) return [];
    if (row.kind === "calendar") {
      const entry = row.entry;
      return [
        { key: "reschedule", icon: "calendar", label: t("activity:calendarTab.reschedule"), onPress: () => runAfterSheet(() => handleReschedule(entry)) },
        { key: "share", icon: "share-outline", label: t("activity:calendarTab.actionShare"), onPress: () => runAfterSheet(() => onShareCard(entry.experience || entry)) },
        { key: "phone", icon: "add-circle-outline", label: t("activity:calendarTab.actionAddToPhone"), onPress: () => runAfterSheet(() => onAddToCalendar(entry)) },
        {
          key: "remove",
          icon: "trash-outline",
          label: t("activity:calendarTab.actionRemove"),
          danger: true,
          busy: removingEntryId === entry.id,
          onPress: () => runAfterSheet(() => void handleRemoveFromCalendar(entry)),
        },
      ];
    }
    const actions: CalendarPlanAction[] = [
      { key: "open", icon: "open-outline", label: t("activity:calendarTab.actionOpen"), onPress: () => runAfterSheet(() => openRow(row)) },
    ];
    if (row.kind === "reservation") {
      const startMs = Date.parse(row.reservation.reserved_for);
      const cancellable = Number.isFinite(startMs) && startMs > Date.now() &&
        (row.reservation.status === "confirmed" || row.reservation.status === "requested");
      if (cancellable) {
        const reservation = row.reservation;
        actions.push({
          key: "cancel",
          icon: "close-circle-outline",
          label: t("activity:calendarTab.actionCancelReservation"),
          danger: true,
          onPress: () => runAfterSheet(() => handleCancelReservation(reservation)),
        });
      }
    }
    return actions;
    // The handlers are re-created each render; the sheet only needs the row's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionRow, removingEntryId, t]);

  // #4111 Wave D (D6) — every non-card plan carries "Message {Brand}".
  const sheetMessageControl = useMemo(() => {
    const row = actionRow;
    if (row === null || row.kind === "calendar") return null;
    const target = row.kind === "reservation"
      ? reservationMessageTarget(row.reservation)
      : row.kind === "stay"
      ? stayMessageTarget(row.group)
      : row.kind === "rsvp"
      ? rsvpMessageTarget(row.rsvp)
      : ticketOrderMessageTarget(row.row);
    return (
      <CalendarPlanMessageButton
        target={target}
        onCancelReservation={row.kind === "reservation" ? cancelReservationById : undefined}
      />
    );
  }, [actionRow, cancelReservationById]);

  // ── Rendering ───────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item, section }: SectionListRenderItemInfo<CalendarRow, AgendaSection>) =>
      section.kind === "past"
        ? <CalendarPastRow row={item} timeLabel={pastLabel(item)} onOpen={onOpenRow} onAgain={onAgainRow} />
        : <CalendarAgendaRow row={item} timeLabel={timeLabel(item)} onOpen={onOpenRow} onTicket={onTicketRow} onMore={onMoreRow} />,
    [pastLabel, timeLabel, onOpenRow, onAgainRow, onTicketRow, onMoreRow],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: SectionListData<CalendarRow, AgendaSection> }) =>
      section.kind === "past"
        ? <CalendarPastToggle count={section.total} expanded={showPast} onToggle={() => setShowPast((v) => !v)} />
        : (
          <Text
            style={[styles.sectionHeader, section.label === "today" && styles.sectionHeaderToday]}
            accessibilityRole="header"
          >
            {sectionLabel(section.label, section.dayKey)}
          </Text>
        ),
    [sectionLabel, showPast],
  );

  const onPickStripDay = useCallback(
    (dayKey: string) => setSelectedDayKey((current) => toggleSelectedDay(current, dayKey)),
    [],
  );
  const onPickMonthDay = useCallback((dayKey: string) => setMonthDayKey(dayKey), []);

  const showSkeleton = allRows.length === 0 &&
    (isLoading || businessOrdersQuery.isLoading || reservationsQuery.isLoading ||
      staysQuery.isLoading || goingRsvpsQuery.isLoading);

  const header = (
    <View style={styles.header}>
      <CalendarViewToggle view={view} onChange={setView} />
      {view === "list"
        ? <CalendarDayStrip days={strip} locale={locale} onPick={onPickStripDay} />
        : view === "week"
        ? (
          <CalendarWeekView
            days={week}
            locale={locale}
            timeLabel={timeLabel}
            onPrev={() => setWeekAnchor((d) => addDays(d, -7))}
            onNext={() => setWeekAnchor((d) => addDays(d, 7))}
            onOpenRow={onOpenRow}
          />
        )
        : (
          <CalendarMonthView
            cells={monthCells}
            year={month.year}
            monthIndex={month.monthIndex}
            weekStart={weekStart}
            locale={locale}
            onPrev={() => setMonth((m) => shiftMonth(m.year, m.monthIndex, -1))}
            onNext={() => setMonth((m) => shiftMonth(m.year, m.monthIndex, 1))}
            onPick={onPickMonthDay}
          />
        )}
      <CalendarTypeChips value={typeFilter} onChange={setTypeFilter} />
      {showSkeleton
        ? <CalendarAgendaSkeleton reduceMotion={reduceMotion} accessibilityLabel={t("activity:calendarTab.loadingCalendar")} />
        : view !== "week" && !hasUpcomingInView
        ? (
          <CalendarEmptyCard
            daySelected={view === "month" || selectedDayKey !== null}
            onPlanFromSaves={onPlanFromSaves}
          />
        )
        : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.container, { opacity: listOpacity }]}>
        <SectionList<CalendarRow, AgendaSection>
          sections={showSkeleton ? [] : sections}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          ListHeaderComponent={header}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={mainScrollContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#999"
            />
          }
        />
      </Animated.View>

      <CalendarPlanActionSheet
        visible={actionRow !== null}
        title={actionRow?.title ?? ""}
        actions={sheetActions}
        messageControl={sheetMessageControl}
        onClose={() => setActionRow(null)}
        onDismissed={() => {
          const next = afterActionSheetRef.current;
          afterActionSheetRef.current = null;
          next?.();
        }}
      />

      {/* Propose Date & Time Modal */}
      {entryToReschedule && (
        <ProposeDateTimeModal
          visible={showProposeDateTimeModal}
          onClose={() => {
            setShowProposeDateTimeModal(false);
            setEntryToReschedule(null);
            setIsScheduling(false);
          }}
          card={entryToCard(entryToReschedule)}
          isCurated={Array.isArray(
            (entryToReschedule.experience as any)?.stops,
          ) &&
            (entryToReschedule.experience as any).stops.length > 0}
          currentScheduledDate={entryToReschedule.suggestedDates?.[0] ||
            (entryToReschedule.date && entryToReschedule.time
              ? `${entryToReschedule.date}T${entryToReschedule.time}`
              : null)}
          onProposeDateTime={handleProposeDateTime}
          isScheduling={isScheduling}
        />
      )}

      {/* Expanded Card Modal - Global instance */}
      {modalTarget && (
        <ExpandedCardModal
          visible={isExpandedModalVisible}
          // ORCH-0828: discriminated-union target.
          target={modalTarget}
          reservationPass={reservationPassForModal}
          onClose={handleCloseExpandedModal}
          onSave={handleSaveFromModal}
          onPurchase={handlePurchaseFromModal}
          onShare={handleShareFromModal}
          shareProducerSurface="calendar_expanded"
          userPreferences={userPreferences}
          // #1669: the Calendar mount dropped this, so a Metric user got miles
          // and °F here and km and °C on the deck for the same place.
          accountPreferences={accountPreferences}
          isSaved={true}
          currentMode={calendarEntries.find((e) =>
              modalTarget.kind === "nightOut" && e.id === modalTarget.data.id
            )
              ?.source === "solo"
            ? "solo"
            : "collaboration"}
          canAccessCurated={canAccess("curated_cards")}
          onPaywallRequired={() => {
            handleCloseExpandedModal();
            setShowLockedPaywall(true);
          }}
        />
      )}

      <CustomPaywallScreen
        isVisible={showLockedPaywall}
        onClose={() => setShowLockedPaywall(false)}
        userId={user?.id ?? ""}
        feature="curated_cards"
      />
      <Modal
        visible={attentionRefundId !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setAttentionRefundId(null)}
      >
        <Pressable
          style={styles.attentionBackdrop}
          onPress={() => setAttentionRefundId(null)}
        >
          <Pressable style={styles.attentionPanel} onPress={() => undefined}>
            <SourceRefundAttentionSheet
              submitting={attentionSubmitting}
              loadingBanks={attentionBanksLoading}
              banks={attentionBanks}
              error={attentionError}
              deliveryParked={attentionDeliveryParked}
              onRetryBanks={() => void loadAttentionBanks()}
              onSubmit={(details) => {
                if (!attentionRefundId) return;
                setAttentionSubmitting(true);
                setAttentionError(null);
                void supabase.functions.invoke("source-refund-attention", {
                  body: {
                    mode: "submit_paystack_details",
                    refundId: attentionRefundId,
                    currency: "NGN",
                    ...details,
                  },
                }).then(({ error }) => {
                  if (error) {
                    setAttentionError(
                      "We couldn't submit those details. Check them and try again.",
                    );
                    return;
                  }
                  setAttentionRefundId(null);
                  if (user?.id) {
                    void queryClient.invalidateQueries({
                      queryKey: myReservationsKeys.byUser(user.id),
                    });
                  }
                }).finally(() => setAttentionSubmitting(false));
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: L.grid.sidePadding,
    paddingTop: 12,
  },
  header: {
    gap: 14,
  },
  sectionHeader: {
    marginTop: 14,
    marginBottom: 8,
    color: L.textSecondary,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  sectionHeaderToday: {
    color: L.accent,
  },
  attentionBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  attentionPanel: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: "#ffffff",
  },
});

export default CalendarTab;
