import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  ExperiencesService,
  UserPreferences,
} from "../services/experiencesService";
import { useAuthSimple } from "../hooks/useAuthSimple";
import { useSessionManagement } from "../hooks/useSessionManagement";
import { useBoardSession } from "../hooks/useBoardSession";
import { useCardsCache } from "./CardsCacheContext";
import { useUserLocation } from "../hooks/useUserLocation";
import { useUserPreferences } from "../hooks/useUserPreferences";
import { useRecommendationsQuery } from "../hooks/useRecommendationsQuery";
import { useCuratedExperiences } from "../hooks/useCuratedExperiences";
import { useDeckCards } from "../hooks/useDeckCards";
import { deckService } from "../services/deckService";
import { computePrefsHash } from "../utils/cardConverters";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "../store/appStore";
import type { DeckBatch } from "../store/appStore";
import { Recommendation } from "../types/recommendation";

// Re-export so all existing consumer imports keep working
export type { Recommendation };

const getDefaultPreferences = (): UserPreferences => ({
  mode: "explore",
  budget_min: 0,
  budget_max: 1000,
  people_count: 1,
  categories: ["Nature", "Casual Eats", "Drink"],
  travel_mode: "walking",
  travel_constraint_type: "time",
  travel_constraint_value: 30,
  datetime_pref: new Date().toISOString(),
});

interface RecommendationsContextType {
  recommendations: Recommendation[];
  loading: boolean;
  isFetching: boolean;
  error: string | null;
  userLocation: { lat: number; lng: number } | null;
  isModeTransitioning: boolean;
  isBatchTransitioning: boolean;
  isWaitingForSessionResolution: boolean;
  isRefreshingAfterPrefChange: boolean;
  hasCompletedInitialFetch: boolean;
  refreshRecommendations: (refreshKey?: number | string) => void;
  clearRecommendations: () => void;
  updateCardStrollData: (
    cardId: string,
    strollData: Recommendation["strollData"]
  ) => void;
  batchSeed: number;
  generateNextBatch: () => void;
  restorePreviousBatch: () => void;
  // Deck card batch history
  deckBatches: DeckBatch[];
  currentDeckBatchIndex: number;
  navigateToDeckBatch: (index: number) => void;
  totalDeckCardsViewed: number;
  handleDeckCardProgress: (currentIndex: number, total: number) => void;
  hasMoreCards: boolean;
  dismissedCards: Recommendation[];
  addDismissedCard: (card: Recommendation) => void;
  clearDismissedCards: () => void;
  removeDismissedCard: (card: Recommendation) => void;
  addCardToFront: (card: Recommendation) => void;
  isExhausted: boolean;
  isSlowBatchLoad: boolean;
}

const RecommendationsContext = createContext<
  RecommendationsContextType | undefined
>(undefined);

interface RecommendationsProviderProps {
  children: React.ReactNode;
  currentMode?: string;
  refreshKey?: number | string;
}

export const RecommendationsProvider: React.FC<
  RecommendationsProviderProps
