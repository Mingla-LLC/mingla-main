import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  UserPreferences,
} from "../services/experiencesService";
import { useSessionManagement } from "../hooks/useSessionManagement";
import { useBoardSession } from "../hooks/useBoardSession";
import { useCardsCache } from "./CardsCacheContext";
import { useUserLocation } from "../hooks/useUserLocation";
import { useUserPreferences } from "../hooks/useUserPreferences";
import { useDeckCards } from "../hooks/useDeckCards";
import { deckService, getLastWarmPoolTimestamp } from "../services/deckService";
import { computePrefsHash, normalizeDateTime } from "../utils/cardConverters";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "../store/appStore";
import { Recommendation } from "../types/recommendation";
import { useSavedCards } from "../hooks/useSavedCards";
import { useCalendarEntries } from "../hooks/useCalendarEntries";
import { aggregateAllPrefs } from '../utils/sessionPrefsUtils';
import { useSessionDeck } from '../hooks/useSessionDeck';
import { fetchSessionDeck, SessionDeckResponse } from '../services/sessionDeckService';

// Re-export so all existing consumer imports keep working
export type { Recommendation };

// ── Deck UI State Machine ────────────────────────────────────────────────────
// Replaces ad-hoc boolean composition with a single discriminated union.
// Each state maps to exactly one render branch in SwipeableCards.
export type DeckUIState =
  | { type: 'INITIAL_LOADING' }
  | { type: 'LOADED'; cards: Recommendation[] }
  | { type: 'MODE_TRANSITIONING' }
  | { type: 'EXHAUSTED' }
  | { type: 'EMPTY' }
  | { type: 'ERROR'; message: string };

// Stable empty arrays — prevent new references on every render that trigger
// useEffect dependency changes and cause infinite render loops.
const EMPTY_CARDS: Recommendation[] = [];
const EMPTY_PILLS: string[] = [];

const getDefaultPreferences = (): UserPreferences => ({
  mode: "explore",
  budget_min: 0,
  budget_max: 1000,
  people_count: 1,
  categories: ["nature", "casual_eats", "drink"],
  travel_mode: "walking",
  travel_constraint_type: "time",
  travel_constraint_value: 30,
  datetime_pref: null,
});

interface RecommendationsContextType {
  recommendations: Recommendation[];
  loading: boolean;
  isFetching: boolean;
  error: string | null;
  userLocation: { lat: number; lng: number } | null;
  isModeTransitioning: boolean;
  isWaitingForSessionResolution: boolean;
  isRefreshingAfterPrefChange: boolean;
  hasCompletedInitialFetch: boolean;
  refreshRecommendations: (refreshKey?: number | string) => void;
  clearRecommendations: () => void;
  updateCardStrollData: (
    cardId: string,
    strollData: Recommendation["strollData"]
  ) => void;
  handleDeckCardProgress: (currentIndex: number, total: number) => void;
  hasMoreCards: boolean;
  dismissedCards: Recommendation[];
  addDismissedCard: (card: Recommendation) => void;
  clearDismissedCards: () => void;
  removeDismissedCard: (card: Recommendation) => void;
  addCardToFront: (card: Recommendation) => void;
  addSwipedCard: (card: Recommendation) => void;
  sessionSwipedCards: Recommendation[];
  isExhausted: boolean;
  deckUIState: DeckUIState;
  /** Aggregated travel mode from collaboration session (majority vote). null in solo mode. */
  collabTravelMode: string | null;
  onOpenPreferences?: () => void;
  onOpenSessionHistory?: () => void;
}

const RecommendationsContext = createContext<
  RecommendationsContextType | undefined
>(undefined);

interface RecommendationsProviderProps {
  children: React.ReactNode;
  currentMode?: string;
  refreshKey?: number | string;
  resumeCount?: number;
  /** Pre-resolved session UUID from AsyncStorage — enables instant session resolution
   *  without waiting for the full loadUserSessions() network round-trip. */
  persistedSessionId?: string | null;
}

export const RecommendationsProvider: React.FC<
  RecommendationsProviderProps
