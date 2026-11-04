import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  type ListRenderItemInfo,
  Alert,
  Animated,
  RefreshControl,
  useWindowDimensions,
} from "react-native";

const ANIMATION_DURATION = 250;

/**
 * Issue #1636 — how much of the Likes list is allowed to be mounted at once.
 *
 * Issue #4265: the list is now a two-column grid, so each FlatList "row" is two
 * ~330pt cards and 2-3 rows fill an SM-A725F screen. Rendering 8 items (4 rows)
 * up front fills the viewport with headroom; a window of 5 viewports keeps the
 * mounted set (and its image fan-out) a small constant (was: all N, 201
 * requests / 37 MB at the production ceiling).
 */
const ISSUE_1636_INITIAL_RENDER_COUNT = 8;
const ISSUE_1636_WINDOW_SIZE = 5;
import { Icon } from "../ui/Icon";
import ExpandedCardModal from "../ExpandedCardModal";
import { openExpandedCardContentShare } from "../../services/contentShareController";
import { ExpandedCardData } from "../../types/expandedCardTypes";
// #1669 [expanded-card-one-producer]: Likes routes through the ONE canonical
// producer instead of its own two hand-written literals.
import { savedCardToExpandedCardData } from "../utils/savedCardToExpandedCardData";
import { isBrandExperiencePayload } from "../../utils/isBrandExperiencePayload";
import { experienceRecToBusinessEventCard } from "../../utils/experienceRecToBusinessEventCard";
import type { ExpansionTarget } from "../../types/expansion";
import { mixpanelService } from "../../services/mixpanelService";
import { logAppsFlyerEvent } from "../../services/appsFlyerService";
import { recordCardExpand } from "../../services/cardEngagementService";
import { useSavedCards } from "@/src/hooks/useSavedCards";
import { useAppStore } from "../../store/appStore";
import { useQueryClient } from "@tanstack/react-query";
import { savedCardKeys } from "../../hooks/queryKeys";
import { CalendarService } from "../../services/calendarService";
import { savedCardsService } from "../../services/savedCardsService";
import { toastManager } from "../ui/Toast";
import { getUserLocale } from "../../utils/localeUtils";
import { DeviceCalendarService } from "@/src/services/deviceCalendarService";
import ProposeDateTimeModal from "./ProposeDateTimeModal"; // dark bottom sheet
import { HapticFeedback } from "../../utils/hapticFeedback";
import type { CuratedStop } from "../../types/curatedExperience";
import { extractWeekdayText } from "../../utils/openingHoursUtils";
import { checkAllCuratedStopsOpen, type CuratedStopsAvailabilityResult } from "../../utils/curatedStopsAvailability";
import {
  buildSingleCardNotSafeMessage,
  checkSingleCardSchedulingAvailability,
} from "../../utils/singleCardAvailability";
import { CardFilterBar, WhenFilter } from './CardFilterBar';
import {
  ENTRANCE_START_SCALE,
  getEntranceStaggerDelayMs,
} from "./savedTabEntrance";
import { useFeatureGate } from "../../hooks/useFeatureGate";
import { CustomPaywallScreen } from "../CustomPaywallScreen";
import type { GatedFeature } from "../../hooks/useFeatureGate";
import { useKeyboard } from "../../hooks/useKeyboard";
import { useTranslation } from 'react-i18next';
import {
  type CanonicalDiscoveryPrice,
} from "../../utils/priceTiers";
import { glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from "../../constants/designSystem";
import { useA11yPreferences } from "../../hooks/useA11yPreferences";
import { SavedGridCard } from "./SavedGridCard";
import SavedScheduleSheet from "./SavedScheduleSheet";
import SavedCardActionMenu from "./SavedCardActionMenu";
import SavedGridSkeleton from "./SavedGridSkeleton";
import {
  SAVED_GRID_COLUMNS,
  SAVED_UNDO_WINDOW_MS,
  computeQuickSlots,
  createPendingRemovalController,
  isSavedCardTicketed,
  isSavedEventEnded,
  resolveSavedPrimaryAction,
  type QuickSlotResult,
  type SavedPrimaryAction,
} from "./savedGridModel";

const EMPTY_QUICK_SLOTS: QuickSlotResult = { slots: [], source: "hours" };

/** A curated multi-stop AI plan (brand-authored events also carry stops). */
function isCuratedPlan(card: SavedCard): boolean {
  return (
    Array.isArray((card as any).stops) &&
    (card as any).stops.length > 0 &&
    !isBrandExperiencePayload(card)
  );
}

/** "Sat 12 PM" / "Sat 7:30 PM" for the booked chip on the photo. */
function formatScheduledChip(date: Date, locale: string): string {
  const day = date.toLocaleDateString(locale, { weekday: "short" });
  const time = date.toLocaleTimeString(locale, {
    hour: "numeric",
    ...(date.getMinutes() !== 0 ? { minute: "2-digit" as const } : {}),
  });
  return `${day} ${time}`;
}

interface SavedCard extends Partial<CanonicalDiscoveryPrice> {
  id: string;
  title: string;
  category: string;
  categoryIcon: any;
  image: string;
  images: string[];
  rating: number;
  reviewCount: number;
  priceRange: string;
  priceTier?: string;
  travelTime: string;
  description: string;
  fullDescription: string;
  address: string;
  highlights: string[];
  matchScore: number;
  socialStats: {
    views: number;
    likes: number;
    saves: number;
  };
  dateAdded: string;
  source: "solo" | "collaboration";
  sessionName?: string;
  sessionId?: string; // Session ID where the card was saved
  purchaseOptions?: Array<{
    id: string;
    title: string;
    price: number;
    currency: string;
    description: string;
    features: string[];
    popular?: boolean;
  }>;

  openingHours?: Parameters<typeof extractWeekdayText>[0];
  utcOffsetMinutes?: number | null;
  utc_offset_minutes?: number | null;
  lat: number;
  lng: number;
}


// ---------------------------------------------------------------------------
// Issue #1636 — styles live at module scope (allocated once per process); the
// ONE prop-dependent style (mainScrollContent, the ORCH-1189 floating-nav
// clearance `bottomNavTotalHeight + 24`) stays in the component as
// `dynamicStyles`.
//
// Issue #4265 — the old list-row styles (`styles.experienceCard…`,
// `curatedSavedStyles`) went with SavedSimpleCardRow / SavedCuratedCardRow;
// the grid card owns its own styles in SavedGridCard.tsx.
// ---------------------------------------------------------------------------
const L = glass.likes;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: L.canvas,
  },
  list: {
    flex: 1,
  },
  headerWrap: {
    marginBottom: L.grid.topPadding,
  },
  // Issue #4265: one grid row = two cards, 16pt page edges, 12pt column gap,
  // 20pt between rows.
  gridRow: {
    columnGap: L.grid.columnGap,
    paddingHorizontal: L.grid.sidePadding,
    marginBottom: L.grid.rowGap,
  },
  statePanel: {
    paddingTop: 72,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 12,
  },
  stateIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ANDROID_GLASS_USES_OPAQUE_FALLBACK ? L.accentSoftOpaque : L.accentSoft,
  },
  stateTitle: {
    color: L.textPrimary,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
    textAlign: "center",
  },
  stateBody: {
    color: L.textBody,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  stateButton: {
    marginTop: 8,
    minHeight: 44,
    paddingHorizontal: 22,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: L.accent,
  },
  stateButtonText: {
    color: L.textPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
  stateButtonQuiet: {
    backgroundColor: ANDROID_GLASS_USES_OPAQUE_FALLBACK ? L.card.quietFillOpaque : L.card.quietFill,
    borderWidth: 1,
    borderColor: L.card.quietBorder,
  },
});


