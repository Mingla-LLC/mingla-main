import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  Linking,
  FlatList,
  ActivityIndicator,
  ScrollView,
  Alert,
  TextInput,
  Animated,
  RefreshControl,
  Platform,
} from "react-native";
import * as WebBrowser from 'expo-web-browser';
import { getReadableCategoryName } from "../../utils/categoryUtils";

const ANIMATION_DURATION = 250;
import { Icon } from "../ui/Icon";
import { CardFilterBar, WhenFilter } from './CardFilterBar';
import { ImageWithFallback } from "../figma/ImageWithFallback";
import ProposeDateTimeModal from "./ProposeDateTimeModal";
import ExpandedCardModal from "../ExpandedCardModal";
import { mixpanelService } from "../../services/mixpanelService";
import { logAppsFlyerEvent } from "../../services/appsFlyerService";
import { recordCardExpand } from "../../services/cardEngagementService";
import { ExpandedCardData } from "../../types/expandedCardTypes";
import { useAppStore } from "../../store/appStore";
import { useQueryClient } from "@tanstack/react-query";
import { toastManager } from "../ui/Toast";
import { HapticFeedback } from "../../utils/hapticFeedback";
import { formatCurrency } from "../utils/formatters";
import { useFeatureGate } from "../../hooks/useFeatureGate";
import { CustomPaywallScreen } from "../CustomPaywallScreen";
import { useKeyboard } from "../../hooks/useKeyboard";
import { useTranslation } from 'react-i18next';
// ORCH-1019 F-1: curated reschedule validation routes through the canonical
// shared validator (extractWeekdayText + isPlaceOpenAt), same as SavedTab.
import { checkAllCuratedStopsOpen } from "../../utils/curatedStopsAvailability";
import { getUserLocale } from "../../utils/localeUtils";
// ORCH-0829-A: business-event ticket purchases live in `orders`+`tickets`
// tables. Surface them inside Calendar so the user sees a unified
// timeline. The legacy prop flow (calendarEntries from AppStateManager
// via LikesPage) is untouched to minimize blast radius. New invariant:
// I-PROPOSED-CONSUMER-CALENDAR-UNIONS-ORDERS.
//
// ORCH-0842 [Fold Tickets into Active + render real ticket PDF in
// bottom sheet with venue/QR/Save]: the standalone "Tickets" block above
// the Active accordion is REMOVED. Business orders are sort-merged into
// the Active and Archive accordions using a discriminated-union row type
// (kind: "calendar" | "ticket") rendered locally. Filter parity per SPEC
// §3.6.1: tickets always pass category + tier; search matches
// eventTitle + brandName; `when` applies via masterDateUtc with null-date
// tickets visible only under "all". Past-date paid tickets drop into
// Archive (mirror of saved-card archive behavior).
import {
  useBusinessEventOrders,
  useOrdersRealtimeSubscription,
  useTicketsRealtimeSubscription, // ORCH-0854
} from "../../hooks/useCalendarEntries";
import BusinessEventCalendarRow from "./BusinessEventCalendarRow";
import type { BusinessEventCalendarRow as BusinessEventRow } from "../../services/calendarService";

// ORCH-0842: discriminated-union row for unified Active/Archive rendering.
type UnifiedRow =
  | { kind: "calendar"; key: string; sortAt: number; entry: CalendarEntry }
  | { kind: "ticket"; key: string; sortAt: number; row: BusinessEventRow };

interface CalendarEntry {
  id: string;
  title: string;
  category: string;
  categoryIcon: any;
  image: string;
  images: string[];
  rating: number;
  reviewCount: number;
  date: string;
  time: string;
  source: "solo" | "collaboration";
  sourceDetails: string;
  priceRange: string;
  description: string;
  fullDescription: string;
  address: string;
  highlights: string[];
  socialStats: {
    views: number;
    likes: number;
    saves: number;
  };
  status: "confirmed" | "pending" | "completed";
  experience?: any;
  suggestedDates?: string[];
  sessionType?: string;
  sessionName?: string;
  purchaseOption?: any;
  isPurchased?: boolean;
  dateTimePreferences?: any;
  phoneNumber?: string;
  website?: string;
  duration_minutes?: number;
  scheduled_at?: string;
  device_calendar_event_id?: string | null;
}

/**
 * ORCH-0850 [End-not-start parity systemic]: derive the effective end-time of
 * a calendar entry for past/future bucket decisions. Returns null if no start
 * time is parseable.
 *
 * Semantics: an entry is "past" if its effective end is before now, i.e.:
 *   effectiveEnd = scheduled_at + duration_minutes  (fallback 120 min)
 *
 * MUST NOT be used for displaying times to the user — display strings still
 * come from entry.suggestedDates[0] / entry.date+entry.time unchanged. The
 * 120-minute default mirrors existing prior art at CalendarTab.tsx:391,
 * CalendarTab.tsx:414, ActionButtons.tsx:580, SavedTab.tsx:1422 (device-
 * calendar event creation), so the bucket cutoff stays consistent with the
 * duration the user already saw at schedule time.
 *
 * Preserves invariant I-PROPOSED-CONSUMER-CALENDAR-USES-END-NOT-START.
 */
export const DEFAULT_CALENDAR_DURATION_MIN = 120;

// Minimal shape needed for past/upcoming bucket decision. Subset of
// CalendarEntry; exported so the regression test can construct fixtures
// without depending on the full CalendarEntry interface.
export interface CalendarEntryForBucketing {
  scheduled_at?: string;
  suggestedDates?: string[];
  duration_minutes?: number;
}

export function computeEntryEffectiveEnd(
  entry: CalendarEntryForBucketing,
): Date | null {
  const startIso =
    entry.scheduled_at ?? entry.suggestedDates?.[0] ?? null;
  if (startIso === null) return null;
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return null;
  const durationMin =
    typeof entry.duration_minutes === "number" && entry.duration_minutes > 0
      ? entry.duration_minutes
      : DEFAULT_CALENDAR_DURATION_MIN;
  return new Date(startMs + durationMin * 60_000);
}

interface CalendarTabProps {
  calendarEntries: CalendarEntry[];
  isLoading?: boolean;
  onRemoveFromCalendar: (entry: CalendarEntry) => void;
  onShareCard: (card: any) => void;
  onAddToCalendar: (entry: CalendarEntry) => void;
  onShowQRCode: (entryId: string) => void;
  userPreferences?: any;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
}