> = ({
  children,
  currentMode: propCurrentMode = "solo",
  refreshKey: propRefreshKey,
  resumeCount: propResumeCount = 0,
  persistedSessionId: propPersistedSessionId = null,
}) => {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [batchSeed, setBatchSeed] = useState(0);
  const [isModeTransitioning, setIsModeTransitioning] = useState(false);
  const [hasCompletedFetchForCurrentMode, setHasCompletedFetchForCurrentMode] =
    useState(false);
  const [isRefreshingAfterPrefChange, setIsRefreshingAfterPrefChange] = useState(false);
  const [hasMoreCards, setHasMoreCards] = useState(true);
  const [dismissedCards, setDismissedCards] = useState<Recommendation[]>([]);
  const [isExhausted, setIsExhausted] = useState(false);
  const prefetchFiredRef = useRef(false);
  // Session-scoped dedup: tracks all card IDs served in the current session.
  // Cleared on preference change and mode switch. Catches the prefetch race
  // condition where page 2 starts before page 1's impressions are committed.
  const sessionServedIdsRef = useRef<Set<string>>(new Set());
  const hasStartedRef = useRef(false);
  // Accumulated cards from all pages (flat array, not per-batch)
  const accumulatedCardsRef = useRef<Recommendation[]>([]);
  // Counter that increments when session-served IDs change — triggers excludeCardIds memo recomputation
  const [servedIdsVersion, setServedIdsVersion] = useState(0);
  // Guard: prevents stale batchSeed from firing a query during pref-change reset.
  // Set to false when reset starts, true after batchSeed has been confirmed 0.
  const [batchSeedReady, setBatchSeedReady] = useState(true);
  const currentMode = propCurrentMode;
  const refreshKey = propRefreshKey;
  const previousRefreshKeyRef = useRef(propRefreshKey);
  const currentCacheKeyRef = useRef<string | null>(null);
  const warmPoolFired = useRef(false);
  const queryClient = useQueryClient();

  // ── Deck session state (Zustand) ────────────────────────────────────
  const {
    addSwipedCard,
    resetDeckHistory,
    deckPrefsHash,
    sessionSwipedCards,
  } = useAppStore();

  const user = useAppStore((state) => state.user);
  const cardsCache = useCardsCache();
  const {
    currentSession,
    isInSolo,
    availableSessions,
    loading: sessionsLoading,
  } = useSessionManagement();

  // ── Exclusion IDs: saved + scheduled cards ─────────────────────────────
  const { data: savedCards } = useSavedCards(user?.id);
  const { data: calendarEntries } = useCalendarEntries(user?.id);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const excludeCardIds = useMemo(() => {
    const ids = new Set<string>();
    // Saved card IDs
    if (savedCards) {
      for (const card of savedCards) {
        if (card.id && UUID_RE.test(card.id)) ids.add(card.id);
      }
    }
    // Scheduled card IDs (pending/confirmed only, UUID format only)
    if (calendarEntries) {
      for (const entry of calendarEntries) {
        if (
          (entry.status === 'pending' || entry.status === 'confirmed') &&
          entry.card_id &&
          UUID_RE.test(entry.card_id)
        ) {
          ids.add(entry.card_id);
        }
      }
    }
    // Session-served IDs — cards already delivered in earlier pages this session.
    // servedIdsVersion triggers recomputation when new cards are accumulated.
    for (const id of sessionServedIdsRef.current) {
      if (UUID_RE.test(id)) ids.add(id);
    }
    return Array.from(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedCards, calendarEntries, servedIdsVersion]);

  // HF-003 fix: Load dismissed cards from AsyncStorage on mount / mode change.
  // Key is mode-specific so solo and collab dismissed cards don't cross-contaminate.
  useEffect(() => {
    if (!user?.id) return;
    const key = `dismissed_cards_${user.id}_${currentMode}`;
    AsyncStorage.getItem(key).then(stored => {
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setDismissedCards(parsed);
          }
        } catch {}
      }
    }).catch(() => {});
  }, [user?.id, currentMode]);

  // ── Session Resolution ──────────────────────────────────────────────────
  // Priority: currentSession (live) > persisted UUID (AsyncStorage) > mode-as-UUID > name lookup.
  // The persisted UUID enables instant resolution on app reopen without waiting
  // for the full loadUserSessions() network round-trip (8 sequential queries).
  const resolvedSessionId = React.useMemo(() => {
    if (currentMode === "solo") return null;
    if (currentSession?.id) return currentSession.id;
    // Use the UUID persisted alongside the mode name in AsyncStorage
    if (propPersistedSessionId) return propPersistedSessionId;
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(currentMode)) return currentMode;
    const session = availableSessions.find(
      (s) => s.id === currentMode || s.name === currentMode
    );
    return session?.id || null;
  }, [currentMode, currentSession, propPersistedSessionId, availableSessions]);

  const [hasTimedOutWaitingForSession, setHasTimedOutWaitingForSession] =
    useState(false);

  useEffect(() => {
    if (currentMode !== "solo" && !resolvedSessionId && sessionsLoading) {
      const timer = setTimeout(() => {
        console.warn(
          "Timed out waiting for session resolution for:",
          currentMode
        );
        setHasTimedOutWaitingForSession(true);
      }, 5000);
      return () => clearTimeout(timer);
    } else {
      setHasTimedOutWaitingForSession(false);
    }
  }, [currentMode, resolvedSessionId, sessionsLoading]);

  const isWaitingForSessionResolution =
    currentMode !== "solo" &&
    !resolvedSessionId &&
    sessionsLoading &&
    !hasTimedOutWaitingForSession;

  const isBoardSession =
    !isInSolo && (currentSession as any)?.session_type === "board";

  const boardSessionResult = useBoardSession(
    isBoardSession && currentSession?.id ? currentSession.id : undefined
  );
  const boardPreferences = boardSessionResult?.preferences || null;

  // Read all participants' prefs from board session
  const allParticipantPrefs = boardSessionResult?.allParticipantPreferences ?? null;

  // ── Collaboration mode flag ──
  const isCollaborationMode: boolean = Boolean(
    currentMode !== "solo" && resolvedSessionId
  );
  const isSoloMode = currentMode === "solo";

  // ── Location & Preferences ──────────────────────────────────────────────
  const {
    data: userLocationData,
    isLoading: isLoadingLocation,
    error: locationError,
  } = useUserLocation(user?.id, currentMode, refreshKey);

  const userLocation: { lat: number; lng: number } | null = useMemo(
    () => userLocationData
      ? { lat: userLocationData.lat, lng: userLocationData.lng }
      : null,
    [userLocationData?.lat, userLocationData?.lng]
  );

  const { data: userPrefs, isLoading: isLoadingPreferences } =
    useUserPreferences(user?.id);

  // ── Unified Deck Pool Warming ───────────────────────────────────────────
  useEffect(() => {
    if (userLocation && userPrefs && !warmPoolFired.current) {
      warmPoolFired.current = true;

      // Skip if warm pool was already fired recently (e.g., by onboarding)
      const lastWarm = getLastWarmPoolTimestamp();
      if (Date.now() - lastWarm < 30_000) {
        console.log('[RecommendationsContext] Warm pool skipped — already fired within 30s');
        return;
      }

      // Stagger warm pool 2s after initial load. The warm pool is fire-and-forget
      // (UI doesn't wait for it), so delaying it costs nothing. But it prevents
      // 4+ concurrent HTTP/2 requests from competing for the same TCP connection
      // on iOS, which causes head-of-line blocking and cascading timeouts.
      const warmDelay = setTimeout(() => {
        const warmStart = Date.now();
        deckService.warmDeckPool({
          location: userLocation,
          categories: userPrefs.categories ?? [],
          intents: (userPrefs.intents ?? []).slice(0, 1),
          priceTiers: userPrefs.price_tiers ?? ['chill', 'comfy', 'bougie', 'lavish'],
          budgetMin: userPrefs.budget_min ?? 0,
          budgetMax: userPrefs.budget_max ?? 1000,
          travelMode: userPrefs.travel_mode ?? 'walking',
          travelConstraintType: 'time' as const,
          travelConstraintValue: userPrefs.travel_constraint_value ?? 30,
          datetimePref: userPrefs.datetime_pref ?? undefined,
          dateOption: userPrefs.date_option ?? 'now',
          timeSlot: userPrefs.time_slot ?? null,
        }).then(() => {
          if (__DEV__) console.log(`[Deck] Pool warmed in ${Date.now() - warmStart}ms`);
        }).catch(() => {});
      }, 2000);

      return () => clearTimeout(warmDelay);
    }
  }, [userLocation, userPrefs]);

  // ── Stabilize deck params — only compute once preferences are known or timed out
  const stableDeckParams = useMemo(() => {
    const cats = userPrefs?.categories ?? [];
    const ints = userPrefs?.intents ?? [];

    // Still loading and nothing to show yet — wait for preferences to settle.
    if (cats.length === 0 && ints.length === 0 && isLoadingPreferences) return null;

    // Determine categories: respect the user's explicit selection.
    // Default categories ONLY apply when preferences genuinely have no signal at all
    // (no categories AND no intents) — i.e. a brand-new user or a network failure.
    // When the user has intents but zero categories, that's an intentional choice
    // ("show me only curated experiences") — empty categories must stay empty.
    const hasAnySignal = cats.length > 0 || ints.length > 0;
    return {
      categories: cats.length > 0
        ? cats
        : hasAnySignal
          ? []                                      // user chose intents only — respect that
          : ["nature", "casual_eats", "drink"],     // true empty state — sensible default
      // Radio behavior: max 1 intent. DB may have stale multi-intent data from
      // legacy saves — cap here to prevent over-fetching curated pools.
      intents: ints.slice(0, 1),
    };
  }, [
    // Use JSON.stringify to prevent array-reference changes from causing recomputation
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(userPrefs?.categories ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(userPrefs?.intents ?? []),
    isLoadingPreferences,
  ]);

  // ── Collaboration deck params (union of all participants) ─────────────
  const collabDeckParams = useMemo(() => {
    if (!isCollaborationMode || !allParticipantPrefs || allParticipantPrefs.length === 0) {
      return null;
    }

    const aggregated = aggregateAllPrefs(allParticipantPrefs);

    if (aggregated.categories.length === 0 && aggregated.intents.length === 0) return null;

    return {
      categories: aggregated.categories,
      intents: aggregated.intents,
      priceTiers: aggregated.priceTiers,
      budgetMin: aggregated.budgetMin,
      budgetMax: aggregated.budgetMax,
      travelMode: aggregated.travelMode,
      travelConstraintType: aggregated.travelConstraintType,
      travelConstraintValue: aggregated.travelConstraintValue,
      datetimePref: aggregated.datetimePref,
      location: aggregated.location,
    };
  }, [isCollaborationMode, allParticipantPrefs]);

  // ── Solo Deck Hook (existing useDeckCards, only for solo mode) ────────
  const activeDeckParams = isSoloMode ? stableDeckParams : collabDeckParams;
  const activeDeckLocation = isSoloMode
    ? userLocation
    : (collabDeckParams?.location ?? userLocation);

  // ── Guard: defer deck query until params are stable for 1 tick ──────
  // During mode transitions, activeDeckParams can flicker null → value → same value
  // across successive renders. Each flicker creates a different React Query key,
  // causing duplicate fetchDeck calls. This ref ensures useDeckCards only enables
  // AFTER the params have been non-null for at least one render cycle.
  const deckParamsStableRef = useRef(false);
  const prevDeckParamsRef = useRef<string | null>(null);

  const currentParamsKey = activeDeckParams
    ? JSON.stringify([activeDeckParams.categories, activeDeckParams.intents])
    : null;

  useEffect(() => {
    if (currentParamsKey !== null && currentParamsKey === prevDeckParamsRef.current) {
      // Params settled — same value two renders in a row
      deckParamsStableRef.current = true;
    } else {
      // Params changed or still null — not yet stable
      deckParamsStableRef.current = false;
    }
    prevDeckParamsRef.current = currentParamsKey;
  });

  const isDeckParamsStable = deckParamsStableRef.current || (
    // First load fast path: if params are available and we're not mid-transition, allow immediately
    activeDeckParams !== null && !isModeTransitioning
  );

  // ── Mode-aware preference resolution ────────────────────────────────
  // In solo mode: read from userPrefs (current user's DB preferences).
  // In collab mode: read from collabDeckParams (aggregated group consensus).
  // Categories and intents already come from activeDeckParams — this extends
  // the same pattern to budget, travel, and datetime fields.

  const effectivePriceTiers = isCollaborationMode && collabDeckParams?.priceTiers
    ? collabDeckParams.priceTiers
    : userPrefs?.price_tiers ?? ['chill', 'comfy', 'bougie', 'lavish'];

  const effectiveBudgetMin = isCollaborationMode && collabDeckParams
    ? collabDeckParams.budgetMin
    : userPrefs?.budget_min ?? 0;

  const effectiveBudgetMax = isCollaborationMode && collabDeckParams
    ? collabDeckParams.budgetMax
    : userPrefs?.budget_max ?? 1000;

  const effectiveTravelMode = isCollaborationMode && collabDeckParams
    ? collabDeckParams.travelMode
    : userPrefs?.travel_mode ?? 'walking';

  const effectiveTravelConstraintValue = isCollaborationMode && collabDeckParams
    ? collabDeckParams.travelConstraintValue
    : userPrefs?.travel_constraint_value ?? 30;

  const effectiveDatetimePref = isCollaborationMode && collabDeckParams
    ? collabDeckParams.datetimePref
    : userPrefs?.datetime_pref ?? undefined;

  // dateOption, timeSlot: collab aggregation doesn't compute these
  // (they're solo-only UI concepts). For collab, pass defaults so the edge
  // function falls back to datetimePref-based filtering.
  const effectiveDateOption = isCollaborationMode ? 'now' : (userPrefs?.date_option ?? 'now');
  const effectiveTimeSlot = isCollaborationMode ? null : (userPrefs?.time_slot ?? null);

  const {
    cards: soloDeckCards,
    deckMode: soloDeckMode,
    activePills: soloActivePills,
    isLoading: isSoloDeckLoading,
    isFetching: isSoloDeckFetching,
    isFullBatchLoaded: isSoloDeckBatchLoaded,
    hasMore: soloDeckHasMore,
    error: soloDeckError,
  } = useDeckCards({
    location: activeDeckLocation,
    categories: activeDeckParams?.categories ?? [],
    intents: activeDeckParams?.intents ?? [],
    priceTiers: effectivePriceTiers,
    budgetMin: effectiveBudgetMin, // Always 0 — kept for interface compat
    budgetMax: effectiveBudgetMax,
    travelMode: effectiveTravelMode,
    travelConstraintType: 'time' as const,
    travelConstraintValue: effectiveTravelConstraintValue,
    datetimePref: effectiveDatetimePref,
    dateOption: effectiveDateOption,
    timeSlot: effectiveTimeSlot,
    batchSeed,
    enabled: isSoloMode &&
      !!activeDeckLocation &&
      activeDeckParams !== null &&
      isDeckParamsStable &&
      !isWaitingForSessionResolution &&
      batchSeedReady,
    excludeCardIds,
  });

  // ── Collaboration Deck Hook (server-side synchronized deck) ──────────
  const {
    data: sessionDeckData,
    isLoading: isSessionDeckLoading,
    isFetching: isSessionDeckFetching,
  } = useSessionDeck(
    isCollaborationMode ? resolvedSessionId ?? undefined : undefined,
    batchSeed,
    isCollaborationMode && !!resolvedSessionId && !isWaitingForSessionResolution && batchSeedReady,
    excludeCardIds,
  );

  // ── Unified deck output (branch by mode) ─────────────────────────────
  const deckCards = isCollaborationMode
    ? (sessionDeckData?.cards ?? EMPTY_CARDS)
    : soloDeckCards;
  const deckMode = isCollaborationMode ? 'mixed' : soloDeckMode;
  const activePills = isCollaborationMode ? EMPTY_PILLS : soloActivePills;
  const isDeckLoading = isCollaborationMode ? isSessionDeckLoading : isSoloDeckLoading;
  const isDeckFetching = isCollaborationMode ? isSessionDeckFetching : isSoloDeckFetching;
  const isDeckBatchLoaded = isCollaborationMode
    ? (!isSessionDeckLoading && !isSessionDeckFetching)
    : isSoloDeckBatchLoaded;
  const deckHasMore = isCollaborationMode
    ? (sessionDeckData?.hasMore ?? false)
    : soloDeckHasMore;

  // batchSeed race guard: re-enable queries once batchSeed has settled to 0
  useEffect(() => {
    if (!batchSeedReady && batchSeed === 0) {
      setBatchSeedReady(true);
    }
  }, [batchSeed, batchSeedReady]);

  // ── Dismissed card callbacks ─────────────────────────────────────────────
  const addDismissedCard = useCallback((card: Recommendation) => {
    setDismissedCards(prev => {
      const updated = [...prev, card];
      // HF-003 fix: persist to AsyncStorage (mode-specific key)
      if (user?.id) {
        AsyncStorage.setItem(
          `dismissed_cards_${user.id}_${currentMode}`,
          JSON.stringify(updated)
        ).catch(() => {});
      }
      return updated;
    });
  }, [user?.id, currentMode]);

  const clearDismissedCards = useCallback(() => {
    setDismissedCards([]);
  }, []);

  const removeDismissedCard = useCallback((card: Recommendation) => {
    setDismissedCards((prev) => prev.filter((c) => c.id !== card.id));
  }, []);

  const addCardToFront = useCallback((card: Recommendation) => {
    setRecommendations((prev) => [card, ...prev.filter((c) => c.id !== card.id)]);
  }, []);

  // ── Sync hasMore and exhaustion from deck hook ──────────────────────────
  useEffect(() => {
    setHasMoreCards(deckHasMore);
    if (
      deckCards.length === 0 &&
      !deckHasMore &&
      isDeckBatchLoaded &&
      !isDeckFetching &&
      !isModeTransitioning &&
      !isRefreshingAfterPrefChange
    ) {
      setIsExhausted(true);
    }
  }, [deckHasMore, deckCards.length, isDeckBatchLoaded, isDeckFetching, isModeTransitioning, isRefreshingAfterPrefChange]);

  // Reset prefetchFiredRef when batchSeed changes
  useEffect(() => {
    prefetchFiredRef.current = false;
  }, [batchSeed]);

  // ── Refresh Key Handler ─────────────────────────────────────────────────
  // When preferences change (refreshKey increments), reset state.
  // The query key change from updated categories/intents handles refetching automatically.
  useEffect(() => {
    if (previousRefreshKeyRef.current !== undefined && previousRefreshKeyRef.current !== refreshKey) {
      // Reset page to 0 — the query key change from new params will
      // naturally trigger a refetch. No need to manually invalidate.
      setBatchSeedReady(false); // Block queries until batchSeed is confirmed 0
      setBatchSeed(0);
      setIsExhausted(false);
      setHasMoreCards(true);
      setIsRefreshingAfterPrefChange(true);
      setDismissedCards([]);
      accumulatedCardsRef.current = [];
      setServedIdsVersion(0);
      // HF-003 fix: clear dismissed cards from AsyncStorage on preference change
      if (user?.id) {
        AsyncStorage.removeItem(`dismissed_cards_${user.id}_${currentMode}`).catch(() => {});
      }
      // Reset warm pool so it re-fires with new preferences
      warmPoolFired.current = false;
      sessionServedIdsRef.current.clear();
      // DO NOT call queryClient.invalidateQueries — the query key change
      // from updated categories/intents handles refetching automatically
    }
    previousRefreshKeyRef.current = refreshKey;
  }, [refreshKey, user?.id]);

  // ── Clear isRefreshingAfterPrefChange once deck settles ─────────────────
  useEffect(() => {
    if (!isRefreshingAfterPrefChange) return;
    const allSettled = isDeckBatchLoaded && !isDeckFetching;
    if (allSettled) {
      setIsRefreshingAfterPrefChange(false);
    }
  }, [isRefreshingAfterPrefChange, isDeckBatchLoaded, isDeckFetching]);

  // Pref refresh safety timeout REMOVED — state machine handles this:
  // pref change → INITIAL_LOADING → query resolves → LOADED/EMPTY.
  // The settle effect above (isDeckBatchLoaded && !isDeckFetching) clears the flag.

  // First-mount safety timeout: 20s guard for the edge case where GPS never resolves
  // on first launch (user denies permission, device has no location services, etc.).
  // Unlike the old 15s timeout, this works correctly because the EMPTY check no longer
  // requires !loading — so forcing hasCompletedFetchForCurrentMode=true actually
  // resolves to EMPTY state instead of falling through to the INITIAL_LOADING fallback.
  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    const safetyTimer = setTimeout(() => {
      if (!hasCompletedFetchForCurrentMode) {
        console.warn('[RecommendationsContext] 20s first-mount safety timeout — forcing complete');
        setHasCompletedFetchForCurrentMode(true);
        setIsModeTransitioning(false);
      }
    }, 20000);

    return () => clearTimeout(safetyTimer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // (Batch history and navigation removed — cards accumulate in flat array)

  // ── Pre-fetch next page when 8 or fewer cards remain ─────────────────
  const handleDeckCardProgress = useCallback((currentIndex: number, total: number) => {
    if (!activeDeckLocation || !activeDeckParams) return;
    const remainingCards = total - currentIndex - 1;

    // When 8 or fewer cards remain, prefetch next page (once per page)
    if (remainingCards <= 8 && !prefetchFiredRef.current && hasMoreCards) {
      prefetchFiredRef.current = true;
      const nextSeed = batchSeed + 1;

      // Auto-increment page counter — the prefetched data will be picked up
      // by the deck cards sync effect and appended to recommendations.
      setBatchSeed(nextSeed);

      // Collaboration mode: prefetch via server-side session deck
      if (isCollaborationMode && resolvedSessionId) {
        queryClient.prefetchQuery({
          queryKey: ['session-deck', resolvedSessionId, nextSeed],
          queryFn: () => fetchSessionDeck(resolvedSessionId, nextSeed, excludeCardIds),
          staleTime: 30 * 60 * 1000,
        });
      } else {
        // Solo mode: prefetch via client-side deckService
        const prefetchCategories = activeDeckParams.categories ?? [];
        const prefetchIntents = activeDeckParams.intents ?? [];
        const prefetchPriceTiers = isSoloMode
          ? (userPrefs?.price_tiers ?? ['chill', 'comfy', 'bougie', 'lavish'])
          : (activeDeckParams.priceTiers ?? ['chill', 'comfy', 'bougie', 'lavish']);
        const prefetchBudgetMin = isSoloMode ? (userPrefs?.budget_min ?? 0) : (activeDeckParams.budgetMin ?? 0);
        const prefetchBudgetMax = isSoloMode ? (userPrefs?.budget_max ?? 1000) : (activeDeckParams.budgetMax ?? 1000);
        const prefetchTravelMode = isSoloMode ? (userPrefs?.travel_mode ?? 'walking') : (activeDeckParams.travelMode ?? 'walking');
        const prefetchConstraintType = 'time' as const;
        const prefetchConstraintValue = isSoloMode ? (userPrefs?.travel_constraint_value ?? 30) : (activeDeckParams.travelConstraintValue ?? 30);
        const prefetchDateOption = isSoloMode ? (userPrefs?.date_option ?? 'now') : 'now';
        const prefetchTimeSlot = isSoloMode ? (userPrefs?.time_slot ?? null) : null;
        const rawDatetimePref = isSoloMode ? userPrefs?.datetime_pref : (activeDeckParams.datetimePref ?? undefined);
        // Normalize to ISO string to match useDeckCards query key format
        const prefetchDatetimePref = rawDatetimePref
          ? normalizeDateTime(rawDatetimePref)
          : undefined;

        const prefetchLat = Math.round(activeDeckLocation.lat * 1000) / 1000;
        const prefetchLng = Math.round(activeDeckLocation.lng * 1000) / 1000;
        queryClient.prefetchQuery({
          queryKey: [
            'deck-cards',
            prefetchLat, prefetchLng,
            prefetchCategories.sort().join(','),
            prefetchIntents.sort().join(','),
            prefetchPriceTiers.sort().join(','),
            prefetchBudgetMin,
            prefetchBudgetMax,
            prefetchTravelMode,
            prefetchConstraintType,
            prefetchConstraintValue,
            prefetchDatetimePref,
            prefetchDateOption,
            prefetchTimeSlot ?? '',
            nextSeed,
            excludeCardIds.sort().join(','),
          ],
          queryFn: () => deckService.fetchDeck({
            location: activeDeckLocation,
            categories: prefetchCategories,
            intents: prefetchIntents,
            priceTiers: prefetchPriceTiers,
            budgetMin: prefetchBudgetMin,
            budgetMax: prefetchBudgetMax,
            travelMode: prefetchTravelMode,
            travelConstraintType: prefetchConstraintType,
            travelConstraintValue: prefetchConstraintValue,
            datetimePref: prefetchDatetimePref,
            dateOption: prefetchDateOption,
            timeSlot: prefetchTimeSlot,
            batchSeed: nextSeed,
            limit: 20,
            excludeCardIds,
          }),
          staleTime: 5 * 60 * 1000,
        });
      }
    }
  }, [batchSeed, hasMoreCards, activeDeckLocation, activeDeckParams, isSoloMode, isCollaborationMode, resolvedSessionId, userPrefs, queryClient, excludeCardIds]);

  // ── Sync deck cards to recommendations state (unified for solo + collab) ──
  // Infinite deck: APPEND new page results to accumulated cards instead of replacing.
  const previousDeckIdsRef = useRef<string>('');

  useEffect(() => {
    if (isSoloMode || isCollaborationMode) {
      if (deckCards.length > 0) {
        const deckIdsKey = `${batchSeed}:${deckCards.map(c => c.id).sort().join(',')}`;
        if (previousDeckIdsRef.current !== deckIdsKey) {
          previousDeckIdsRef.current = deckIdsKey;
          // Deduplicate against already-served cards in this session
          const dedupedCards = deckCards.filter(c => !sessionServedIdsRef.current.has(c.id));
          for (const c of dedupedCards) sessionServedIdsRef.current.add(c.id);
          if (dedupedCards.length > 0) {
            setServedIdsVersion(v => v + 1); // Trigger excludeCardIds recomputation
          }

          if (dedupedCards.length === 0 && batchSeed > 0 && deckHasMore && isDeckBatchLoaded) {
            // All cards on this page are duplicates, fetch succeeded, server says more exist.
            // Skip to next page. (If deckHasMore is false or fetch errored, stop.)
            setBatchSeed(prev => prev + 1);
            prefetchFiredRef.current = false;
            // Don't overwrite accumulatedCardsRef — keep existing cards visible
          } else if (batchSeed === 0) {
            // First page: replace (fresh session or pref change)
            accumulatedCardsRef.current = dedupedCards.length > 0 ? dedupedCards : deckCards;
            setRecommendations(accumulatedCardsRef.current);
          } else {
            // Subsequent pages: append new unique cards
            accumulatedCardsRef.current = [...accumulatedCardsRef.current, ...dedupedCards];
            setRecommendations(accumulatedCardsRef.current);
          }
        }

        // If we were exhausted but new cards arrived, un-exhaust
        if (isDeckBatchLoaded && isExhausted && deckCards.length > 0) {
          setIsExhausted(false);
        }
      } else if (deckCards.length === 0 && isDeckBatchLoaded && !isDeckFetching && !isModeTransitioning) {
        // Genuinely empty — no cards available for current page.
        // Only clear recommendations if accumulated stack is also empty.
        if (accumulatedCardsRef.current.length === 0) {
          setRecommendations(prev => prev.length === 0 ? prev : EMPTY_CARDS);
        }
      }
    }
  }, [deckCards, isDeckBatchLoaded, isDeckFetching, isExhausted, isSoloMode, isCollaborationMode, batchSeed, isModeTransitioning, deckHasMore]);

  // ── Mode Transition Handling ────────────────────────────────────────────
  const previousModeRef = useRef<string | undefined>(undefined);
  const completionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const prevMode = previousModeRef.current;
    const modeChanged =
      prevMode !== undefined &&
      prevMode !== currentMode;

    if (modeChanged) {
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
        completionTimeoutRef.current = null;
      }

      // ── Cache-first check: see if React Query already has cards for the new mode.
      // If so, skip the loading spinner entirely and show cached cards instantly.
      // This is the key optimization — reopening a previously visited session is instant.
      let hasCachedCards = false;
      const newModeIsSolo = currentMode === 'solo';
      if (!newModeIsSolo && propPersistedSessionId) {
        // Collaboration: check session-deck cache
        const cachedSessionDeck = queryClient.getQueryData<SessionDeckResponse>(['session-deck', propPersistedSessionId, 0]);
        if (cachedSessionDeck && cachedSessionDeck.cards?.length > 0) {
          hasCachedCards = true;
        }
      }
      // For solo mode, useDeckCards' initialData and RQ persistence handle the cache.
      // We don't need to check here — the query will return cached data immediately.

      // ── Full state reset on mode change ────────────────────────────────
      // Every mode starts with a clean slate. No stale batch positions,
      // exhaustion flags, or prefetch state carrying over.
      setIsModeTransitioning(!hasCachedCards); // Skip transition spinner if cache has cards
      setHasCompletedFetchForCurrentMode(hasCachedCards); // Already "complete" if cache hit
      previousDeckIdsRef.current = '';
      setBatchSeed(0);
      prefetchFiredRef.current = false;
      setIsExhausted(false);
      setHasMoreCards(true);
      setDismissedCards([]);
      accumulatedCardsRef.current = [];
      warmPoolFired.current = false;
      sessionServedIdsRef.current.clear();
      setServedIdsVersion(0);

      // Clear deck session state — each mode starts fresh
      const { resetDeckHistory } = useAppStore.getState();
      resetDeckHistory('');

      // No need to wipe persisted dismissed cards — the storage key is
      // mode-specific (`dismissed_cards_${userId}_${mode}`), so each mode's
      // dismissed cards persist independently and don't cross-contaminate.

      if (!hasCachedCards) {
        completionTimeoutRef.current = setTimeout(() => {
          console.warn("Recommendations fetch timeout - forcing completion");
          setHasCompletedFetchForCurrentMode(true);
          setIsModeTransitioning(false);
        }, 5000);
      }
    }

    previousModeRef.current = currentMode;

    return () => {
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
      }
    };
  }, [currentMode, queryClient]);

  // ── Loading & Fetching States ───────────────────────────────────────────
  const loading = isLoadingLocation || isLoadingPreferences || isDeckLoading;

  // isFetching covers ALL data pipelines — not just recommendations
  const isFetching = isDeckFetching || isRefreshingAfterPrefChange;

  // ── Mark Fetch Complete ─────────────────────────────────────────────────
  useEffect(() => {
    const queryEnabled = Boolean(userLocation && !isWaitingForSessionResolution);

    // NOTE: Previously had early cleanup here that cleared completionTimeoutRef
    // when hasCompletedFetchForCurrentMode was true. Removed because it raced
    // with the mode transition effect: both effects run in the same render,
    // the mode transition effect sets the timeout (ref = immediate), but state
    // updates (setHasCompletedFetchForCurrentMode(false)) are queued — so this
    // effect still saw the OLD state (true) and killed the freshly-set timeout.
    // The timeout is already cleared inside the shouldMarkComplete block below,
    // which is the only correct place to clear it.

    if (isModeTransitioning || !hasCompletedFetchForCurrentMode) {
      const queryFinished = isDeckBatchLoaded;
      const hasQueryResult = deckCards.length > 0 || isDeckBatchLoaded;
      const hasRecommendationsInState = recommendations.length > 0;

      const shouldMarkComplete =
        (queryEnabled && queryFinished && hasQueryResult) ||
        (hasRecommendationsInState && !isModeTransitioning && !loading) ||
        (locationError && queryFinished) ||
        // Settled state: initial loading flags are false regardless of data/null.
        // This fires when location resolves to null (no error, no data) — without it
        // the spinner runs forever in that case.
        // Guard: skip during mode transitions — location & preferences are already
        // loaded from the previous mode, so this would fire before the new mode's
        // deck query has started, dropping the loading screen prematurely and
        // flashing an empty state before cards arrive.
        // NOTE: isDeckFetching intentionally excluded — it stays true during
        // background refetches and would prevent completion after the initial load.
        (!isLoadingLocation && !isLoadingPreferences && !isDeckLoading && !isModeTransitioning);

      if (shouldMarkComplete) {
        setHasCompletedFetchForCurrentMode(true);
        if (isModeTransitioning) {
          setIsModeTransitioning(false);
        }
        if (completionTimeoutRef.current) {
          clearTimeout(completionTimeoutRef.current);
          completionTimeoutRef.current = null;
        }
      }
    }
  }, [
    isModeTransitioning,
    hasCompletedFetchForCurrentMode,
    isDeckBatchLoaded,
    isDeckLoading,
    isDeckFetching,
    deckCards.length,
    recommendations.length,
    userLocation,
    isWaitingForSessionResolution,
    currentMode,
    loading,
    locationError,
    isLoadingLocation,
    isLoadingPreferences,
  ]);

  // ── Update Card Stroll Data ─────────────────────────────────────────────
  const updateCardStrollData = useCallback(
    (cardId: string, strollData: Recommendation["strollData"]) => {
      setRecommendations((prev) =>
        prev.map((card) =>
          card.id === cardId ? { ...card, strollData } : card
        )
      );

      if (currentCacheKeyRef.current) {
        const cachedEntry = cardsCache.getCachedCards(currentCacheKeyRef.current);
        if (cachedEntry) {
          const updatedCards = cachedEntry.cards.map((card) =>
            card.id === cardId ? { ...card, strollData } : card
          );
          cardsCache.setCachedCards(
            currentCacheKeyRef.current,
            updatedCards,
            cachedEntry.currentCardIndex,
            cachedEntry.removedCardIds,
            cachedEntry.mode,
            cachedEntry.location
          );
        }
      }
    },
    [cardsCache]
  );

  // ── Error Computation ───────────────────────────────────────────────────
  // Solo mode: detect when deck has genuinely loaded 0 cards (not just loading)
  const deckEmpty = (isSoloMode || isCollaborationMode) && isDeckBatchLoaded && deckCards.length === 0
    && !isDeckFetching && !isDeckLoading;

  const error = deckEmpty
    ? "no_matches"
    : locationError
      ? "Failed to load location"
      : null;

  // Once the initial fetch completed for the current mode, background refetches
  // (location re-resolution, coordinate drift) must NOT re-show the loader.
  // hasCompletedFetchForCurrentMode is the sole authority — it is reset only on
  // explicit mode transitions (line 688), not on background query key changes.
  const hasCompletedInitialFetch =
    !isModeTransitioning &&
    !isWaitingForSessionResolution &&
    hasCompletedFetchForCurrentMode;

  const refreshRecommendations = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["deck-cards"] });
    queryClient.invalidateQueries({ queryKey: ["session-deck"] });
    queryClient.invalidateQueries({ queryKey: ["userLocation"] });
    queryClient.invalidateQueries({ queryKey: ["userPreferences"] });
  }, [queryClient]);

  const clearRecommendations = useCallback(() => {
    setRecommendations(EMPTY_CARDS);
    queryClient.removeQueries({ queryKey: ["deck-cards"] });
    queryClient.removeQueries({ queryKey: ["session-deck"] });
  }, [queryClient]);

  // ── Collab params change detector ─────────────────────────────────────
  const prevCollabParamsRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isCollaborationMode || !collabDeckParams) return;
    const paramsKey = JSON.stringify(collabDeckParams);
    if (prevCollabParamsRef.current !== null && prevCollabParamsRef.current !== paramsKey) {
      // Collab params changed (preference update) — invalidate session deck
      queryClient.invalidateQueries({ queryKey: ['session-deck'] });
      setBatchSeed(0);
    }
    prevCollabParamsRef.current = paramsKey;
  }, [isCollaborationMode, collabDeckParams, queryClient]);

  // ── Computed UI State Machine ────────────────────────────────────────────
  // Single source of truth for what the UI should render. Derived from existing
  // booleans — additive and non-breaking. SwipeableCards switches on this.
  const deckUIState: DeckUIState = useMemo(() => {
    // ERROR takes highest priority
    if (locationError) {
      return { type: 'ERROR', message: 'Failed to load location' };
    }

    // DECK FETCH ERROR — only when no cards exist (don't overwrite visible cards
    // with an error for a background refetch failure)
    if (soloDeckError && recommendations.length === 0 && hasCompletedFetchForCurrentMode) {
      return { type: 'ERROR', message: 'Something went wrong loading experiences' };
    }

    // MODE_TRANSITIONING
    if (isModeTransitioning || isWaitingForSessionResolution) {
      return { type: 'MODE_TRANSITIONING' };
    }

    // INITIAL_LOADING (first load or pref change — no cards yet)
    if (!hasCompletedFetchForCurrentMode && recommendations.length === 0) {
      return { type: 'INITIAL_LOADING' };
    }

    // EXHAUSTED (server returned hasMore: false AND user has swiped through all accumulated cards)
    if (isExhausted && recommendations.length === 0) {
      return { type: 'EXHAUSTED' };
    }

    // EMPTY (server returned 0 cards for location/prefs)
    // When hasCompletedFetchForCurrentMode is true, we trust the completion signal
    // regardless of background loading state. Previously required !loading which
    // caused infinite spinners when background refetches kept loading=true after
    // the fetch cycle had genuinely completed.
    if (
      hasCompletedFetchForCurrentMode &&
      recommendations.length === 0 &&
      !isModeTransitioning
    ) {
      return { type: 'EMPTY' };
    }

    // LOADED (default: cards are available)
    if (recommendations.length > 0) {
      return { type: 'LOADED', cards: recommendations };
    }

    // Fallback: genuinely still loading (between batch seed change and query key
    // update, or first load before any data arrives). This ONLY fires when
    // hasCompletedFetchForCurrentMode is false AND recommendations are empty —
    // once the fetch cycle completes, the EMPTY branch above catches it.
    return { type: 'INITIAL_LOADING' };
  }, [
    locationError, soloDeckError, isModeTransitioning, isWaitingForSessionResolution,
    hasCompletedFetchForCurrentMode, recommendations,
    isExhausted,
    // NOTE: `loading` intentionally removed — the EMPTY check no longer depends on it.
    // Keeping it here caused unnecessary recomputation on every background refetch.
  ]);

  // __DEV__ assertion: log deckUIState transitions for debugging
  if (__DEV__) {
    const stateMachineShowsLoader =
      deckUIState.type === 'INITIAL_LOADING' || deckUIState.type === 'MODE_TRANSITIONING';

    // Warn if we're stuck in a loading state with the completion flag already set —
    // this would indicate a regression in the state machine logic.
    if (stateMachineShowsLoader && hasCompletedFetchForCurrentMode && !isModeTransitioning && !isWaitingForSessionResolution) {
      console.warn(
        `[RecommendationsContext] Unexpected loader after completion: ` +
        `deckUIState=${deckUIState.type}, loading=${loading}, recs=${recommendations.length}`
      );
    }
  }

  // ── Context Value ───────────────────────────────────────────────────────
  const value: RecommendationsContextType = {
    recommendations,
    loading,
    isFetching,
    error,
    userLocation,
    isModeTransitioning,
    isWaitingForSessionResolution,
    isRefreshingAfterPrefChange,
    hasCompletedInitialFetch,
    refreshRecommendations,
    clearRecommendations,
    updateCardStrollData,
    handleDeckCardProgress,
    hasMoreCards,
    dismissedCards,
    addDismissedCard,
    clearDismissedCards,
    removeDismissedCard,
    addCardToFront,
    addSwipedCard,
    sessionSwipedCards,
    isExhausted,
    deckUIState,
    collabTravelMode: isCollaborationMode ? (collabDeckParams?.travelMode ?? null) : null,
  };

  return (
    <RecommendationsContext.Provider value={value}>
      {children}
    </RecommendationsContext.Provider>
  );
};

export const useRecommendations = (): RecommendationsContextType => {
  const context = useContext(RecommendationsContext);
  if (context === undefined) {
    throw new Error(
      "useRecommendations must be used within a RecommendationsProvider"
    );
  }
  return context;
};