> = ({
  children,
  currentMode: propCurrentMode = "solo",
  refreshKey: propRefreshKey,
}) => {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [batchSeed, setBatchSeed] = useState(0);
  const [isModeTransitioning, setIsModeTransitioning] = useState(false);
  const [hasCompletedFetchForCurrentMode, setHasCompletedFetchForCurrentMode] =
    useState(false);
  const [isBatchTransitioning, setIsBatchTransitioning] = useState(false);
  const [isRefreshingAfterPrefChange, setIsRefreshingAfterPrefChange] = useState(false);
  const [hasMoreCards, setHasMoreCards] = useState(true);
  const [dismissedCards, setDismissedCards] = useState<Recommendation[]>([]);
  const [isExhausted, setIsExhausted] = useState(false);
  const [isSlowBatchLoad, setIsSlowBatchLoad] = useState(false);
  const prefetchFiredRef = useRef(false);
  const previousBatchRef = useRef<Recommendation[]>([]);
  const currentMode = propCurrentMode;
  const refreshKey = propRefreshKey;
  const previousRefreshKeyRef = useRef(propRefreshKey);
  const currentCacheKeyRef = useRef<string | null>(null);
  const warmPoolFired = useRef(false);
  const queryClient = useQueryClient();

  // ── Deck card batch history (Zustand) ────────────────────────────────
  const {
    addDeckBatch,
    resetDeckHistory,
    deckPrefsHash,
    deckBatches,
    currentDeckBatchIndex,
    navigateToDeckBatch,
  } = useAppStore();

  const { user } = useAuthSimple();
  const cardsCache = useCardsCache();
  const {
    currentSession,
    isInSolo,
    availableSessions,
    loading: sessionsLoading,
  } = useSessionManagement();

  const shouldCheckCache = cardsCache.isCacheLoaded;

  // ── Session Resolution ──────────────────────────────────────────────────
  const resolvedSessionId = React.useMemo(() => {
    if (currentMode === "solo") return null;
    if (currentSession?.id) return currentSession.id;
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(currentMode)) return currentMode;
    const session = availableSessions.find(
      (s) => s.id === currentMode || s.name === currentMode
    );
    return session?.id || null;
  }, [currentMode, currentSession, availableSessions]);

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

  // ── Location & Preferences ──────────────────────────────────────────────
  const {
    data: userLocationData,
    isLoading: isLoadingLocation,
    error: locationError,
  } = useUserLocation(user?.id, currentMode, refreshKey);

  const userLocation: { lat: number; lng: number } | null = userLocationData
    ? { lat: userLocationData.lat, lng: userLocationData.lng }
    : null;

  const { data: userPrefs, isLoading: isLoadingPreferences } =
    useUserPreferences(user?.id);

  // ── Collaboration mode flag ─────────────────────────────────────────────
  const isCollaborationMode: boolean = Boolean(
    currentMode !== "solo" && resolvedSessionId
  );
  const isSoloMode = currentMode === "solo";

  // ── Unified Deck Pool Warming ───────────────────────────────────────────
  useEffect(() => {
    if (userLocation && userPrefs && !warmPoolFired.current) {
      warmPoolFired.current = true;
      const warmStart = Date.now();
      deckService.warmDeckPool({
        location: userLocation,
        categories: userPrefs.categories ?? [],
        intents: userPrefs.intents ?? [],
        budgetMin: userPrefs.budget_min ?? 0,
        budgetMax: userPrefs.budget_max ?? 1000,
        travelMode: userPrefs.travel_mode ?? 'walking',
        travelConstraintType: (userPrefs.travel_constraint_type as 'time' | 'distance') ?? 'time',
        travelConstraintValue: userPrefs.travel_constraint_value ?? 30,
        datetimePref: userPrefs.datetime_pref,
        dateOption: userPrefs.date_option ?? 'now',
        timeSlot: userPrefs.time_slot ?? null,
      }).then(() => {
        if (__DEV__) console.log(`[Deck] Pool warmed in ${Date.now() - warmStart}ms`);
      }).catch(() => {});
    }
  }, [userLocation, userPrefs]);

  // ── Stabilize deck params — only compute once categories AND intents are both available
  const stableDeckParams = useMemo(() => {
    const cats = userPrefs?.categories ?? [];
    const ints = userPrefs?.intents ?? [];
    if (cats.length === 0) return null; // not ready
    return {
      categories: cats,
      intents: ints,
    };
  }, [
    // Use JSON.stringify to prevent array-reference changes from causing recomputation
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(userPrefs?.categories ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(userPrefs?.intents ?? []),
  ]);

  // ── Unified Deck Hook (replaces 7 independent hooks) ────────────────────
  const {
    cards: deckCards,
    deckMode,
    activePills,
    isLoading: isDeckLoading,
    isFetching: isDeckFetching,
    isFullBatchLoaded: isDeckBatchLoaded,
    hasMore: deckHasMore,
  } = useDeckCards({
    location: userLocation,
    categories: stableDeckParams?.categories ?? [],
    intents: stableDeckParams?.intents ?? [],
    budgetMin: userPrefs?.budget_min ?? 0,
    budgetMax: userPrefs?.budget_max ?? 1000,
    travelMode: userPrefs?.travel_mode ?? 'walking',
    travelConstraintType: (userPrefs?.travel_constraint_type as 'time' | 'distance') ?? 'time',
    travelConstraintValue: userPrefs?.travel_constraint_value ?? 30,
    datetimePref: userPrefs?.datetime_pref,
    dateOption: userPrefs?.date_option ?? 'now',
    timeSlot: userPrefs?.time_slot ?? null,
    batchSeed,
    enabled: isSoloMode && !!userLocation && stableDeckParams !== null && !isWaitingForSessionResolution,
  });

  // ── Collaboration Mode: useRecommendationsQuery (fallback) ──────────────
  const {
    data: recommendationsData,
    isLoading: isLoadingRecommendations,
    error: recommendationsError,
    isFetching: isFetchingRecommendations,
  } = useRecommendationsQuery({
    userId: user?.id,
    currentMode,
    userLocation,
    userPreferences: userPrefs,
    resolvedSessionId,
    isBoardSession,
    boardPreferences,
    isCollaborationMode,
    isWaitingForSessionResolution,
    batchSeed,
    enabled: Boolean(
      isCollaborationMode &&
        userLocation &&
        !isWaitingForSessionResolution &&
        !!resolvedSessionId &&
        Boolean(cardsCache.isCacheLoaded)
    ),
  });

  // ── Collaboration Mode: useCuratedExperiences (adventurous default) ─────
  const curatedSessionId = isCollaborationMode ? resolvedSessionId : undefined;
  const { cards: curatedSoloCards, isLoading: isLoadingCuratedSolo } = useCuratedExperiences({
    experienceType: 'adventurous',
    location: userLocation,
    budgetMin: userPrefs?.budget_min ?? 0,
    budgetMax: userPrefs?.budget_max ?? 1000,
    travelMode: userPrefs?.travel_mode ?? 'walking',
    travelConstraintType:
      (userPrefs?.travel_constraint_type as 'time' | 'distance') ?? 'time',
    travelConstraintValue: userPrefs?.travel_constraint_value ?? 30,
    datetimePref: userPrefs?.datetime_pref ?? new Date().toISOString(),
    batchSeed,
    sessionId: curatedSessionId ?? undefined,
    enabled: isCollaborationMode,
  });

  // ── Generate Next Batch ─────────────────────────────────────────────────
  const generateNextBatch = useCallback(() => {
    previousBatchRef.current = recommendations;
    setIsBatchTransitioning(true);
    setBatchSeed(prev => prev + 1);
  }, [recommendations]);

  // Soft timeout (10s): show "Still loading..." intermediate state
  // Hard timeout (30s): mark exhausted only if batch truly never arrived
  useEffect(() => {
    if (!isBatchTransitioning) return;

    const softTimer = setTimeout(() => {
      if (isBatchTransitioning) {
        console.log('[RecommendationsContext] Batch transition slow (10s) — showing intermediate state');
        setIsSlowBatchLoad(true);
      }
    }, 10000);

    const hardTimer = setTimeout(() => {
      if (isBatchTransitioning) {
        console.warn('[RecommendationsContext] Batch transition timed out after 30s — marking exhausted');
        setIsBatchTransitioning(false);
        setIsExhausted(true);
        setIsSlowBatchLoad(false);
      }
    }, 30000);

    return () => {
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
    };
  }, [isBatchTransitioning]);

  // Restore the previous batch (used by "Review Previous Batch")
  const restorePreviousBatch = useCallback(() => {
    if (batchSeed > 0) {
      setIsBatchTransitioning(true);
      setBatchSeed(prev => prev - 1);
    } else if (previousBatchRef.current.length > 0) {
      setRecommendations(previousBatchRef.current);
      setIsBatchTransitioning(false);
    }
  }, [batchSeed]);

  // ── Dismissed card callbacks ─────────────────────────────────────────────
  const addDismissedCard = useCallback((card: Recommendation) => {
    setDismissedCards((prev) => [...prev, card]);
  }, []);

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
    if (deckCards.length === 0 && !deckHasMore && isDeckBatchLoaded && !isDeckFetching) {
      setIsExhausted(true);
    }
  }, [deckHasMore, deckCards.length, isDeckBatchLoaded, isDeckFetching]);

  // Reset prefetchFiredRef when batchSeed changes
  useEffect(() => {
    prefetchFiredRef.current = false;
  }, [batchSeed]);

  // ── Refresh Key Handler ─────────────────────────────────────────────────
  // When preferences change (refreshKey increments), reset state.
  // The query key change from updated categories/intents handles refetching automatically.
  useEffect(() => {
    if (previousRefreshKeyRef.current !== undefined && previousRefreshKeyRef.current !== refreshKey) {
      // Reset batch to 0 — the query key change from new params will
      // naturally trigger a refetch. No need to manually invalidate.
      setBatchSeed(0);
      setIsBatchTransitioning(false);
      setIsExhausted(false);
      setHasMoreCards(true);
      previousBatchRef.current = [];
      setIsRefreshingAfterPrefChange(true);
      setDismissedCards([]);
      // Reset warm pool so it re-fires with new preferences
      warmPoolFired.current = false;
      // DO NOT call queryClient.invalidateQueries — the query key change
      // from updated categories/intents handles refetching automatically
    }
    previousRefreshKeyRef.current = refreshKey;
  }, [refreshKey]);

  // ── Clear isRefreshingAfterPrefChange once deck settles ─────────────────
  useEffect(() => {
    if (!isRefreshingAfterPrefChange) return;
    const allSettled = isDeckBatchLoaded && !isDeckFetching;
    if (allSettled) {
      setIsRefreshingAfterPrefChange(false);
    }
  }, [isRefreshingAfterPrefChange, isDeckBatchLoaded, isDeckFetching]);

  // Safety timeout: prevent infinite spinner if deck hangs
  useEffect(() => {
    if (!isRefreshingAfterPrefChange) return;
    const timeout = setTimeout(() => {
      console.warn('[RecommendationsContext] Preference refresh safety timeout — clearing spinner');
      setIsRefreshingAfterPrefChange(false);
    }, 8_000);
    return () => clearTimeout(timeout);
  }, [isRefreshingAfterPrefChange]);

  // ── Deck batch history: detect pref changes → reset ──────────────────
  useEffect(() => {
    if (!userPrefs) return;
    const newHash = computePrefsHash(userPrefs);
    if (newHash && newHash !== deckPrefsHash) {
      resetDeckHistory(newHash);
    }
  }, [userPrefs, deckPrefsHash, resetDeckHistory]);

  // ── Deck batch history: store arriving batches ───────────────────────
  useEffect(() => {
    if (deckCards.length > 0 && isDeckBatchLoaded) {
      addDeckBatch({
        batchSeed,
        cards: deckCards,
        activePills,
        timestamp: Date.now(),
      });
    }
  }, [deckCards, isDeckBatchLoaded, batchSeed, activePills, addDeckBatch]);

  // ── Deck batch navigation: when navigating to a historical batch ─────
  useEffect(() => {
    if (
      currentDeckBatchIndex >= 0 &&
      currentDeckBatchIndex < deckBatches.length
    ) {
      const batch = deckBatches[currentDeckBatchIndex];
      if (batch.batchSeed !== batchSeed) {
        setBatchSeed(batch.batchSeed);
      }
    }
  }, [currentDeckBatchIndex, deckBatches]);

  // ── Pre-fetch next batch when 5 or fewer cards remain ─────────────────
  const handleDeckCardProgress = useCallback((currentIndex: number, total: number) => {
    if (!userLocation || !userPrefs) return;
    const remainingCards = total - currentIndex - 1;

    // When 5 or fewer cards remain, prefetch next batch (once per batch)
    if (remainingCards <= 5 && !prefetchFiredRef.current && hasMoreCards) {
      prefetchFiredRef.current = true;
      const nextSeed = batchSeed + 1;
      queryClient.prefetchQuery({
        queryKey: [
          'deck-cards',
          userLocation.lat, userLocation.lng,
          (userPrefs.categories ?? []).sort().join(','),
          (userPrefs.intents ?? []).sort().join(','),
          userPrefs.budget_min ?? 0,
          userPrefs.budget_max ?? 1000,
          userPrefs.travel_mode ?? 'walking',
          userPrefs.travel_constraint_type ?? 'time',
          userPrefs.travel_constraint_value ?? 30,
          userPrefs.datetime_pref,
          userPrefs.date_option ?? 'now',
          userPrefs.time_slot ?? '',
          nextSeed,
        ],
        queryFn: () => deckService.fetchDeck({
          location: userLocation,
          categories: userPrefs.categories ?? [],
          intents: userPrefs.intents ?? [],
          budgetMin: userPrefs.budget_min ?? 0,
          budgetMax: userPrefs.budget_max ?? 1000,
          travelMode: userPrefs.travel_mode ?? 'walking',
          travelConstraintType: (userPrefs.travel_constraint_type as 'time' | 'distance') ?? 'time',
          travelConstraintValue: userPrefs.travel_constraint_value ?? 30,
          datetimePref: userPrefs.datetime_pref,
          dateOption: userPrefs.date_option ?? 'now',
          timeSlot: userPrefs.time_slot ?? null,
          batchSeed: nextSeed,
          limit: 20,
        }),
        staleTime: 5 * 60 * 1000,
      });
    }
  }, [batchSeed, hasMoreCards, userLocation, userPrefs, queryClient]);

  // ── Sync deck cards to recommendations state ────────────────────────────
  // This replaces the massive 130-line sync effect with a simple one.
  // The deck hook already handles nature/curated routing, conversion, and dedup.
  const previousDeckIdsRef = useRef<string>('');

  useEffect(() => {
    if (isSoloMode) {
      if (deckCards.length > 0) {
        const deckIdsKey = deckCards.map(c => c.id).sort().join(',');
        if (previousDeckIdsRef.current !== deckIdsKey) {
          previousDeckIdsRef.current = deckIdsKey;
          // ALWAYS replace — never append. Each batch is a fresh set of cards.
          // The SwipeableCards component manages its own removedCards set
          // which resets on batch change via the batchKey mechanism.
          setRecommendations(deckCards);
        }

        if (isDeckBatchLoaded && (isBatchTransitioning || isSlowBatchLoad)) {
          setIsBatchTransitioning(false);
          setIsSlowBatchLoad(false);
        }

        // If we timed out but batch arrived late, un-exhaust
        if (isDeckBatchLoaded && isExhausted && deckCards.length > 0) {
          setIsExhausted(false);
        }
      } else if (deckCards.length === 0 && isDeckBatchLoaded && !isDeckFetching && !isBatchTransitioning) {
        // Genuinely empty — no cards available
        setRecommendations([]);
      }
      // During batch transition with 0 cards from new query,
      // keep previous recommendations visible (no else branch needed)
    }
  }, [deckCards, isDeckBatchLoaded, isDeckFetching, isBatchTransitioning, isSlowBatchLoad, isExhausted, isSoloMode, batchSeed]);

  // ── Collaboration mode sync ─────────────────────────────────────────────
  const previousRecommendationsRef = useRef<Recommendation[] | undefined>(undefined);

  useEffect(() => {
    if (!isCollaborationMode) return;
    if (!recommendationsData && curatedSoloCards.length === 0) return;

    const regularCards = recommendationsData ?? [];
    const prevRecs = previousRecommendationsRef.current;
    const hasChanged =
      !prevRecs ||
      prevRecs.length !== regularCards.length ||
      prevRecs.some((prev, idx) => prev.id !== regularCards[idx]?.id);

    if (!hasChanged) return;
    previousRecommendationsRef.current = regularCards;

    if (regularCards.length > 0) {
      setRecommendations(regularCards);
    }

    // Cache for card state management
    if (userLocation && userPrefs) {
      const generateCacheKey = cardsCache.generateCacheKey;
      const getCachedCards = cardsCache.getCachedCards;
      const setCachedCards = cardsCache.setCachedCards;
      const cacheKey = generateCacheKey(currentMode, userLocation, userPrefs, refreshKey);
      const existingCache = getCachedCards(cacheKey);
      const currentCardIds = new Set(regularCards.map((r: Recommendation) => r.id));
      const cachedCardIds = existingCache
        ? new Set(existingCache.cards.map((c: Recommendation) => c.id))
        : null;

      if (
        existingCache && cachedCardIds &&
        currentCardIds.size === cachedCardIds.size &&
        Array.from(currentCardIds).every((id) => cachedCardIds.has(id))
      ) {
        setCachedCards(cacheKey, regularCards, existingCache.currentCardIndex, existingCache.removedCardIds || [], currentMode, userLocation);
      } else {
        setCachedCards(cacheKey, regularCards, 0, [], currentMode, userLocation);
      }
      currentCacheKeyRef.current = cacheKey;

      if (user?.id && regularCards.length > 0) {
        ExperiencesService.trackInteraction(user.id, regularCards[0].id, "view").catch(() => {});
      }
    }
  }, [
    recommendationsData,
    curatedSoloCards,
    isCollaborationMode,
    userLocation,
    userPrefs,
    currentMode,
    refreshKey,
    user?.id,
    cardsCache,
  ]);

  // ── Mode Transition Handling ────────────────────────────────────────────
  const previousModeRef = useRef<string | undefined>(undefined);
  const completionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const modeChanged =
      previousModeRef.current !== undefined &&
      previousModeRef.current !== currentMode;

    if (modeChanged) {
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
        completionTimeoutRef.current = null;
      }

      setIsModeTransitioning(true);
      setRecommendations([]);
      setHasCompletedFetchForCurrentMode(false);
      previousRecommendationsRef.current = undefined;
      previousDeckIdsRef.current = '';

      completionTimeoutRef.current = setTimeout(() => {
        console.warn("Recommendations fetch timeout - forcing completion");
        setHasCompletedFetchForCurrentMode(true);
        setIsModeTransitioning(false);
      }, 5000);

      queryClient.invalidateQueries({ queryKey: ["recommendations"] });
      queryClient.invalidateQueries({ queryKey: ["deck-cards"] });
      queryClient.invalidateQueries({ queryKey: ["curated-experiences"] });
    }

    previousModeRef.current = currentMode;

    return () => {
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
      }
    };
  }, [currentMode, queryClient]);

  // ── Loading & Fetching States ───────────────────────────────────────────
  const loading = isSoloMode
    ? isLoadingLocation || isLoadingPreferences || isDeckLoading
    : isLoadingLocation || isLoadingPreferences || isLoadingRecommendations || isLoadingCuratedSolo;

  // isFetching covers ALL data pipelines — not just recommendations
  const isFetching = isSoloMode
    ? isDeckFetching || isRefreshingAfterPrefChange
    : isFetchingRecommendations || isRefreshingAfterPrefChange;

  // ── Mark Fetch Complete ─────────────────────────────────────────────────
  useEffect(() => {
    const queryEnabled = isSoloMode
      ? Boolean(userLocation && !isWaitingForSessionResolution)
      : Boolean(
          userLocation &&
          !isWaitingForSessionResolution &&
          !!resolvedSessionId &&
          Boolean(cardsCache.isCacheLoaded)
        );

    if (hasCompletedFetchForCurrentMode && completionTimeoutRef.current) {
      clearTimeout(completionTimeoutRef.current);
      completionTimeoutRef.current = null;
    }

    if (isModeTransitioning || !hasCompletedFetchForCurrentMode) {
      const queryFinished = isSoloMode
        ? isDeckBatchLoaded
        : !isLoadingRecommendations && !isFetchingRecommendations;

      const hasQueryResult = isSoloMode
        ? deckCards.length > 0 || isDeckBatchLoaded
        : recommendationsData !== undefined;

      const hasRecommendationsInState = recommendations.length > 0;

      const shouldMarkComplete =
        (queryEnabled && queryFinished && hasQueryResult) ||
        (hasRecommendationsInState && !isModeTransitioning && !loading) ||
        (!!recommendationsError && queryFinished);

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
    deckCards.length,
    isLoadingRecommendations,
    isFetchingRecommendations,
    recommendationsData,
    recommendationsError,
    recommendations.length,
    userLocation,
    isWaitingForSessionResolution,
    currentMode,
    resolvedSessionId,
    cardsCache.isCacheLoaded,
    sessionsLoading,
    loading,
    isSoloMode,
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
  const deckEmpty = isSoloMode && isDeckBatchLoaded && deckCards.length === 0
    && !isDeckFetching && !isDeckLoading;

  const error = deckEmpty
    ? "no_matches"
    : recommendationsError
      ? (recommendationsError as Error).message === "no_matches"
        ? "no_matches"
        : "Failed to load recommendations"
      : locationError
        ? "Failed to load location"
        : null;

  const hasCompletedInitialFetch =
    !isModeTransitioning &&
    !isWaitingForSessionResolution &&
    hasCompletedFetchForCurrentMode &&
    (isSoloMode ? !isDeckLoading : !isLoadingRecommendations);

  const refreshRecommendations = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["deck-cards"] });
    queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    queryClient.invalidateQueries({ queryKey: ["userLocation"] });
    queryClient.invalidateQueries({ queryKey: ["userPreferences"] });
  }, [queryClient]);

  const clearRecommendations = useCallback(() => {
    setRecommendations([]);
    queryClient.removeQueries({ queryKey: ["deck-cards"] });
    queryClient.removeQueries({ queryKey: ["recommendations"] });
  }, [queryClient]);

  // ── Context Value ───────────────────────────────────────────────────────
  const value: RecommendationsContextType = {
    recommendations,
    loading,
    isFetching,
    error,
    userLocation,
    isModeTransitioning,
    isBatchTransitioning,
    isWaitingForSessionResolution,
    isRefreshingAfterPrefChange,
    hasCompletedInitialFetch,
    refreshRecommendations,
    clearRecommendations,
    updateCardStrollData,
    batchSeed,
    generateNextBatch,
    restorePreviousBatch,
    deckBatches,
    currentDeckBatchIndex,
    navigateToDeckBatch,
    totalDeckCardsViewed: deckBatches.reduce((sum, b) => sum + b.cards.length, 0),
    handleDeckCardProgress,
    hasMoreCards,
    dismissedCards,
    addDismissedCard,
    clearDismissedCards,
    removeDismissedCard,
    addCardToFront,
    isExhausted,
    isSlowBatchLoad,
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