const CalendarTab = ({
  calendarEntries,
  isLoading = false,
  onRemoveFromCalendar,
  onShareCard,
  onAddToCalendar,
  onShowQRCode,
  userPreferences,
  accountPreferences,
}: CalendarTabProps) => {
  const { t } = useTranslation(['activity', 'common']);
  const { canAccess } = useFeatureGate();
  const { keyboardHeight } = useKeyboard({ disableLayoutAnimation: true });
  const [showLockedPaywall, setShowLockedPaywall] = useState(false);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState<{
    [cardId: string]: number;
  }>({});
  const [removingEntryId, setRemovingEntryId] = useState<string | null>(null);
  const [expandedAccordionItems, setExpandedAccordionItems] = useState<
    string[]
  >(["tickets", "active"]); // Start with Tickets + Active expanded
  const [showProposeDateTimeModal, setShowProposeDateTimeModal] =
    useState(false);
  const [entryToReschedule, setEntryToReschedule] =
    useState<CalendarEntry | null>(null);
  const [isExpandedModalVisible, setIsExpandedModalVisible] = useState(false);
  const [selectedCardForExpansion, setSelectedCardForExpansion] =
    useState<ExpandedCardData | null>(null);
  const [isScheduling, setIsScheduling] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWhen, setSelectedWhen] = useState<WhenFilter>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { user } = useAppStore();
  const queryClient = useQueryClient();

  // ORCH-0829-A: business-event tickets parallel hook. Legacy
  // calendarEntries prop continues to flow from AppStateManager via
  // LikesPage; this hook adds the new source without touching that
  // path. Invalidated by `ExpandedBusinessEventSheet.handleBuy` on
  // success via `["businessEventOrders", user.id]`.
  const businessOrdersQuery = useBusinessEventOrders(user?.id);
  const businessOrders = businessOrdersQuery.data ?? [];

  // ORCH-0851 H-1: realtime subscription invalidates
  // `["businessEventOrders", user.id]` within ~1s of an INSERT/UPDATE/DELETE
  // on `orders` matching `buyer_user_id=eq.<userId>`. Fallbacks
  // (refetchOnWindowFocus + the 3-attempt invalidate loop in
  // ExpandedBusinessEventSheet) remain intact.
  useOrdersRealtimeSubscription(user?.id);
  // ORCH-0854 H-1: realtime subscription on `tickets` table — flips ticket
  // badge `valid → used` within ~1s of the door scanner's commit. RLS gates
  // delivery to tickets the buyer owns. Companion publication-add migration:
  // `supabase/migrations/20260606000200_orch_0854_tickets_realtime_publication.sql`.
  useTicketsRealtimeSubscription(user?.id);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ["calendarEntries", user?.id] });
    setIsRefreshing(false);
  }, [queryClient, user?.id]);

  // Animation refs
  const searchBarOpacity = useRef(new Animated.Value(0)).current;
  const searchBarSlide = useRef(new Animated.Value(-30)).current;
  const cardAnimations = useRef<{ [key: string]: { opacity: Animated.Value; slide: Animated.Value } }>({});

  // Initialize animation for each card
  const getCardAnimation = (entryId: string) => {
    if (!cardAnimations.current[entryId]) {
      cardAnimations.current[entryId] = {
        opacity: new Animated.Value(0),
        slide: new Animated.Value(30),
      };
    }
    return cardAnimations.current[entryId];
  };

  // Run search bar entrance animation on mount
  useEffect(() => {
    Animated.parallel([
      Animated.timing(searchBarOpacity, {
        toValue: 1,
        duration: ANIMATION_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(searchBarSlide, {
        toValue: 0,
        duration: ANIMATION_DURATION,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Filter entries into Active and Archive based on EFFECTIVE END time.
  // ORCH-0850: an entry is "past" only after its scheduled_at + duration has
  // elapsed. Previously this used scheduledDate < now, which flipped events
  // to Archive the moment they STARTED — e.g. a 3am-to-9pm event hit Archive
  // at 3:01am while still 18 hours from ending. See I-PROPOSED-CONSUMER-
  // CALENDAR-USES-END-NOT-START.
  const { activeEntries, archiveEntries } = useMemo(() => {
    const now = Date.now();
    const active: CalendarEntry[] = [];
    const archive: CalendarEntry[] = [];

    calendarEntries.forEach((entry) => {
      const effectiveEnd = computeEntryEffectiveEnd(entry);
      if (effectiveEnd !== null && effectiveEnd.getTime() < now) {
        archive.push(entry);
      } else {
        // Future, in-progress, or no parseable date — stays Active.
        active.push(entry);
      }
    });

    return { activeEntries: active, archiveEntries: archive };
  }, [calendarEntries]);

  // Apply search and filter controls
  const { filteredActiveEntries, filteredArchiveEntries } = useMemo(() => {
    const normalize = (value: string | undefined | null) =>
      (value || "").toLowerCase();

    const matchesSearch = (entry: CalendarEntry) => {
      if (!searchQuery.trim()) return true;
      const q = normalize(searchQuery);
      const title = normalize(entry.experience?.title || entry.title);
      const category = normalize(
        entry.experience?.category || entry.category || ""
      );
      const sessionName = normalize(entry.sessionName || "");
      return (
        title.includes(q) ||
        category.includes(q) ||
        sessionName.includes(q)
      );
    };

    const getScheduledDate = (entry: CalendarEntry): Date | null => {
      const iso = entry.suggestedDates?.[0];
      if (iso) return new Date(iso);
      if (entry.date && entry.time) {
        return new Date(`${entry.date}T${entry.time}`);
      }
      return null;
    };

    const matchesWhen = (entry: CalendarEntry) => {
      if (selectedWhen === "all") return true;
      const scheduled = getScheduledDate(entry);
      if (!scheduled) return false;
      const now = new Date();

      const isSameDay =
        scheduled.getFullYear() === now.getFullYear() &&
        scheduled.getMonth() === now.getMonth() &&
        scheduled.getDate() === now.getDate();

      if (selectedWhen === "today") return isSameDay;

      if (selectedWhen === "this_week") {
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 7);
        return scheduled >= startOfWeek && scheduled < endOfWeek;
      }

      if (selectedWhen === "this_month") {
        return (
          scheduled.getFullYear() === now.getFullYear() &&
          scheduled.getMonth() === now.getMonth()
        );
      }

      if (selectedWhen === "upcoming") {
        return scheduled >= now;
      }

      return true;
    };

    const matchesCategory = (entry: CalendarEntry) => {
      if (selectedCategory === 'all') return true;
      const slug = entry.experience?.category || entry.category || '';
      return slug === selectedCategory;
    };

    const matchesTier = (entry: CalendarEntry) => {
      if (selectedTier === 'all') return true;
      const tier = entry.experience?.priceTier || '';
      return tier === selectedTier;
    };

    const applyAllFilters = (entry: CalendarEntry) =>
      matchesSearch(entry) &&
      matchesWhen(entry) &&
      matchesCategory(entry) &&
      matchesTier(entry);

    return {
      filteredActiveEntries: activeEntries.filter(applyAllFilters),
      filteredArchiveEntries: archiveEntries.filter(applyAllFilters),
    };
  }, [
    activeEntries,
    archiveEntries,
    searchQuery,
    selectedWhen,
    selectedCategory,
    selectedTier,
  ]);

  // ORCH-0853: partition business orders into active vs archive using
  // EFFECTIVE END time (event_dates.end_at when present; start_at fallback
  // when null — defensive). Mirrors the scheduled-card effectiveEnd logic
  // at the useMemo above. Pre-fix this used start-only `masterDateUtc < now`
  // and archived in-progress events the moment they STARTED — e.g. The
  // Reckoning (10pm-to-3am) flipped to Archive at 10:01pm while still 5
  // hours from ending. See I-CALENDAR-BUSINESS-TICKET-END-NOT-START.
  // Sibling fix to ORCH-0850; this is the fifth surface that the systemic
  // sweep's `scheduled_at` grep scope did not catch. Pending-payment orders
  // always stay Active.
  const { activeBusinessOrders, archiveBusinessOrders } = useMemo(() => {
    const now = Date.now();
    const active: BusinessEventRow[] = [];
    const archive: BusinessEventRow[] = [];
    for (const order of businessOrders) {
      if (order.paymentStatus === "pending") {
        active.push(order);
        continue;
      }
      const endTs = order.masterDateEndUtc
        ? Date.parse(order.masterDateEndUtc)
        : Number.NaN;
      const startTs = order.masterDateUtc
        ? Date.parse(order.masterDateUtc)
        : Number.NaN;
      const effectiveEndTs = Number.isFinite(endTs)
        ? endTs
        : Number.isFinite(startTs)
          ? startTs
          : Number.NaN;
      if (Number.isFinite(effectiveEndTs) && effectiveEndTs < now) {
        archive.push(order);
      } else {
        active.push(order);
      }
    }
    return { activeBusinessOrders: active, archiveBusinessOrders: archive };
  }, [businessOrders]);

  // ORCH-0842: filter parity rules per SPEC §3.6.1.
  // - search: match eventTitle OR brandName (case-insensitive)
  // - when: apply to masterDateUtc; null-date tickets show only under "all"
  // - category + tier: tickets always pass (Mingla taxonomy doesn't apply)
  const filterBusinessOrders = useCallback(
    (orders: BusinessEventRow[]): BusinessEventRow[] => {
      const normalize = (value: string | undefined | null) =>
        (value || "").toLowerCase();
      const q = normalize(searchQuery).trim();

      return orders.filter((order) => {
        if (q) {
          const title = normalize(order.eventTitle);
          const brand = normalize(order.brandName);
          if (!title.includes(q) && !brand.includes(q)) return false;
        }
        if (selectedWhen !== "all") {
          if (!order.masterDateUtc) return false;
          const scheduled = new Date(order.masterDateUtc);
          const now = new Date();
          const isSameDay =
            scheduled.getFullYear() === now.getFullYear() &&
            scheduled.getMonth() === now.getMonth() &&
            scheduled.getDate() === now.getDate();
          if (selectedWhen === "today" && !isSameDay) return false;
          if (selectedWhen === "this_week") {
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - now.getDay());
            startOfWeek.setHours(0, 0, 0, 0);
            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 7);
            if (scheduled < startOfWeek || scheduled >= endOfWeek) {
              return false;
            }
          }
          if (
            selectedWhen === "this_month" &&
            (scheduled.getFullYear() !== now.getFullYear() ||
              scheduled.getMonth() !== now.getMonth())
          ) {
            return false;
          }
          if (selectedWhen === "upcoming" && scheduled < now) return false;
        }
        // category + tier: always pass for tickets per filter parity table.
        return true;
      });
    },
    [searchQuery, selectedWhen],
  );

  const filteredActiveBusinessOrders = useMemo(
    () => filterBusinessOrders(activeBusinessOrders),
    [activeBusinessOrders, filterBusinessOrders],
  );
  const filteredArchiveBusinessOrders = useMemo(
    () => filterBusinessOrders(archiveBusinessOrders),
    [archiveBusinessOrders, filterBusinessOrders],
  );

  // ORCH-0842: unified rows = calendar entries + ticket orders, sorted
  // ascending by date (soonest first; null-date entries go to the bottom).
  const unifiedActiveRows = useMemo<UnifiedRow[]>(() => {
    const rows: UnifiedRow[] = [];
    for (const entry of filteredActiveEntries) {
      const iso = entry.suggestedDates?.[0];
      const dateStr = iso ?? (entry.date && entry.time
        ? `${entry.date}T${entry.time}`
        : null);
      const ts = dateStr ? Date.parse(dateStr) : Number.NaN;
      rows.push({
        kind: "calendar",
        key: `calendar:${entry.id}`,
        sortAt: Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY,
        entry,
      });
    }
    for (const order of filteredActiveBusinessOrders) {
      const ts = order.masterDateUtc
        ? Date.parse(order.masterDateUtc)
        : Number.NaN;
      rows.push({
        kind: "ticket",
        key: `ticket:${order.orderId}`,
        sortAt: Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY,
        row: order,
      });
    }
    rows.sort((a, b) => a.sortAt - b.sortAt);
    return rows;
  }, [filteredActiveEntries, filteredActiveBusinessOrders]);

  const unifiedArchiveRows = useMemo<UnifiedRow[]>(() => {
    const rows: UnifiedRow[] = [];
    for (const entry of filteredArchiveEntries) {
      const iso = entry.suggestedDates?.[0];
      const dateStr = iso ?? (entry.date && entry.time
        ? `${entry.date}T${entry.time}`
        : null);
      const ts = dateStr ? Date.parse(dateStr) : Number.NaN;
      rows.push({
        kind: "calendar",
        key: `calendar:${entry.id}`,
        sortAt: Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY,
        entry,
      });
    }
    for (const order of filteredArchiveBusinessOrders) {
      const ts = order.masterDateUtc
        ? Date.parse(order.masterDateUtc)
        : Number.NaN;
      rows.push({
        kind: "ticket",
        key: `ticket:${order.orderId}`,
        sortAt: Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY,
        row: order,
      });
    }
    // Archive: most recently past first.
    rows.sort((a, b) => b.sortAt - a.sortAt);
    return rows;
  }, [filteredArchiveEntries, filteredArchiveBusinessOrders]);

  // ORCH-0842: animate the UNIFIED active row list — calendar entries
  // AND ticket orders participate in the same staggered entrance using
  // their stable discriminated-union keys.
  useEffect(() => {
    unifiedActiveRows.forEach((row, index) => {
      const animation = getCardAnimation(row.key);
      animation.opacity.setValue(0);
      animation.slide.setValue(30);

      setTimeout(() => {
        Animated.parallel([
          Animated.timing(animation.opacity, {
            toValue: 1,
            duration: ANIMATION_DURATION,
            useNativeDriver: true,
          }),
          Animated.timing(animation.slide, {
            toValue: 0,
            duration: ANIMATION_DURATION,
            useNativeDriver: true,
          }),
        ]).start();
      }, index * 60);
    });
  }, [unifiedActiveRows.length, expandedAccordionItems]);

  useEffect(() => {
    if (expandedAccordionItems.includes("archive")) {
      unifiedArchiveRows.forEach((row, index) => {
        const animation = getCardAnimation(row.key);
        animation.opacity.setValue(0);
        animation.slide.setValue(30);

        setTimeout(() => {
          Animated.parallel([
            Animated.timing(animation.opacity, {
              toValue: 1,
              duration: ANIMATION_DURATION,
              useNativeDriver: true,
            }),
            Animated.timing(animation.slide, {
              toValue: 0,
              duration: ANIMATION_DURATION,
              useNativeDriver: true,
            }),
          ]).start();
        }, index * 60);
      });
    }
  }, [unifiedArchiveRows.length, expandedAccordionItems]);

  const handleReschedule = (entry: CalendarEntry) => {
    setEntryToReschedule(entry);
    setShowProposeDateTimeModal(true);
  };

  const handleProposeDateTime = async (
    date: Date,
    dateOption: "now" | "today" | "weekend" | "custom"
  ) => {
    if (!entryToReschedule || !user?.id) {
      Alert.alert(t('activity:calendarTab.rescheduleErrorTitle'), t('activity:calendarTab.rescheduleError'));
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
          .join('\n');
        setShowProposeDateTimeModal(false);
        Alert.alert(
          'Not Safe to Schedule',
          `Mingla could not confirm every stop is open at the time you selected:\n\n${unavailableList}\n\nPlease choose a different time when all stops are confirmed open.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Choose New Time', onPress: () => setShowProposeDateTimeModal(true) },
          ],
        );
        return;
      }
    }

    setIsScheduling(true);
    try {
      const { CalendarService } = await import("../../services/calendarService");
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
          const endDate = new Date(date.getTime() + (entryToReschedule.duration_minutes || 120) * 60_000);
          await DeviceCalendarService.updateEventOnDeviceCalendar(
            entryToReschedule.device_calendar_event_id,
            { startDate: date, endDate }
          );
        } else {
          // Fallback: delete-then-recreate (for entries without stored ID)
          const oldDate = entryToReschedule.scheduled_at
            ? new Date(entryToReschedule.scheduled_at)
            : entryToReschedule.suggestedDates?.[0]
            ? new Date(entryToReschedule.suggestedDates[0])
            : null;

          if (oldDate && cardData.title) {
            await DeviceCalendarService.removeEventByTitleAndDate(cardData.title, oldDate);
            // Curated cards use "Mingla Plan: StopA → StopB" title format
            if (cardData.stops?.length > 0) {
              const stopNames = cardData.stops.map((s: any) => s.placeName || s.title).join(' → ');
              await DeviceCalendarService.removeEventByTitleAndDate(`Mingla Plan: ${stopNames}`, oldDate);
            }
          }

          // ORCH-1019 F-4: curated reschedule must rebuild with the multi-stop
          // builder so every stop's "Stop N / Address: …" line survives
          // (createEventFromCard emits only the first stop's address). Mirrors
          // the initial-schedule branch at SavedTab.tsx:1415-1420. Only this
          // no-stored-ID recreate fallback is touched — the stored-ID patch
          // branch above preserves notes and is NOT modified.
          const isCuratedEntry = Array.isArray(cardData.stops) && cardData.stops.length > 0;
          const deviceEvent = isCuratedEntry
            ? DeviceCalendarService.createEventFromCuratedCard(
                cardData,
                date,
                cardData.estimatedDurationMinutes || entryToReschedule.duration_minutes || 120,
              )
            : DeviceCalendarService.createEventFromCard(
                cardData, date, entryToReschedule.duration_minutes || 120
              );
          const newEventId = await DeviceCalendarService.addEventToDeviceCalendar(deviceEvent);

          // Store the new event ID for future reschedule
          if (newEventId && entryToReschedule.id) {
            CalendarService.updateEntry(entryToReschedule.id, user!.id, {
              device_calendar_event_id: newEventId,
            }).catch((err) => console.warn('Failed to store device calendar event ID:', err));
          }
        }
      } catch (deviceCalendarError) {
        console.warn("Failed to update device calendar:", deviceCalendarError);
        Alert.alert(t('activity:calendarTab.noteTitle'), t('activity:calendarTab.noteCalendarNotUpdated'));
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
      logAppsFlyerEvent('experience_rescheduled', {
        af_content_type: entryToReschedule.category,
        new_date: scheduledDateISO,
        date_option: dateOption,
      });

      // 5. Show success message
      toastManager.success(
        t('activity:calendarTab.rescheduledSuccess', { title: entryToReschedule.title || "Experience" }),
        3000
      );

      // 6. Close modal and reset state
      setShowProposeDateTimeModal(false);
      setEntryToReschedule(null);
    } catch (error: any) {
      console.error("Error rescheduling calendar entry:", error);
      Alert.alert(
        t('activity:calendarTab.rescheduleFailed'),
        error.message ||
          t('activity:calendarTab.rescheduleFailedMsg')
      );
      setShowProposeDateTimeModal(false);
      setEntryToReschedule(null);
    } finally {
      setIsScheduling(false);
    }
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
    },
    listContent: {
      gap: 16,
      paddingTop: 16,
      paddingBottom: 100, // Increased padding to ensure last card is fully visible
      paddingHorizontal: 16,
    },
    calendarCard: {
      backgroundColor: "rgba(255, 255, 255, 0.06)",
      borderRadius: 16,
      borderWidth: 1,
      borderColor: "#f0f0f0",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 16,
      elevation: 1,
      overflow: "hidden",
    },
    lockedCardOverflow: {
      overflow: 'hidden',
    },
    lockedCalendarBody: {
      backgroundColor: '#1C1C1E',
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      gap: 12,
    },
    lockedCalendarInfo: {
      flex: 1,
    },
    lockedCalendarTitle: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '600',
    },
    lockedCalendarSubtext: {
      color: '#9CA3AF',
      fontSize: 12,
      marginTop: 2,
    },
    lockedCalendarUpgrade: {
      backgroundColor: '#f97316',
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 8,
    },
    lockedCalendarUpgradeText: {
      color: '#fff',
      fontSize: 13,
      fontWeight: '600',
    },
    cardContent: {
      padding: 16,
    },
    cardHeader: {
      flexDirection: "row",
      gap: 12,
    },
    cardImage: {
      width: 64,
      height: 64,
      borderRadius: 12,
      overflow: "hidden",
    },
    cardInfo: {
      flex: 1,
      minWidth: 0,
    },
    cardTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: "#FFFFFF",
      marginBottom: 4,
    },
    cardSubtitle: {
      fontSize: 14,
      color: "rgba(255, 255, 255, 0.72)",
      marginBottom: 8,
    },
    eventDetailsContainer: {
      gap: 8,
      marginBottom: 8,
    },
    eventDetailRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    eventDetailText: {
      fontSize: 14,
      color: "#FFFFFF",
    },
    // ORCH-1019 F-5: curated per-stop address rail (DESIGN doc §3 tokens).
    curatedStopRail: {
      gap: 12,
    },
    curatedStopRow: {
      flexDirection: "row",
      gap: 8,
      alignItems: "flex-start",
    },
    curatedStopBadgeCol: {
      width: 20,
      alignItems: "center",
    },
    curatedStopBadge: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: "#eb7825",
      alignItems: "center",
      justifyContent: "center",
    },
    curatedStopBadgeText: {
      color: "#FFFFFF",
      fontSize: 12,
      fontWeight: "700",
    },
    curatedStopConnector: {
      width: 1.5,
      flex: 1,
      backgroundColor: "rgba(235,120,37,0.32)",
      marginTop: 2,
    },
    curatedStopTextCol: {
      flex: 1,
      minWidth: 0,
    },
    curatedStopMeta: {
      // container line; child <Text> carry their own roles
    },
    curatedStopLabel: {
      color: "#eb7825",
      fontSize: 11,
      fontWeight: "600",
      letterSpacing: 0.5,
    },
    curatedStopMiddot: {
      color: "rgba(255,255,255,0.4)",
      fontSize: 13,
    },
    curatedStopName: {
      color: "#FFFFFF",
      fontSize: 13,
      fontWeight: "600",
    },
    curatedStopAddress: {
      color: "rgba(255,255,255,0.72)",
      fontSize: 13,
      fontWeight: "400",
      marginTop: 2,
    },
    curatedStopAddressTBD: {
      color: "rgba(255,255,255,0.55)",
      fontSize: 13,
      fontStyle: "italic",
      marginTop: 2,
    },
    statusIndicators: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 8,
    },
    sessionBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 12,
    },
    soloBadge: {
      backgroundColor: "#dbeafe",
    },
    collaborationBadge: {
      backgroundColor: "#f3e8ff",
    },
    soloText: {
      color: "#1e40af",
    },
    collaborationText: {
      color: "#7c3aed",
    },
    sourceText: {
      fontSize: 12,
      fontWeight: "500",
    },
    statusText: {
      fontSize: 12,
      fontWeight: "500",
    },
    statusBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 12,
      flexShrink: 0,
    },
    confirmedBadge: {
      backgroundColor: "#dcfce7",
    },
    completedBadge: {
      backgroundColor: "#dbeafe",
    },
    pendingBadge: {
      backgroundColor: "#fef3c7",
    },
    confirmedText: {
      color: "#166534",
    },
    completedText: {
      color: "#1e40af",
    },
    pendingText: {
      color: "#92400e",
    },
    purchaseDetails: {
      paddingHorizontal: 16,
    },
    purchaseCard: {
      padding: 12,
      backgroundColor: "#ecfdf5",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "#a7f3d0",
      marginBottom: 16,
    },
    purchaseHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 8,
    },
    purchaseIcon: {
      width: 16,
      height: 16,
      color: "#059669",
    },
    purchaseTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: "#065f46",
    },
    purchaseDetailsList: {
      gap: 4,
    },
    purchaseDetailRow: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    purchaseLabel: {
      fontSize: 12,
      color: "#047857",
    },
    purchaseValue: {
      fontSize: 12,
      fontWeight: "500",
      color: "#047857",
    },
    purchaseFeatures: {
      marginTop: 8,
    },
    purchaseFeaturesTitle: {
      fontSize: 12,
      color: "#047857",
      marginBottom: 4,
    },
    purchaseFeaturesList: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 4,
    },
    purchaseFeature: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      backgroundColor: "#a7f3d0",
      borderRadius: 12,
    },
    purchaseFeatureText: {
      fontSize: 12,
      color: "#047857",
    },
    actionsContainer: {
      paddingBottom: 16,
      marginTop: 16,
      paddingHorizontal: 8,
    },
    actionsRow: {
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
    },
    proposeDateButton: {
      flex: 1,
      backgroundColor: "#eb7825",
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 24,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    proposeDateButtonText: {
      color: "white",
      fontSize: 16,
      fontWeight: "600",
    },
    shareButton: {
      width: 44,
      height: 44,
      borderRadius: 10,
      backgroundColor: "rgba(255, 255, 255, 0.06)",
      borderWidth: 1,
      borderColor: "rgba(255, 255, 255, 0.12)",
      alignItems: "center",
      justifyContent: "center",
    },
    deleteButton: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: "rgba(255, 255, 255, 0.06)",
      borderWidth: 0.5,
      borderColor: "#ef4444", // Red border
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryButton: {
      flex: 1,
      backgroundColor: "rgba(255, 255, 255, 0.06)",
      borderWidth: 1,
      borderColor: "#eb7825",
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      alignItems: "center",
    },
    secondaryButtonText: {
      color: "#eb7825",
      fontSize: 16,
      fontWeight: "500",
    },
    tertiaryButton: {
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: "rgba(255, 255, 255, 0.12)",
      borderRadius: 12,
    },
    tertiaryButtonIcon: {
      width: 20,
      height: 20,
      color: "rgba(255, 255, 255, 0.72)",
    },
    purchasedButton: {
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: "#a7f3d0",
      backgroundColor: "#ecfdf5",
      borderRadius: 12,
    },
    purchasedButtonIcon: {
      width: 20,
      height: 20,
      color: "#059669",
    },
    qrButton: {
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: "#93c5fd",
      backgroundColor: "#dbeafe",
      borderRadius: 12,
    },
    qrButtonIcon: {
      width: 20,
      height: 20,
      color: "#2563eb",
    },
    expandedContent: {
      borderTopWidth: 1,
      borderTopColor: "#f3f4f6",
      backgroundColor: "rgba(255, 255, 255, 0.04)",
    },
    imageGallery: {
      position: "relative",
    },
    galleryImage: {
      aspectRatio: 16 / 9,
      overflow: "hidden",
    },
    imageNavigation: {
      position: "absolute",
      top: "50%",
      transform: [{ translateY: -16 }],
      width: 32,
      height: 32,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    leftNav: {
      left: 8,
    },
    rightNav: {
      right: 8,
    },
    navIcon: {
      width: 16,
      height: 16,
      color: "white",
    },
    imageIndicators: {
      position: "absolute",
      bottom: 8,
      left: "50%",
      transform: [{ translateX: -50 }],
      flexDirection: "row",
      gap: 4,
    },
    indicator: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    activeIndicator: {
      backgroundColor: "rgba(255, 255, 255, 0.06)",
    },
    inactiveIndicator: {
      backgroundColor: "rgba(255, 255, 255, 0.5)",
    },
    detailsSection: {
      padding: 16,
      gap: 16,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "500",
      color: "#FFFFFF",
      marginBottom: 8,
    },
    sectionText: {
      fontSize: 14,
      color: "rgba(255, 255, 255, 0.72)",
      lineHeight: 20,
    },
    highlightsContainer: {
      gap: 8,
    },
    highlightsList: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    highlightTag: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: "#fef3e2",
      borderRadius: 8,
    },
    highlightText: {
      fontSize: 12,
      color: "#ea580c",
    },
    scheduleDetails: {
      gap: 8,
    },
    scheduleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    scheduleIcon: {
      width: 16,
      height: 16,
      color: "#eb7825",
    },
    scheduleText: {
      fontSize: 14,
      color: "rgba(255, 255, 255, 0.72)",
    },
    preferencesContainer: {
      gap: 8,
    },
    preferencesTitle: {
      fontSize: 16,
      fontWeight: "500",
      color: "#FFFFFF",
      marginBottom: 8,
    },
    preferencesList: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    preferenceTag: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: "#dbeafe",
      borderRadius: 8,
    },
    preferenceText: {
      fontSize: 12,
      color: "#1e40af",
    },
    contactContainer: {
      gap: 8,
    },
    contactTitle: {
      fontSize: 16,
      fontWeight: "500",
      color: "#FFFFFF",
      marginBottom: 8,
    },
    contactRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    contactIcon: {
      width: 16,
      height: 16,
      color: "#eb7825",
    },
    contactText: {
      fontSize: 14,
      color: "rgba(255, 255, 255, 0.72)",
    },
    contactLink: {
      fontSize: 14,
      color: "#eb7825",
      textDecorationLine: "underline",
    },
    emptyState: {
      flexDirection: "row",
      alignItems: "center",
      marginHorizontal: 16,
      marginVertical: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      backgroundColor: "rgba(235, 120, 37, 0.08)",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "#f5e6d3",
      // META-ORCH-1002 Sub-B (C3, dark-canvas): clip the translucent orange fill +
      // bright border to the radius (kills the corner ring). Glass fill preserved.
      overflow: "hidden",
    },
    emptyStateIconCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: "#fef3e2",
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    emptyStateTextContainer: {
      flex: 1,
    },
    emptyStateTitle: {
      fontSize: 15,
      fontWeight: "600",
      color: "#FFFFFF",
      marginBottom: 2,
    },
    emptyStateSubtitle: {
      fontSize: 13,
      color: "rgba(255, 255, 255, 0.55)",
      lineHeight: 18,
    },
    mainScrollView: {
      flex: 1,
    },
    mainScrollContent: {
      paddingBottom: 100,
    },
    accordionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: "rgba(255, 255, 255, 0.06)",
      borderWidth: 1,
      borderColor: "#f0f0f0",
      borderRadius: 12,
      marginHorizontal: 16,
      marginBottom: 8,
      // META-ORCH-1002 Sub-B (C4, dark-canvas): clip the translucent glass fill +
      // bright border to the radius (kills the corner ring) and zero the Android
      // elevation so no hard shadow rectangle draws under the rounded header. iOS
      // shadow + glass fill preserved.
      overflow: "hidden",
      elevation: Platform.select({ ios: 1, android: 0, default: 1 }),
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 16,
    },
    accordionTitleContainer: {
      flexDirection: "row",
      alignItems: "center",
    },
    accordionTitle: {
      fontSize: 16,
      fontWeight: "500",
      color: "#FFFFFF",
    },
    accordionCount: {
      fontSize: 14,
      color: "rgba(255, 255, 255, 0.72)",
      marginLeft: 8,
    },
    accordionContentContainer: {
      backgroundColor: "transparent",
    },
    cardWrapper: {
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    rescheduleButton: {
      flex: 1,
      backgroundColor: "#eb7825",
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      marginTop: 12,
    },
    rescheduleButtonText: {
      color: "white",
      fontSize: 16,
      fontWeight: "600",
    },
    loadingContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingVertical: 48,
      gap: 12,
    },
    loadingText: {
      fontSize: 14,
      color: "rgba(255, 255, 255, 0.72)",
      marginTop: 8,
    },
  });

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

  const nextImage = (cardId: string, totalImages: number) => {
    setCurrentImageIndex((prev) => ({
      ...prev,
      [cardId]: ((prev[cardId] || 0) + 1) % totalImages,
    }));
  };

  const prevImage = (cardId: string, totalImages: number) => {
    setCurrentImageIndex((prev) => ({
      ...prev,
      [cardId]: ((prev[cardId] || 0) - 1 + totalImages) % totalImages,
    }));
  };

  const handleOpenMaps = (address: string) => {
    const query = encodeURIComponent(address);
    const url = `https://maps.google.com/maps?q=${query}`;
    Linking.openURL(url);
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
    HapticFeedback.buttonPress();
    // Transform CalendarEntry to ExpandedCardData format
    const experience = entry.experience || entry;
    const ExperienceIcon = getIconComponent(
      experience.categoryIcon || entry.categoryIcon
    );

    // Detect curated multi-stop card
    const cardData = experience || {};
    const isCurated = Array.isArray(cardData.stops) && cardData.stops.length > 0;

    const expandedCardData: ExpandedCardData = {
      id: entry.id,
      placeId: experience.placeId || (entry as any).placeId || entry.id,
      title: experience.title || entry.title,
      category: experience.category || entry.category || "Experience",
      categoryIcon: ExperienceIcon,
      description: experience.description || entry.description || "",
      fullDescription:
        experience.fullDescription ||
        experience.description ||
        entry.fullDescription ||
        entry.description ||
        "",
      image: experience.image || entry.image || "",
      images: experience.images?.length ? experience.images
        : entry.images?.length ? entry.images
        : [experience.image || entry.image].filter(Boolean),
      rating: experience.rating || entry.rating || 4.5,
      reviewCount: experience.reviewCount || entry.reviewCount || 0,
      // [ORCH-0649 — INVARIANT I-NO-FABRICATED-DISPLAY-N/A] no "N/A" fabrication.
      priceRange: experience.priceRange || entry.priceRange || undefined,
      distance: (experience as any).distance || "",
      travelTime: experience.travelTime || undefined,
      address: experience.address || entry.address || "",
      openingHours: (experience as any).openingHours,
      phone: experience.phoneNumber || entry.phoneNumber,
      website: experience.website || entry.website,
      highlights: experience.highlights || entry.highlights || [],
      tags: (experience as any).tags || [],
      matchScore: experience.matchScore || (entry as any).matchScore || 0,
      matchFactors: (experience as any).matchFactors || {
        location: 0,
        budget: 0,
        category: 0,
        time: 0,
        popularity: 0,
      },
      socialStats: experience.socialStats ||
        entry.socialStats || {
          views: 0,
          likes: 0,
          saves: 0,
          shares: 0,
        },
      priceTier: ((experience as any).priceTier || (entry as any).priceTier) as ExpandedCardData['priceTier'],
      location:
        (experience as any).location ||
        ((experience as any).lat && (experience as any).lng
          ? { lat: (experience as any).lat, lng: (experience as any).lng }
          : undefined),
      selectedDateTime: entry.suggestedDates?.[0]
        ? new Date(entry.suggestedDates[0])
        : entry.date && entry.time
        ? new Date(`${entry.date}T${entry.time}`)
        : new Date(),
      strollData: (experience as any).strollData,
      picnicData: (experience as any).picnicData,
      // Curated fields — pass through if present
      ...(isCurated && {
        cardType: 'curated' as const,
        stops: cardData.stops,
        tagline: cardData.tagline,
        pairingKey: cardData.pairingKey,
        totalPriceMin: cardData.totalPriceMin,
        totalPriceMax: cardData.totalPriceMax,
        estimatedDurationMinutes: cardData.estimatedDurationMinutes,
        experienceType: cardData.experienceType,
        shoppingList: cardData.shoppingList,
      }),
    };

    setSelectedCardForExpansion(expandedCardData);
    setIsExpandedModalVisible(true);

    // ORCH-0408 Phase 4: Record expand — counter + user interaction log (fire-and-forget)
    recordCardExpand((entry as any).card_id || entry.id, {
      category: experience.category || (entry as any).category,
      priceTier: (experience as any).priceTier || null,
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
    setSelectedCardForExpansion(null);
  };

  const handleSaveFromModal = async (card: ExpandedCardData) => {
    // Card is already saved (it's in calendar), so this might be a no-op
    // or could trigger a re-save/update
    handleCloseExpandedModal();
  };

  const handlePurchaseFromModal = (
    card: ExpandedCardData,
    bookingOption: any
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
    onShareCard(card);
  };

  const renderCalendarEntry = ({ item: entry }: { item: CalendarEntry }) => {
    // Format date and time for display
    const scheduledDate = entry.suggestedDates?.[0]
      ? new Date(entry.suggestedDates[0])
      : null;

    const formattedDate = scheduledDate
      ? scheduledDate.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
      : "TBD";

    const formattedTime = scheduledDate
      ? scheduledDate.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      : "";

    // Get subtitle/organizer - could be from entry or experience
    const subtitle =
      (entry as any).organizer ||
      (entry.experience as any)?.organizer ||
      getReadableCategoryName(entry.experience?.category || entry.category || "") ||
      "Experience";

    // Curated cards are viewable by all tiers — no locked state needed

    return (
      <View style={styles.calendarCard}>
        <TouchableOpacity
          onPress={() => handleCardExpand(entry)}
          activeOpacity={0.7}
          style={styles.cardContent}
        >
          <View style={styles.cardHeader}>
            <TouchableOpacity
              onPress={() => handleCardExpand(entry)}
              activeOpacity={0.8}
              style={styles.cardImage}
            >
              <ImageWithFallback
                source={{ uri: entry.experience?.image || entry.image }}
                alt={entry.experience?.title || entry.title}
                style={{ width: "100%", height: "100%" }}
              />
            </TouchableOpacity>

            <View style={styles.cardInfo}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <View style={{ flex: 1 }}>
                  <TouchableOpacity
                    onPress={() => handleCardExpand(entry)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.cardTitle}>
                      {entry.experience?.title || entry.title}
                    </Text>
                    {/* Subtitle instead of category */}
                    <Text style={styles.cardSubtitle}>{subtitle}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Event Details: Date, Time, Location with orange icons */}
              <View style={styles.eventDetailsContainer}>
                <View style={styles.eventDetailRow}>
                  <Icon name="calendar" size={16} color="#eb7825" />
                  <Text style={styles.eventDetailText}>{formattedDate}</Text>
                </View>
                {formattedTime ? (
                  <View style={styles.eventDetailRow}>
                    <Icon name="time" size={16} color="#eb7825" />
                    <Text style={styles.eventDetailText}>{formattedTime}</Text>
                  </View>
                ) : null}
                {(() => {
                  // ORCH-1019 F-5: curated multi-stop entries surface EVERY
                  // stop's address inline (numbered rail), so the user can
                  // execute the plan without opening a second screen or
                  // expanding each stop. Non-curated entries keep the existing
                  // single location row unchanged (no regression). Built to
                  // DESIGN_ORCH-1019_F5_CALENDAR_STOP_ADDRESSES.md.
                  const railStops = (entry.experience as any)?.stops as any[] | undefined;
                  const isCuratedRail = Array.isArray(railStops) && railStops.length > 0;
                  if (!isCuratedRail) {
                    return (
                      <View style={styles.eventDetailRow}>
                        <Icon name="location" size={16} color="#eb7825" />
                        <Text style={styles.eventDetailText}>
                          {entry.experience?.address ||
                            entry.address ||
                            t('activity:calendarTab.locationTBD')}
                        </Text>
                      </View>
                    );
                  }
                  return (
                    <View style={styles.curatedStopRail}>
                      {railStops.map((stop, idx) => {
                        const stopNum =
                          typeof stop?.stopNumber === 'number' && stop.stopNumber >= 1
                            ? stop.stopNumber
                            : idx + 1;
                        const label = typeof stop?.stopLabel === 'string' ? stop.stopLabel : '';
                        const placeName =
                          (typeof stop?.placeName === 'string' && stop.placeName) ||
                          (typeof stop?.title === 'string' && stop.title) ||
                          '';
                        const addr =
                          typeof stop?.address === 'string' ? stop.address.trim() : '';
                        const hasAddr = addr.length > 0;
                        return (
                          <View
                            key={`stop-${stopNum}-${idx}`}
                            style={styles.curatedStopRow}
                            accessibilityRole="text"
                            accessibilityLabel={`Stop ${stopNum}${label ? `, ${label}` : ''}${placeName ? `, ${placeName}` : ''}, ${hasAddr ? addr : t('activity:calendarTab.locationTBD')}`}
                          >
                            <View style={styles.curatedStopBadgeCol}>
                              <View style={styles.curatedStopBadge}>
                                <Text style={styles.curatedStopBadgeText}>{stopNum}</Text>
                              </View>
                              {idx < railStops.length - 1 ? (
                                <View
                                  style={styles.curatedStopConnector}
                                  importantForAccessibility="no"
                                  accessibilityElementsHidden
                                />
                              ) : null}
                            </View>
                            <View style={styles.curatedStopTextCol}>
                              <Text style={styles.curatedStopMeta} numberOfLines={1}>
                                {label ? (
                                  <Text style={styles.curatedStopLabel}>
                                    {label.toUpperCase()}
                                  </Text>
                                ) : null}
                                {label && placeName ? (
                                  <Text style={styles.curatedStopMiddot}> · </Text>
                                ) : null}
                                <Text style={styles.curatedStopName}>{placeName}</Text>
                              </Text>
                              {hasAddr ? (
                                <Text
                                  style={styles.curatedStopAddress}
                                  numberOfLines={2}
                                  ellipsizeMode="tail"
                                >
                                  {addr}
                                </Text>
                              ) : (
                                <Text style={styles.curatedStopAddressTBD} numberOfLines={1}>
                                  {t('activity:calendarTab.locationTBD')}
                                </Text>
                              )}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  );
                })()}
              </View>

              {/* ORCH-0908: Source Badge — uses collaborationBadge styles for collab entries
                  (previously hardcoded soloBadge regardless of source, leaving the
                  collaborationBadge + collaborationText styles at lines 819-826 as dead code). */}
              <View style={styles.statusIndicators}>
                <View
                  style={[
                    styles.sessionBadge,
                    entry.source === "solo" ? styles.soloBadge : styles.collaborationBadge,
                  ]}
                >
                  <Icon
                    name={entry.source === "solo" ? "eye" : "people"}
                    size={12}
                    color={entry.source === "solo" ? "#1e40af" : "#7c3aed"}
                  />
                  <Text
                    style={[
                      styles.sourceText,
                      entry.source === "solo" ? styles.soloText : styles.collaborationText,
                    ]}
                  >
                    {entry.source === "solo"
                      ? t('activity:calendarTab.soloDiscovery')
                      : `${entry.sessionName}`}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </TouchableOpacity>

        {/* Purchase Details Section */}
        {entry.purchaseOption && (
          <View style={styles.purchaseDetails}>
            <View style={styles.purchaseCard}>
              <View style={styles.purchaseHeader}>
                <Icon name="bag" size={16} color="#059669" />
                <Text style={styles.purchaseTitle}>{t('activity:calendarTab.purchaseDetails')}</Text>
              </View>
              <View style={styles.purchaseDetailsList}>
                <View style={styles.purchaseDetailRow}>
                  <Text style={styles.purchaseLabel}>Option:</Text>
                  <Text style={styles.purchaseValue}>
                    {entry.purchaseOption.title}
                  </Text>
                </View>
                <View style={styles.purchaseDetailRow}>
                  <Text style={styles.purchaseLabel}>Price:</Text>
                  <Text style={styles.purchaseValue}>
                    {formatCurrency(
                      entry.purchaseOption.price,
                      entry.purchaseOption.currency ||
                        accountPreferences?.currency ||
                        "USD"
                    )}
                  </Text>
                </View>
                {entry.purchaseOption.duration && (
                  <View style={styles.purchaseDetailRow}>
                    <Text style={styles.purchaseLabel}>Duration:</Text>
                    <Text style={styles.purchaseValue}>
                      {entry.purchaseOption.duration}
                    </Text>
                  </View>
                )}
                {entry.purchaseOption.includes &&
                  entry.purchaseOption.includes.length > 0 && (
                    <View style={styles.purchaseFeatures}>
                      <Text style={styles.purchaseFeaturesTitle}>
                        Includes:
                      </Text>
                      <View style={styles.purchaseFeaturesList}>
                        {entry.purchaseOption.includes
                          .slice(0, 3)
                          .map((item: string, index: number) => (
                            <View key={index} style={styles.purchaseFeature}>
                              <Text style={styles.purchaseFeatureText}>
                                {item}
                              </Text>
                            </View>
                          ))}
                        {entry.purchaseOption.includes.length > 3 && (
                          <View style={styles.purchaseFeature}>
                            <Text style={styles.purchaseFeatureText}>
                              +{entry.purchaseOption.includes.length - 3} more
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  )}
              </View>
            </View>
          </View>
        )}

        {/* Calendar Actions */}
        <View style={styles.actionsContainer}>
          <View style={styles.actionsRow}>
            {/* Propose Date Button - Large orange button */}
            <TouchableOpacity
              onPress={(e) => {
                HapticFeedback.buttonPress();
                e.stopPropagation(); // Prevent card expansion
                setEntryToReschedule(entry);
                setShowProposeDateTimeModal(true);
              }}
              style={styles.proposeDateButton}
            >
              <Icon name="calendar" size={18} color="white" />
              <Text style={styles.proposeDateButtonText}>{t('activity:calendarTab.reschedule')}</Text>
            </TouchableOpacity>

            {/* Share Button - Small circular */}
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation(); // Prevent card expansion
                onShareCard(entry.experience || entry);
              }}
              style={styles.shareButton}
            >
              <Icon name="share-social-outline" size={18} color="#374151" />
            </TouchableOpacity>

            {/* Delete Button - Small circular */}
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation(); // Prevent card expansion
                handleRemoveFromCalendar(entry);
              }}
              style={styles.deleteButton}
              disabled={removingEntryId === entry.id}
            >
              {removingEntryId === entry.id ? (
                <ActivityIndicator size="small" color="#ef4444" />
              ) : (
                <Icon name="trash-outline" size={18} color="#ef4444" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Expanded Calendar Details */}
        {expandedCard === entry.id && (
          <View style={styles.expandedContent}>
            {/* Image Gallery */}
            {entry.experience?.images && entry.experience.images.length > 0 && (
              <View style={styles.imageGallery}>
                <View style={styles.galleryImage}>
                  <ImageWithFallback
                    source={{
                      uri: entry.experience.images[
                        currentImageIndex[entry.id] || 0
                      ],
                    }}
                    alt={entry.experience.title}
                    style={{ width: "100%", height: "100%" }}
                  />

                  {entry.experience.images.length > 1 && (
                    <>
                      <TouchableOpacity
                        onPress={() =>
                          prevImage(entry.id, entry.experience.images.length)
                        }
                        style={[styles.imageNavigation, styles.leftNav]}
                      >
                        <Icon name="chevron-back" size={16} color="white" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() =>
                          nextImage(entry.id, entry.experience.images.length)
                        }
                        style={[styles.imageNavigation, styles.rightNav]}
                      >
                        <Icon
                          name="chevron-forward"
                          size={16}
                          color="white"
                        />
                      </TouchableOpacity>

                      {/* Image indicators */}
                      <View style={styles.imageIndicators}>
                        {entry.experience.images.map(
                          (_: any, index: number) => (
                            <View
                              key={index}
                              style={[
                                styles.indicator,
                                index === (currentImageIndex[entry.id] || 0)
                                  ? styles.activeIndicator
                                  : styles.inactiveIndicator,
                              ]}
                            />
                          )
                        )}
                      </View>
                    </>
                  )}
                </View>
              </View>
            )}

            {/* Details */}
            <View style={styles.detailsSection}>
              <View>
                <Text style={styles.sectionTitle}>About this experience</Text>
                <Text style={styles.sectionText}>
                  {entry.experience?.fullDescription ||
                    entry.experience?.description ||
                    "Join us for this amazing experience! Perfect for creating memorable moments."}
                </Text>
              </View>

              {entry.experience?.highlights &&
                entry.experience.highlights.length > 0 && (
                  <View style={styles.highlightsContainer}>
                    <Text style={styles.sectionTitle}>Highlights</Text>
                    <View style={styles.highlightsList}>
                      {entry.experience.highlights.map(
                        (highlight: string, index: number) => (
                          <View key={index} style={styles.highlightTag}>
                            <Text style={styles.highlightText}>
                              {highlight}
                            </Text>
                          </View>
                        )
                      )}
                    </View>
                  </View>
                )}

              {/* Date & Time Details */}
              <View style={styles.scheduleDetails}>
                <Text style={styles.sectionTitle}>Schedule Details</Text>
                <View style={styles.scheduleRow}>
                  <Icon name="calendar" size={16} color="#eb7825" />
                  <Text style={styles.scheduleText}>
                    {entry.suggestedDates?.[0]
                      ? new Date(entry.suggestedDates[0]).toLocaleDateString(
                          "en-US",
                          {
                            weekday: "long",
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          }
                        )
                      : "Date to be determined"}
                  </Text>
                </View>
                <View style={styles.scheduleRow}>
                  <Icon name="time" size={16} color="#eb7825" />
                  <Text style={styles.scheduleText}>
                    {entry.suggestedDates?.[0]
                      ? new Date(entry.suggestedDates[0]).toLocaleTimeString(
                          "en-US",
                          {
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                          }
                        )
                      : "Time to be determined"}
                  </Text>
                </View>
                <View style={styles.scheduleRow}>
                  <Icon name="location" size={16} color="#eb7825" />
                  <Text style={styles.scheduleText}>
                    {entry.experience?.address ||
                      "Location details will be provided"}
                  </Text>
                </View>
              </View>

              {/* Date/Time Preferences Applied */}
              {entry.dateTimePreferences && (
                <View style={styles.preferencesContainer}>
                  <Text style={styles.preferencesTitle}>
                    Your Preferences Applied
                  </Text>
                  <View style={styles.preferencesList}>
                    <View style={styles.preferenceTag}>
                      <Text style={styles.preferenceText}>
                        {entry.dateTimePreferences.timeOfDay}
                      </Text>
                    </View>
                    <View style={styles.preferenceTag}>
                      <Text style={styles.preferenceText}>
                        {entry.dateTimePreferences.dayOfWeek}
                      </Text>
                    </View>
                    <View style={styles.preferenceTag}>
                      <Text style={styles.preferenceText}>
                        {entry.dateTimePreferences.planningTimeframe}
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Contact Information */}
              {(entry.experience?.phoneNumber || entry.experience?.website) && (
                <View style={styles.contactContainer}>
                  <Text style={styles.contactTitle}>Contact Information</Text>
                  {entry.experience.phoneNumber && (
                    <View style={styles.contactRow}>
                      <Text>📞</Text>
                      <Text style={styles.contactText}>
                        {entry.experience.phoneNumber}
                      </Text>
                    </View>
                  )}
                  {entry.experience.website && (
                    <View style={styles.contactRow}>
                      <Icon name="link" size={16} color="#eb7825" />
                      <Text style={styles.contactLink}>Visit Website</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
        )}
      </View>
    );
  };

  const renderEmptyComponent = (section: "active" | "archive" = "active") => {
    const isActive = section === "active";
    return (
      <View style={styles.emptyState}>
        <View style={styles.emptyStateIconCircle}>
          <Icon
            name={isActive ? "calendar-outline" : "archive-outline"}
            size={22}
            color="#eb7825"
          />
        </View>
        <View style={styles.emptyStateTextContainer}>
          <Text style={styles.emptyStateTitle}>
            {isActive ? t('activity:calendarTab.emptyActiveTitle') : t('activity:calendarTab.emptyArchiveTitle')}
          </Text>
          <Text style={styles.emptyStateSubtitle}>
            {isActive
              ? t('activity:calendarTab.emptyActiveSubtitle')
              : t('activity:calendarTab.emptyArchiveSubtitle')}
          </Text>
        </View>
      </View>
    );
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
      travelTime: entry.experience?.travelTime,
      description: entry.experience?.description || entry.description,
      fullDescription:
        entry.experience?.fullDescription || entry.fullDescription,
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

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#eb7825" />
        <Text style={styles.loadingText}>{t('activity:calendarTab.loadingCalendar')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.mainScrollView}
        contentContainerStyle={styles.mainScrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#999" />}
      >
        {/* Search & Filters */}
        <Animated.View
          style={{
            opacity: searchBarOpacity,
            transform: [{ translateY: searchBarSlide }],
          }}
        >
          <CardFilterBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            selectedWhen={selectedWhen}
            onWhenChange={setSelectedWhen}
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
            selectedTier={selectedTier}
            onTierChange={setSelectedTier}
          />
        </Animated.View>

        {/* ORCH-0842: standalone "Tickets" block removed. Business orders
            now sort-merge into the Active + Archive accordions below. */}

        {/* Active Section — unified calendar entries + business-event tickets */}
        <TouchableOpacity
          style={styles.accordionHeader}
          onPress={() =>
            setExpandedAccordionItems((prev) =>
              prev.includes("active")
                ? prev.filter((i) => i !== "active")
                : [...prev, "active"]
            )
          }
          activeOpacity={0.7}
        >
          <View style={styles.accordionTitleContainer}>
            <Text style={styles.accordionTitle}>{t('activity:calendarTab.active')}</Text>
            <Text style={styles.accordionCount}>
              ({unifiedActiveRows.length})
            </Text>
          </View>
          <Icon
            name={
              expandedAccordionItems.includes("active")
                ? "chevron-down"
                : "chevron-forward"
            }
            size={20}
            color="#9ca3af"
          />
        </TouchableOpacity>

        {expandedAccordionItems.includes("active") && (
          <View style={styles.accordionContentContainer}>
            {unifiedActiveRows.length === 0
              ? renderEmptyComponent("active")
              : unifiedActiveRows.map((row) => {
                  const animation = getCardAnimation(row.key);
                  if (row.kind === "calendar") {
                    return (
                      <Animated.View
                        key={row.key}
                        style={[
                          styles.cardWrapper,
                          {
                            opacity: animation.opacity,
                            transform: [{ translateY: animation.slide }],
                          },
                        ]}
                      >
                        {renderCalendarEntry({ item: row.entry })}
                      </Animated.View>
                    );
                  }
                  return (
                    <BusinessEventCalendarRow
                      key={row.key}
                      entry={row.row}
                      animation={animation}
                    />
                  );
                })}
          </View>
        )}

        {/* Archive Section */}
        <TouchableOpacity
          style={styles.accordionHeader}
          onPress={() =>
            setExpandedAccordionItems((prev) =>
              prev.includes("archive")
                ? prev.filter((i) => i !== "archive")
                : [...prev, "archive"]
            )
          }
          activeOpacity={0.7}
        >
          <View style={styles.accordionTitleContainer}>
            <Text style={styles.accordionTitle}>{t('activity:calendarTab.archives')}</Text>
            <Text style={styles.accordionCount}>
              ({unifiedArchiveRows.length})
            </Text>
          </View>
          <Icon
            name={
              expandedAccordionItems.includes("archive")
                ? "chevron-down"
                : "chevron-forward"
            }
            size={20}
            color="#9ca3af"
          />
        </TouchableOpacity>

        {expandedAccordionItems.includes("archive") && (
          <View style={styles.accordionContentContainer}>
            {unifiedArchiveRows.length === 0
              ? renderEmptyComponent("archive")
              : unifiedArchiveRows.map((row) => {
                  const animation = getCardAnimation(row.key);
                  if (row.kind === "calendar") {
                    return (
                      <Animated.View
                        key={row.key}
                        style={[
                          styles.cardWrapper,
                          {
                            opacity: animation.opacity,
                            transform: [{ translateY: animation.slide }],
                          },
                        ]}
                      >
                        {renderCalendarEntry({ item: row.entry })}
                      </Animated.View>
                    );
                  }
                  return (
                    <BusinessEventCalendarRow
                      key={row.key}
                      entry={row.row}
                      animation={animation}
                    />
                  );
                })}
          </View>
        )}
        {keyboardHeight > 0 && <View style={{ height: keyboardHeight }} />}
      </ScrollView>

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
          isCurated={
            Array.isArray((entryToReschedule.experience as any)?.stops) &&
            (entryToReschedule.experience as any).stops.length > 0
          }
          currentScheduledDate={
            entryToReschedule.suggestedDates?.[0] ||
            (entryToReschedule.date && entryToReschedule.time
              ? `${entryToReschedule.date}T${entryToReschedule.time}`
              : null)
          }
          onProposeDateTime={handleProposeDateTime}
          isScheduling={isScheduling}
        />
      )}

      {/* Expanded Card Modal - Global instance */}
      {selectedCardForExpansion && (
        <ExpandedCardModal
          visible={isExpandedModalVisible}
          // ORCH-0828: discriminated-union target.
          target={{ kind: "nightOut", data: selectedCardForExpansion }}
          onClose={handleCloseExpandedModal}
          onSave={handleSaveFromModal}
          onPurchase={handlePurchaseFromModal}
          onShare={handleShareFromModal}
          userPreferences={userPreferences}
          isSaved={true}
          currentMode={
            calendarEntries.find((e) => e.id === selectedCardForExpansion.id)
              ?.source === "solo"
              ? "solo"
              : "collaboration"
          }
          canAccessCurated={canAccess('curated_cards')}
          onPaywallRequired={() => {
            handleCloseExpandedModal();
            setShowLockedPaywall(true);
          }}
        />
      )}

      <CustomPaywallScreen
        isVisible={showLockedPaywall}
        onClose={() => setShowLockedPaywall(false)}
        userId={user?.id ?? ''}
        feature="curated_cards"
      />
    </View>
  );
};

export default CalendarTab;