interface SavedTabProps {
  savedCards?: SavedCard[];
  calendarEntries?: any[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onScheduleFromSaved: (card: SavedCard) => void | Promise<void>;
  onPurchaseFromSaved: (card: SavedCard, purchaseOption: any) => void;
  onShareCard: (card: SavedCard) => void;
  userPreferences?: any;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
  scheduledCardIds?: string[];
  boardSavedCards?: SavedCard[]; // Optional: board-specific saved cards
  activeBoardSessionId?: string | null; // Session ID for invalidating board cards query
  /**
   * ORCH-1189: floating-nav clearance, threaded down from LikesPage
   * (`useAppLayout().bottomNavTotalHeight`). Applied as the INNER scroll content's
   * paddingBottom so the list clears the floating GlassBottomNav while the tab's
   * frame still paints full-bleed to the physical screen bottom (no black bar).
   */
  bottomNavTotalHeight?: number;
  /** Issue #4265: "Find something" (empty) and "Find similar" (ended) go to Explore. */
  onExplore?: () => void;
  /**
   * Issue #4265: the "N saved" count on the Likes title row. Reported net of
   * cards waiting out their Undo window; `null` while loading or errored.
   */
  onSavedCountChange?: (count: number | null) => void;
}

const SavedTab = ({
  savedCards: propSavedCards,
  calendarEntries = [],
  isLoading = false,
  isError = false,
  onRetry,
  onScheduleFromSaved,
  onPurchaseFromSaved,
  onShareCard,
  userPreferences,
  accountPreferences,
  scheduledCardIds = [],
  boardSavedCards,
  activeBoardSessionId,
  bottomNavTotalHeight = 0,
  onExplore,
  onSavedCountChange,
}: SavedTabProps) => {
  const { t } = useTranslation(['activity', 'common']);
  const { keyboardHeight } = useKeyboard({ disableLayoutAnimation: true });
  // savedCards and calendarEntries now come via props from the parent chain.
  // No more useAppState() call — eliminates duplicate auth/realtime/query instances.
  const effectiveIsLoading = isLoading;
  const savedCards = boardSavedCards ?? propSavedCards ?? [];

  // Feature gating for locked curated cards
  const { canAccess } = useFeatureGate();
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState<GatedFeature>('curated_cards');
  // nightOut for places/curated; businessEvent for brand experiences (#1672 Book path)
  const [modalTarget, setModalTarget] = useState<ExpansionTarget | null>(null);
  const [originalSavedCard, setOriginalSavedCard] = useState<SavedCard | null>(
    null
  );
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [schedulingCardId, setSchedulingCardId] = useState<string | null>(null);
  // Issue #4265: cards the heart has removed. They disappear at once; the
  // delete is committed when the Undo window closes (or the tab unmounts).
  const [hiddenCardIds, setHiddenCardIds] = useState<Set<string>>(
    () => new Set()
  );
  const [showScheduleSheet, setShowScheduleSheet] = useState(false);
  const [menuCard, setMenuCard] = useState<SavedCard | null>(null);
  const [showProposeDateTimeModal, setShowProposeDateTimeModal] =
    useState(false);
  const [cardToSchedule, setCardToSchedule] = useState<SavedCard | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWhen, setSelectedWhen] = useState<WhenFilter>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { user } = useAppStore();
  const queryClient = useQueryClient();
  const { reduceMotion } = useA11yPreferences();
  const { width: windowWidth } = useWindowDimensions();
  // Two columns inside 16pt page edges with a 12pt gap between them.
  const cardWidth = Math.floor(
    (windowWidth - L.grid.sidePadding * 2 - L.grid.columnGap) / SAVED_GRID_COLUMNS
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: savedCardKeys.list(user?.id ?? '') });
    setIsRefreshing(false);
  }, [queryClient, user?.id]);

  // Animation refs
  const searchBarOpacity = useRef(new Animated.Value(0)).current;
  const searchBarSlide = useRef(new Animated.Value(30)).current;
  const cardAnimations = useRef<{ [key: string]: { scale: Animated.Value } }>({});

  /**
   * Issue #1636: card ids that have already played their entrance for THIS
   * mount. A card animates in exactly once — which is what stops every search
   * keystroke from resetting the whole list to 0.8 and restarting the ramp.
   */
  const entranceAnimatedIdsRef = useRef<Set<string>>(new Set());

  // Initialize animation for each card
  const getCardAnimation = useCallback((cardId: string) => {
    if (!cardAnimations.current[cardId]) {
      cardAnimations.current[cardId] = {
        scale: new Animated.Value(ENTRANCE_START_SCALE),
      };
    }
    return cardAnimations.current[cardId];
  }, []);

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

  // Convert scheduledCardIds to Set for O(1) lookups
  const scheduledCardIdsSet = useMemo(
    () => new Set(scheduledCardIds || []),
    [scheduledCardIds]
  );

  // Get set of card IDs that are in calendar entries
  const calendarCardIdsSet = useMemo(() => {
    const ids = new Set<string>();
    calendarEntries?.forEach((entry: any) => {
      if (entry.id) ids.add(entry.id);
      if (entry.experience?.id) ids.add(entry.experience.id);
    });
    return ids;
  }, [calendarEntries]);

  // Apply search and filter controls
  const filteredCards = useMemo(() => {
    const normalize = (value: string | undefined | null) =>
      (value || "").toLowerCase();

    const matchesSearch = (card: SavedCard) => {
      if (!searchQuery.trim()) return true;
      const q = normalize(searchQuery);
      const title = normalize(card.title);
      const category = normalize(card.category || "");
      const sessionName = normalize(card.sessionName || "");
      return (
        title.includes(q) ||
        category.includes(q) ||
        sessionName.includes(q)
      );
    };

    const getDateAdded = (card: SavedCard): Date | null => {
      if (!card.dateAdded) return null;
      try {
        return new Date(card.dateAdded);
      } catch {
        return null;
      }
    };

    const matchesWhen = (card: SavedCard) => {
      if (selectedWhen === "all") return true;
      const dateAdded = getDateAdded(card);
      if (!dateAdded) return false;
      const now = new Date();

      const isSameDay =
        dateAdded.getFullYear() === now.getFullYear() &&
        dateAdded.getMonth() === now.getMonth() &&
        dateAdded.getDate() === now.getDate();

      if (selectedWhen === "today") return isSameDay;

      if (selectedWhen === "this_week") {
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 7);
        return dateAdded >= startOfWeek && dateAdded < endOfWeek;
      }

      if (selectedWhen === "this_month") {
        return (
          dateAdded.getFullYear() === now.getFullYear() &&
          dateAdded.getMonth() === now.getMonth()
        );
      }

      if (selectedWhen === "upcoming") {
        return dateAdded >= now;
      }

      return true;
    };

    const matchesCategory = (card: SavedCard) => {
      if (selectedCategory === 'all') return true;
      return card.category === selectedCategory;
    };

    const matchesTier = (card: SavedCard) => {
      if (selectedTier === 'all') return true;
      if ((card as any).cardType !== 'curated') return false;
      return (card as any).priceTier === selectedTier;
    };

    const applyAllFilters = (card: SavedCard) =>
      !hiddenCardIds.has(card.id) &&
      matchesSearch(card) &&
      matchesWhen(card) &&
      matchesCategory(card) &&
      matchesTier(card);

    return savedCards.filter(applyAllFilters);
  }, [
    savedCards,
    hiddenCardIds,
    searchQuery,
    selectedWhen,
    selectedCategory,
    selectedTier,
  ]);

  /**
   * Issue #1636 — bounded, once-per-card entrance.
   *
   * BEFORE: every card in the list was reset to 0.8 and given its own
   * `setTimeout(..., index * 60)`, so the last card of a 148-card set did not
   * begin its spring until 8.9 s after mount — and because the dependency was
   * `[filteredCards.length]`, every search keystroke that changed the match
   * count restarted the entire ramp from zero.
   *
   * AFTER: a card animates in exactly once per mount (tracked by id), and the
   * delay is clamped by `getEntranceStaggerDelayMs`, so the tail is 480 ms at
   * N = 10, N = 148 or N = 10 000. The delay is handed to `Animated.spring`
   * itself rather than to a `setTimeout`, so there are no pending timers to
   * leak or to cancel — a cancelled timer would have stranded its card at 0.8
   * forever.
   */
  useEffect(() => {
    let newCardIndex = 0;
    for (const card of filteredCards) {
      if (entranceAnimatedIdsRef.current.has(card.id)) continue;
      entranceAnimatedIdsRef.current.add(card.id);

      const animation = getCardAnimation(card.id);
      if (reduceMotion) {
        // Issue #4265: no entrance spring under reduce motion.
        animation.scale.setValue(1);
        continue;
      }
      animation.scale.setValue(ENTRANCE_START_SCALE);
      Animated.spring(animation.scale, {
        toValue: 1,
        friction: 6,
        tension: 100,
        delay: getEntranceStaggerDelayMs(newCardIndex),
        useNativeDriver: true,
      }).start();

      newCardIndex += 1;
    }
  }, [filteredCards, getCardAnimation, reduceMotion]);

  const getMatchScore = (card: SavedCard): number | null => {
    if (typeof card?.matchScore === "number") return card.matchScore;
    if (typeof (card as any)?.match_score === "number")
      return (card as any).match_score;
    if ((card as any)?.matchFactors?.overall)
      return (card as any).matchFactors.overall;
    if ((card as any)?.matchFactors?.total)
      return (card as any).matchFactors.total;
    return null;
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

  // Helper function to generate suggested dates
  const generateSuggestedDates = (dateTimePrefs: any) => {
    const suggestions = [];
    const today = new Date();

    for (let i = 0; i < 3; i++) {
      const futureDate = new Date(today);

      if (dateTimePrefs?.planningTimeframe === "This week") {
        futureDate.setDate(today.getDate() + (i + 1) * 2);
      } else if (dateTimePrefs?.planningTimeframe === "This month") {
        futureDate.setDate(today.getDate() + (i + 1) * 7);
      } else {
        futureDate.setDate(today.getDate() + (i + 1) * 14);
      }

      if (dateTimePrefs?.dayOfWeek === "Weekend") {
        const dayOfWeek = futureDate.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          futureDate.setDate(futureDate.getDate() + (6 - dayOfWeek));
        }
      }

      let hour = 14;
      if (dateTimePrefs?.timeOfDay === "Morning") hour = 10;
      else if (dateTimePrefs?.timeOfDay === "Evening") hour = 18;

      futureDate.setHours(hour, 0, 0, 0);
      suggestions.push(futureDate.toISOString());
    }

    return suggestions;
  };

  const handleSchedule = (card: SavedCard) => {
    if (scheduledCardIdsSet.has(card.id) || calendarCardIdsSet.has(card.id)) {
      return;
    }

    // Hours validation moved to handleProposeDateTime — checks selected time, not current time

    // Close expanded card modal if open (prevents Modal stacking conflicts)
    if (isModalVisible) {
      setIsModalVisible(false);
      setModalTarget(null);
    }

    // Issue #4265: open the quick "When are you going?" sheet first; the full
    // propose date/time modal is its "Pick another date and time" row.
    setCardToSchedule(card);
    setShowScheduleSheet(true);
  };

  // ---- Opening Hours Validation for Curated Plans ----
  //
  // ORCH-1019 F-2: the bespoke day-name parser (to24Hour / checkSingleStopOpen /
  // checkAllStopsOpen with `stop.openingHours?.[dayName]`) was DELETED. It indexed
  // a day key on the openingHours value, which is the raw Google Places v1 object
  // ({ weekdayDescriptions: [...] }) at runtime — so the lookup was always
  // undefined and every stop was reported "open" ("All Stops Are Open!" even for
  // closed venues). All curated availability now routes through the canonical
  // shared validator (checkAllCuratedStopsOpen) which uses extractWeekdayText +
  // isPlaceOpenAt — the single hours authority. See I-CURATED-HOURS-VIA-CANONICAL-READER.

  const checkAllStopsOpen = (
    stops: CuratedStop[],
    startTime: Date
  ): CuratedStopsAvailabilityResult =>
    checkAllCuratedStopsOpen(stops, startTime, getUserLocale());

  const handleScheduleCurated = (card: SavedCard) => {
    // Gate: curated card schedule requires Mingla+
    if (!canAccess('curated_cards')) {
      setPaywallFeature('curated_cards');
      setShowPaywall(true);
      return;
    }

    if (scheduledCardIdsSet.has(card.id) || calendarCardIdsSet.has(card.id)) return;

    // Close expanded card modal if open (prevents Modal stacking conflicts)
    if (isModalVisible) {
      setIsModalVisible(false);
      setModalTarget(null);
    }

    // Issue #4265: quick sheet first (slots validated against every stop).
    setCardToSchedule(card);
    setShowScheduleSheet(true);
  };

  // Get current scheduled date for a card if it exists
  const getCurrentScheduledDate = (cardId: string): Date | null => {
    if (!calendarEntries) return null;
    const entry = calendarEntries.find(
      (entry: any) => entry.experience?.id === cardId || entry.id === cardId
    );
    if (entry && entry.date && entry.time) {
      // Combine date and time strings into a Date object
      const dateTimeString = `${entry.date}T${entry.time}`;
      const parsed = new Date(dateTimeString);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  };

  // Handle date/time proposal from modal
  const handleProposeDateTime = (
    date: Date,
    dateOption: "now" | "today" | "weekend" | "custom"
  ) => {
    setShowProposeDateTimeModal(false);

    // Check if this is a curated card with stops
    const isCurated = cardToSchedule
      && Array.isArray((cardToSchedule as any).stops)
      && (cardToSchedule as any).stops.length > 0;

    if (isCurated) {
      const stops = (cardToSchedule as any).stops as CuratedStop[];
      const { allOpen, results } = checkAllStopsOpen(stops, date);

      if (allOpen) {
        // All stops are open — ask for confirmation
        const timeStr = date.toLocaleString(getUserLocale(), {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
        Alert.alert(
          'Safe to Schedule',
          `All ${stops.length} stops are confirmed open at ${timeStr}.\n\nWould you like to schedule this plan and add it to your calendar?`,
          [
            { text: 'Not Now', style: 'cancel', onPress: () => setCardToSchedule(null) },
            { text: 'Schedule', onPress: () => proceedWithScheduling(date) },
          ]
        );
      } else {
        // Any closed or unknown stop means the plan is not safe to schedule.
        const unavailableStops = results.filter(r => !r.isOpen);
        const unavailableList = unavailableStops
          .map(s => `  \u2022 ${s.stopName} \u2014 ${s.reason}`)
          .join('\n');

        Alert.alert(
          'Not Safe to Schedule',
          `Mingla could not confirm every stop is open at the time you selected:\n\n${unavailableList}\n\nPlease choose a different time when all stops are confirmed open.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => setCardToSchedule(null) },
            {
              text: 'Choose New Time',
              onPress: () => {
                // Reopen the date/time picker
                setShowProposeDateTimeModal(true);
              },
            },
          ]
        );
      }
    } else {
      // Regular card — scheduling is safe only when the selected time is proven open.
      const availability = checkSingleCardSchedulingAvailability(
        cardToSchedule,
        date,
        getUserLocale(),
      );
      if (!availability.isSafeToSchedule) {
        Alert.alert(
          "Not Safe to Schedule",
          buildSingleCardNotSafeMessage(availability),
          [
            { text: "Cancel", style: "cancel", onPress: () => setCardToSchedule(null) },
            { text: "Choose New Time", onPress: () => setShowProposeDateTimeModal(true) },
          ]
        );
        return;
      }
      proceedWithScheduling(date);
    }
  };

  const proceedWithScheduling = async (scheduledDateTime: Date) => {
    if (!cardToSchedule || !user?.id) {
      Alert.alert(t('activity:savedTab.errorGeneric'), t('activity:savedTab.scheduleErrorLogin'));
      setSchedulingCardId(null);
      setCardToSchedule(null);
      return;
    }

    console.log("cardToSchedule", cardToSchedule.lat);
    console.log("cardToSchedule", cardToSchedule.lng);

    try {
      if (isNaN(scheduledDateTime.getTime())) {
        Alert.alert(t('activity:savedTab.invalidDate'), t('activity:savedTab.invalidDateMsg'));
        setSchedulingCardId(null);
        setCardToSchedule(null);
        return;
      }
      setSchedulingCardId(cardToSchedule.id);
      const scheduledDateISO = scheduledDateTime.toISOString();

      // Determine source from card
      const source: "solo" | "collaboration" =
        cardToSchedule.source === "solo" ? "solo" : "collaboration";

      // Remove card from saved_cards table when scheduling
      try {
        await savedCardsService.removeCard(
          user.id,
          cardToSchedule.id,
          source,
          cardToSchedule.sessionId || undefined
        );
        queryClient.invalidateQueries({ queryKey: savedCardKeys.list(user.id) });
      } catch (error) {
        console.error(
          "Error removing card from saved_cards when scheduling:",
          error
        );
      }

      // #1669 [expanded-card-one-producer]: this is the payload PERSISTED as the
      // calendar entry, and CalendarTab reads it straight back into the same
      // modal — so its two fabrications (`rating || 4.5` and
      // `travelTime || "15 min"`) were not just displayed, they were WRITTEN TO
      // THE DATABASE and then re-read as if they were facts about the venue.
      // Both are gone: the canonical mapper hides missing data instead of
      // inventing it (Constitution #9).
      const isCurated = Array.isArray((cardToSchedule as any).stops)
        && (cardToSchedule as any).stops.length > 0;

      const cardData = savedCardToExpandedCardData(
        cardToSchedule as unknown as Record<string, unknown>,
      );
      if (!cardData) return;

      const cardWithSource = {
        ...cardData,
        source,
        // Collaboration cards carry the originating session's name through to
        // the calendar entry.
        ...(source === "collaboration" && cardToSchedule.sessionName
          ? { sessionName: cardToSchedule.sessionName }
          : {}),
      };

      // Add to calendar in Supabase (lockedIn)
      const record = await CalendarService.addEntryFromSavedCard(
        user.id,
        cardWithSource,
        scheduledDateISO
      );

      // Invalidate calendar entries query to refresh after adding to lockedIn
      queryClient.invalidateQueries({ queryKey: ["calendarEntries", user.id] });

      // Add to device calendar
      try {
        let deviceEvent;
        if (isCurated) {
          deviceEvent = DeviceCalendarService.createEventFromCuratedCard(
            cardToSchedule,
            scheduledDateTime,
            (cardToSchedule as any).estimatedDurationMinutes || 120
          );
        } else {
          deviceEvent = DeviceCalendarService.createEventFromCard(
            cardData,
            scheduledDateTime,
            record.duration_minutes || 120
          );
        }
        const deviceEventId = await DeviceCalendarService.addEventToDeviceCalendar(deviceEvent);
        // Store the device calendar event ID for future reschedule/unschedule
        if (deviceEventId && record?.id) {
          CalendarService.updateEntry(record.id, user.id, {
            device_calendar_event_id: deviceEventId,
          }).catch((err) => console.warn('Failed to store device calendar event ID:', err));
        }
      } catch (deviceCalendarError) {
        console.warn("Failed to add to device calendar:", deviceCalendarError);
      }

      // Track experience scheduled
      mixpanelService.trackExperienceScheduled({
        cardId: cardToSchedule.id,
        cardTitle: cardToSchedule.title,
        category: cardToSchedule.category,
        source,
        scheduledDate: scheduledDateISO,
      });
      logAppsFlyerEvent('experience_scheduled', {
        af_content_type: cardToSchedule.category,
        af_date: scheduledDateISO,
        source,
        af_content_id: cardToSchedule.id,
      });

      // Show success toast
      HapticFeedback.success();
      toastManager.success(t('activity:savedTab.addedToCalendar'), 3000);

      // Call the original handler if provided (for any additional logic)
    } catch (error: any) {
      console.error("[SavedTab] Scheduling error:", error);
      const detail = __DEV__ && error?.message ? `\n\nDEV: ${error.message}` : "";
      Alert.alert(
        t('activity:savedTab.scheduleFailed'),
        `${t('activity:savedTab.scheduleFailedMsg')}${detail}`,
      );
    } finally {
      setSchedulingCardId(null);
      setCardToSchedule(null);
    }
  };

  const handleCardPress = (card: SavedCard) => {
    HapticFeedback.buttonPress();
    const matchScore = getMatchScore(card);

    // Detect if this is a curated multi-stop card
    const isCurated = Array.isArray((card as any).stops) && (card as any).stops.length > 0;

    // #1669 [expanded-card-one-producer]: Likes used to hand-write this object.
    // That literal is where the fabricated `rating: … || 4.5` lived (a place
    // with no rating showed 4.5 stars from Likes and no chip from the deck —
    // Constitution #9), and where a curated plan was rebuilt from a fixed
    // 9-key allowlist instead of passed through, which is the half of
    // ORCH-1054 that was never repaired here. One producer now. The only thing
    // Likes still owns is its own match-score resolution and the "planning
    // for" datetime; every field-survival decision lives in the mapper.
    // #1672 / #3281 1d — brand experiences open the same Book path as the deck
    // (businessEvent → /exp/...), not the curated AI plan modal.
    if (isBrandExperiencePayload(card)) {
      setModalTarget({
        kind: "businessEvent",
        data: experienceRecToBusinessEventCard(card),
      });
      setOriginalSavedCard(card);
      setIsModalVisible(true);
      recordCardExpand(card.id, {
        category: card.category,
        priceTier: undefined,
        isCurated: false,
      });
      mixpanelService.trackCardExpanded({
        cardId: card.id,
        cardTitle: card.title,
        category: card.category,
        source: "saved",
      });
      return;
    }

    const expandedCardData = savedCardToExpandedCardData(
      { ...(card as unknown as Record<string, unknown>), matchScore },
      {
        // [ORCH-0649] Must be a real Date or undefined — never the string "N/A".
        selectedDateTime: (card as any)?.dateAdded
          ? new Date((card as any).dateAdded)
          : undefined,
      },
    );
    if (!expandedCardData) return;

    setModalTarget({ kind: "nightOut", data: expandedCardData });
    setOriginalSavedCard(card);
    setIsModalVisible(true);

    // ORCH-0408 Phase 4: Record expand — counter + user interaction log (fire-and-forget)
    recordCardExpand(card.id, {
      category: card.category,
      priceTier: isCurated ? card.priceTier : undefined,
      isCurated: (card as any).cardType === 'curated',
    });

    // Track card expanded
    mixpanelService.trackCardExpanded({
      cardId: card.id,
      cardTitle: card.title,
      category: card.category,
      source: "saved",
    });
  };

  const handleCloseModal = () => {
    setIsModalVisible(false);
    setModalTarget(null);
    setOriginalSavedCard(null);
  };

  const handleStrollDataFetched = async (
    card: ExpandedCardData,
    strollData: ExpandedCardData["strollData"]
  ) => {
    // Persist stroll data to the appropriate table based on source
    if (!user?.id || !strollData || !originalSavedCard) return;

    const source: "solo" | "collaboration" = originalSavedCard.source;
    try {
      await savedCardsService.updateCardStrollData(
        user.id,
        card,
        strollData,
        source,
        originalSavedCard.sessionId || undefined
      );

      // Invalidate queries to refresh the saved cards list
      queryClient.invalidateQueries({
        queryKey: savedCardKeys.list(user.id),
      });
      if (originalSavedCard.sessionId) {
        queryClient.invalidateQueries({
          queryKey: ["boardSavedCards", originalSavedCard.sessionId],
        });
      }
    } catch (error) {
      console.error("Error persisting stroll data:", error);
      // Don't show error to user - data is still in modal state
    }
  };

  const handlePicnicDataFetched = async (
    card: ExpandedCardData,
    picnicData: ExpandedCardData["picnicData"]
  ) => {
    // Persist picnic data to the appropriate table based on source
    if (!user?.id || !picnicData || !originalSavedCard) return;
    const source: "solo" | "collaboration" = originalSavedCard.source;

    try {
      await savedCardsService.updateCardPicnicData(
        user.id,
        card,
        picnicData,
        source,
        originalSavedCard.sessionId || undefined
      );

      // Invalidate queries to refresh the saved cards list
      queryClient.invalidateQueries({
        queryKey: savedCardKeys.list(user.id),
      });
      if (originalSavedCard.sessionId) {
        queryClient.invalidateQueries({
          queryKey: ["boardSavedCards", originalSavedCard.sessionId],
        });
      }
    } catch (error) {
      console.error("Error persisting picnic data:", error);
      // Don't show error to user - data is still in modal state
    }
  };

  const handleModalSave = async (card: ExpandedCardData) => {
    // Card is already saved, just close the modal
    handleCloseModal();
  };

  const handleModalPurchase = (card: ExpandedCardData, bookingOption: any) => {
    handleCloseModal();
    onPurchaseFromSaved(card as any, bookingOption);
  };

  const handleModalShare = (card: ExpandedCardData) => {
    openExpandedCardContentShare(card, 'saved_expanded');
  };

  const handleCloseProposeDateTimeModal = () => {
    setShowProposeDateTimeModal(false);
    setCardToSchedule(null);
  };

  const unhideCard = (cardId: string) => {
    setHiddenCardIds((prev) => {
      if (!prev.has(cardId)) return prev;
      const next = new Set(prev);
      next.delete(cardId);
      return next;
    });
  };

  /**
   * Issue #4265: the delete itself — the same service call, analytics and
   * cache invalidation the old bin button ran. Runs when the Undo window
   * closes. A failure puts the card back and says so (Constitution #3).
   */
  const commitRemoveSaved = async (card: SavedCard) => {
    if (!user?.id) {
      unhideCard(card.id);
      return;
    }
    try {
      await savedCardsService.removeCard(
        user.id,
        card.id,
        card.source,
        card.sessionId || undefined
      );
      mixpanelService.trackExperienceUnsaved({
        card_id: card.id,
        card_title: card.title ?? '',
        category: card.category ?? '',
      });

      // Invalidate savedCards query to trigger a refetch (for solo mode)
      queryClient.invalidateQueries({ queryKey: savedCardKeys.list(user.id) });

      // If this is a board card, invalidate the board saved cards query
      if (boardSavedCards !== undefined && activeBoardSessionId) {
        queryClient.invalidateQueries({
          queryKey: ["boardSavedCards", activeBoardSessionId],
        });
      }
    } catch (error) {
      console.error("Error removing saved card:", error);
      if (isMountedRef.current) unhideCard(card.id);
      toastManager.error(t('activity:savedTab.couldntRemove'), 3000);
    }
  };

  const isMountedRef = useRef(true);
  const latestCommitRemoveRef = useRef(commitRemoveSaved);
  latestCommitRemoveRef.current = commitRemoveSaved;
  const pendingRemovalsRef = useRef(
    createPendingRemovalController<SavedCard>({
      delayMs: SAVED_UNDO_WINDOW_MS,
      onCommit: (_id, card) => {
        void latestCommitRemoveRef.current(card);
      },
    })
  );

  // Leaving Likes inside the Undo window still honours the heart tap.
  useEffect(() => {
    isMountedRef.current = true;
    const pending = pendingRemovalsRef.current;
    return () => {
      isMountedRef.current = false;
      pending.flushAll();
    };
  }, []);

  // Once a committed removal is gone from the server list, stop tracking it.
  useEffect(() => {
    setHiddenCardIds((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(savedCards.map((c) => c.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (present.has(id) || pendingRemovalsRef.current.isPending(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [savedCards]);

  /** Issue #4265: the heart. Hide now, Undo for ~3 s, then delete. */
  const handleRemoveSaved = (card: SavedCard) => {
    if (!user?.id) return;
    setHiddenCardIds((prev) => new Set(prev).add(card.id));
    pendingRemovalsRef.current.schedule(card.id, card);
    toastManager.show(
      t('activity:savedTab.removedToast'),
      "info",
      SAVED_UNDO_WINDOW_MS,
      {
        label: t('common:undo'),
        accessibilityLabel: t('common:undo'),
        onPress: () => {
          if (pendingRemovalsRef.current.undo(card.id)) {
            HapticFeedback.light();
            unhideCard(card.id);
          }
        },
      },
    );
  };

  /** Issue #4265: the one main button on each grid card. */
  const handlePrimaryAction = (card: SavedCard, action: SavedPrimaryAction) => {
    switch (action) {
      case "schedule":
        if (isCuratedPlan(card)) handleScheduleCurated(card);
        else handleSchedule(card);
        return;
      case "tickets":
        // Reuse the existing purchase path; a brand event with no options
        // opens its Book path in the expanded card, exactly as tapping it does.
        if (card.purchaseOptions && card.purchaseOptions.length > 0) {
          onPurchaseFromSaved(card, card.purchaseOptions[0]);
        } else {
          handleCardPress(card);
        }
        return;
      case "inCalendar":
        return;
      case "findSimilar":
        onExplore?.();
        return;
      default: {
        const exhaustive: never = action;
        return exhaustive;
      }
    }
  };

  const handleLongPressCard = (card: SavedCard) => {
    setMenuCard(card);
  };

  // ─── Issue #1636: virtualised-list plumbing ────────────────────────────────

  /**
   * The ONE style that genuinely depends on a prop, kept out of the hoisted
   * module-scope block.
   *
   * ORCH-1189 contract: LikesPage's `content` View deliberately carries NO
   * frame-shrinking paddingBottom, so this tab paints full-bleed to the
   * physical screen bottom. The floating GlassBottomNav clearance is applied
   * HERE, on the inner scroll content, as `bottomNavTotalHeight + 24`. Moving
   * this onto the FlatList's `contentContainerStyle` keeps that contract
   * byte-for-byte — see
   * `__tests__/orch_1189_likes_floating_nav_clearance.test.mjs` T-3.
   */
  const dynamicStyles = useMemo(
    () =>
      StyleSheet.create({
        mainScrollContent: {
          paddingBottom: bottomNavTotalHeight + 24,
        },
      }),
    [bottomNavTotalHeight],
  );

  /**
   * Permanently-stable row callbacks.
   *
   * The row components are `React.memo`'d, so a callback whose identity changed
   * every render would defeat the memo entirely. Rather than hand-maintaining a
   * `useCallback` dependency array for each handler — where one missing entry is
   * a stale closure and a real bug — the newest handler is parked in a ref every
   * render and the exposed callbacks read through it. The exposed identities
   * never change; the behaviour is always the latest.
   */
  const latestRowHandlersRef = useRef({
    onPress: handleCardPress,
    onPrimary: handlePrimaryAction,
    onShare: onShareCard,
    onRemove: handleRemoveSaved,
    onLongPress: handleLongPressCard,
  });
  latestRowHandlersRef.current = {
    onPress: handleCardPress,
    onPrimary: handlePrimaryAction,
    onShare: onShareCard,
    onRemove: handleRemoveSaved,
    onLongPress: handleLongPressCard,
  };

  // Issue #4265: the grid card reports a card id; resolve it against the cards
  // this tab rendered. An id that is no longer present (removed mid-tap) is a
  // no-op rather than a stale action.
  const cardsByIdRef = useRef<Map<string, SavedCard>>(new Map());
  cardsByIdRef.current = new Map(savedCards.map((c) => [c.id, c]));
  const withCard = (cardId: string, fn: (card: SavedCard) => void) => {
    const card = cardsByIdRef.current.get(cardId);
    if (card) fn(card);
  };

  const rowHandlers = useRef({
    onPress: (cardId: string) =>
      withCard(cardId, (card) => latestRowHandlersRef.current.onPress(card)),
    onPrimary: (cardId: string, action: SavedPrimaryAction) =>
      withCard(cardId, (card) => latestRowHandlersRef.current.onPrimary(card, action)),
    onShare: (cardId: string) =>
      withCard(cardId, (card) => latestRowHandlersRef.current.onShare(card)),
    onRemove: (cardId: string) =>
      withCard(cardId, (card) => latestRowHandlersRef.current.onRemove(card)),
    onLongPress: (cardId: string) =>
      withCard(cardId, (card) => latestRowHandlersRef.current.onLongPress(card)),
  }).current;

  const currencyCode = accountPreferences?.currency || 'USD';
  const locale = getUserLocale();

  const keyExtractor = useCallback((card: SavedCard) => card.id, []);

  const renderItem = useCallback(
    ({ item: card }: ListRenderItemInfo<SavedCard>) => {
      const isCuratedCard = isCuratedPlan(card);
      const isBrandExperience = isBrandExperiencePayload(card);
      const isScheduled =
        scheduledCardIdsSet.has(card.id) || calendarCardIdsSet.has(card.id);
      const primaryAction = resolveSavedPrimaryAction({
        isScheduled,
        isEnded: isBrandExperience && isSavedEventEnded(card, Date.now()),
        isTicketed: isSavedCardTicketed(card, isBrandExperience),
      });
      const scheduledDate = isScheduled ? getCurrentScheduledDate(card.id) : null;
      const { scale } = getCardAnimation(card.id);

      return (
        <Animated.View style={{ transform: [{ scale }] }}>
          <SavedGridCard
            card={card}
            width={cardWidth}
            primaryAction={primaryAction}
            isCurated={isCuratedCard}
            isBrandExperience={isBrandExperience}
            scheduledLabel={scheduledDate ? formatScheduledChip(scheduledDate, locale) : null}
            isScheduling={schedulingCardId === card.id}
            currencyCode={currencyCode}
            reduceMotion={reduceMotion}
            onOpen={rowHandlers.onPress}
            onPrimary={rowHandlers.onPrimary}
            onShare={rowHandlers.onShare}
            onRemove={rowHandlers.onRemove}
            onLongPress={rowHandlers.onLongPress}
          />
        </Animated.View>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      scheduledCardIdsSet,
      calendarCardIdsSet,
      calendarEntries,
      schedulingCardId,
      currencyCode,
      cardWidth,
      reduceMotion,
      locale,
      getCardAnimation,
      rowHandlers,
    ],
  );

  // ─── Issue #4265: quick schedule sheet ─────────────────────────────────────

  /**
   * The next four times this card is open, computed with the SAME validators
   * the scheduling path runs on a pick (checkSingleCardSchedulingAvailability /
   * checkAllCuratedStopsOpen → isPlaceOpenAt). A tile can therefore only offer
   * a time the existing check would accept.
   */
  const quickSlots = useMemo<QuickSlotResult>(() => {
    if (!showScheduleSheet || !cardToSchedule) return EMPTY_QUICK_SLOTS;
    const now = new Date();
    if (isCuratedPlan(cardToSchedule)) {
      const stops = (cardToSchedule as any).stops as CuratedStop[];
      return computeQuickSlots({
        now,
        hasHours: stops.some(
          (stop) => (extractWeekdayText(stop.openingHours)?.length ?? 0) > 0,
        ),
        isOpenAt: (at) => checkAllStopsOpen(stops, at).allOpen,
      });
    }
    return computeQuickSlots({
      now,
      hasHours: (extractWeekdayText(cardToSchedule.openingHours)?.length ?? 0) > 0,
      isOpenAt: (at) => {
        const availability = checkSingleCardSchedulingAvailability(cardToSchedule, at, locale);
        if (availability.status === "open") return true;
        if (availability.status === "closed") return false;
        return null;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showScheduleSheet, cardToSchedule, locale]);

  // BaseBottomSheet reports onClose for a programmatic close too; a close that
  // hands the card on (to a slot pick or the full picker) must keep it.
  const scheduleSheetHandoffRef = useRef(false);

  const handleQuickSlotPick = (at: Date) => {
    scheduleSheetHandoffRef.current = true;
    setShowScheduleSheet(false);
    // The EXISTING path: hours check (+ curated confirm) → proceedWithScheduling.
    handleProposeDateTime(at, "custom");
  };

  const handlePickAnotherTime = () => {
    scheduleSheetHandoffRef.current = true;
    setShowScheduleSheet(false);
    setShowProposeDateTimeModal(true);
  };

  const handleCloseScheduleSheet = () => {
    setShowScheduleSheet(false);
    if (scheduleSheetHandoffRef.current) {
      scheduleSheetHandoffRef.current = false;
      return;
    }
    setCardToSchedule(null);
  };

  // ─── Issue #4265: long-press menu ──────────────────────────────────────────

  const menuPrimaryAction: SavedPrimaryAction | null = menuCard
    ? resolveSavedPrimaryAction({
        isScheduled:
          scheduledCardIdsSet.has(menuCard.id) || calendarCardIdsSet.has(menuCard.id),
        isEnded:
          isBrandExperiencePayload(menuCard) && isSavedEventEnded(menuCard, Date.now()),
        isTicketed: isSavedCardTicketed(menuCard, isBrandExperiencePayload(menuCard)),
      })
    : null;
  const menuCanSchedule =
    !!menuCard &&
    !isBrandExperiencePayload(menuCard) &&
    (menuPrimaryAction === "schedule" || menuPrimaryAction === "tickets");

  const runMenuAction = (fn: (card: SavedCard) => void) => {
    const card = menuCard;
    setMenuCard(null);
    if (card) fn(card);
  };

  // ─── Issue #4265: "N saved" on the Likes title row ─────────────────────────

  const visibleSavedCount = savedCards.filter((c) => !hiddenCardIds.has(c.id)).length;
  useEffect(() => {
    onSavedCountChange?.(effectiveIsLoading || isError ? null : visibleSavedCount);
  }, [onSavedCountChange, effectiveIsLoading, isError, visibleSavedCount]);
  useEffect(() => () => onSavedCountChange?.(null), [onSavedCountChange]);

  const renderEmptyComponent = () => {
    if (effectiveIsLoading) {
      return (
        <SavedGridSkeleton
          cardWidth={cardWidth}
          reduceMotion={reduceMotion}
          accessibilityLabel={t('activity:savedTab.loadingSaved')}
        />
      );
    }

    if (isError && !effectiveIsLoading) {
      return (
        <View style={styles.statePanel}>
          <View style={styles.stateIconCircle}>
            <Icon name="alert-circle-outline" size={30} color={L.accent} />
          </View>
          <Text style={styles.stateTitle} accessibilityRole="header">
            {t('activity:savedTab.errorTitle')}
          </Text>
          <Text style={styles.stateBody}>{t('activity:savedTab.errorSubtitle')}</Text>
          {onRetry && (
            <TouchableOpacity
              onPress={() => {
                HapticFeedback.light();
                onRetry();
              }}
              style={styles.stateButton}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <Text style={styles.stateButtonText}>{t('activity:savedTab.retry')}</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    // Filters active but no matches — different from truly empty
    if (savedCards.length > 0) {
      return (
        <View style={styles.statePanel}>
          <View style={styles.stateIconCircle}>
            <Icon name="filter-outline" size={30} color={L.accent} />
          </View>
          <Text style={styles.stateTitle} accessibilityRole="header">
            {t('activity:savedTab.noMatchesTitle')}
          </Text>
          <Text style={styles.stateBody}>{t('activity:savedTab.noMatchesSubtitle')}</Text>
          <TouchableOpacity
            style={[styles.stateButton, styles.stateButtonQuiet]}
            onPress={() => {
              HapticFeedback.light();
              setSearchQuery('');
              setSelectedWhen('all');
              setSelectedCategory('all');
              setSelectedTier('all');
            }}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <Text style={styles.stateButtonText}>{t('activity:savedTab.clearFilters')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Truly empty — no saved cards at all
    return (
      <View style={styles.statePanel}>
        <View style={styles.stateIconCircle}>
          <Icon name="heart-outline" size={32} color={L.accent} strokeWidth={2} />
        </View>
        <Text style={styles.stateTitle} accessibilityRole="header">
          {t('activity:savedTab.emptyTitle')}
        </Text>
        <Text style={styles.stateBody}>{t('activity:savedTab.emptyBody')}</Text>
        {onExplore ? (
          <TouchableOpacity
            onPress={() => {
              HapticFeedback.light();
              onExplore();
            }}
            style={styles.stateButton}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <Text style={styles.stateButtonText}>{t('activity:savedTab.emptyCta')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  /**
   * Issue #1636: the filter bar is the list HEADER, not a sibling above the
   * list, so it keeps scrolling with the content exactly as it did inside the
   * ScrollView. Memoised because an unstable ListHeaderComponent element would
   * remount the search TextInput on every render and drop the keyboard.
   */
  const listHeader = useMemo(
    () => (
      <Animated.View
        style={[
          styles.headerWrap,
          {
            opacity: searchBarOpacity,
            transform: [{ translateY: searchBarSlide }],
          },
        ]}
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
    ),
    [
      searchBarOpacity,
      searchBarSlide,
      searchQuery,
      selectedWhen,
      selectedCategory,
      selectedTier,
    ],
  );

  // Same four states the ScrollView branch rendered when filteredCards was
  // empty: loading, error+retry, filters-with-no-matches, and truly-empty.
  const listEmpty = useMemo(
    () => renderEmptyComponent(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveIsLoading, isError, onRetry, onExplore, savedCards.length, cardWidth, reduceMotion, t],
  );

  // The keyboard spacer that used to be the ScrollView's last child.
  const listFooter = useMemo(
    () => (keyboardHeight > 0 ? <View style={{ height: keyboardHeight }} /> : null),
    [keyboardHeight],
  );

  return (
    <View style={styles.container}>
      {/* Issue #4265: quick "When are you going?" sheet */}
      <SavedScheduleSheet
        visible={showScheduleSheet}
        title={cardToSchedule?.title ?? ''}
        result={quickSlots}
        locale={locale}
        onPick={handleQuickSlotPick}
        onPickAnother={handlePickAnotherTime}
        onClose={handleCloseScheduleSheet}
      />

      {/* Propose Date & Time Modal — the sheet's "Pick another date and time" */}
      <ProposeDateTimeModal
        visible={showProposeDateTimeModal}
        onClose={handleCloseProposeDateTimeModal}
        card={cardToSchedule}
        currentScheduledDate={cardToSchedule?.dateAdded}
        onProposeDateTime={handleProposeDateTime}
        isCurated={
          !!(
            cardToSchedule &&
            Array.isArray((cardToSchedule as any).stops) &&
            (cardToSchedule as any).stops.length > 0
          )
        }
      />

      {/* Issue #4265: long-press menu */}
      <SavedCardActionMenu
        visible={menuCard !== null}
        title={menuCard?.title ?? ''}
        canSchedule={menuCanSchedule}
        onShare={() => runMenuAction((card) => onShareCard(card))}
        onSchedule={() =>
          runMenuAction((card) =>
            isCuratedPlan(card) ? handleScheduleCurated(card) : handleSchedule(card),
          )
        }
        onRemove={() => runMenuAction((card) => handleRemoveSaved(card))}
        onClose={() => setMenuCard(null)}
      />

      {/*
        Issue #1636 — this was a plain <ScrollView> with `filteredCards.map(...)`,
        which mounts 100 % of its children regardless of viewport. At the real
        production ceiling (148 saves / 52 curated) that committed every card
        subtree in one synchronous pass and fired 201 image requests totalling
        37 MB before the screen was interactive. FlatList mounts only the window.

        Issue #4265 — the list is a two-column grid (`numColumns`), each row
        carrying the 16pt edges / 12pt column gap / 20pt row gap of the design.

        Everything the ScrollView did is preserved deliberately:
          - the filter bar is the list header (still scrolls with the content,
            still carries its entrance animation),
          - the empty / loading / error / no-matches states are the list's empty
            component, still rendered BELOW the filter bar,
          - pull-to-refresh, keyboardShouldPersistTaps="handled",
            keyboardDismissMode="on-drag" and the keyboard spacer are unchanged,
          - the ORCH-1189 floating-nav clearance stays on the scroll CONTENT.
      */}
      <FlatList
        data={filteredCards}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        numColumns={SAVED_GRID_COLUMNS}
        columnWrapperStyle={styles.gridRow}
        style={styles.list}
        contentContainerStyle={dynamicStyles.mainScrollContent}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        ListFooterComponent={listFooter}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#999" />}
        // Card heights vary with title length and Dynamic Type, so there is
        // no honest getItemLayout to give. These bounds keep the mounted
        // window small without leaving blank cells on a normal flick.
        initialNumToRender={ISSUE_1636_INITIAL_RENDER_COUNT}
        maxToRenderPerBatch={ISSUE_1636_INITIAL_RENDER_COUNT}
        updateCellsBatchingPeriod={50}
        windowSize={ISSUE_1636_WINDOW_SIZE}
        // Left off deliberately: removeClippedSubviews has long-standing
        // touch-swallowing bugs on Android, and this list's rows are all
        // interactive.
        removeClippedSubviews={false}
      />

      {/* Expanded Card Modal */}
      {isModalVisible && modalTarget && (
        <ExpandedCardModal
          visible={isModalVisible}
          // ORCH-0828: discriminated-union target.
          target={modalTarget}
          onClose={handleCloseModal}
          isSaved={true}
          onSave={handleModalSave}
          onPurchase={handleModalPurchase}
          onShare={handleModalShare}
          shareProducerSurface="saved_expanded"
          userPreferences={userPreferences}
          // #1669: without this the modal fell back to its Imperial/USD
          // defaults, so a Metric user saw miles and °F from Likes and km and
          // °C from the deck for the same place.
          accountPreferences={accountPreferences}
          onStrollDataFetched={handleStrollDataFetched}
          onPicnicDataFetched={handlePicnicDataFetched}
          canAccessCurated={canAccess('curated_cards')}
          onPaywallRequired={() => {
            handleCloseModal();
            setPaywallFeature('curated_cards');
            setShowPaywall(true);
          }}
        />
      )}

      <CustomPaywallScreen
        isVisible={showPaywall}
        onClose={() => setShowPaywall(false)}
        userId={user?.id ?? ''}
        feature={paywallFeature}
      />
    </View>
  );
};

/**
 * Issue #1636: LikesPage is already `React.memo`'d but SavedTab was not, so any
 * LikesPage render re-ran this entire body. With the style blocks now hoisted
 * and the rows memoised, the remaining win is skipping the body altogether when
 * nothing it reads has changed.
 */
export default React.memo(SavedTab);
