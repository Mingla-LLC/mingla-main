import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
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

  // ── Unified Deck Hook (replaces 7 independent hooks) ────────────────────
  const {
    cards: deckCards,
    deckMode,
    activePills,
    isLoading: isDeckLoading,
    isFetching: isDeckFetching,
    isFullBatchLoaded: isDeckBatchLoaded,
  } = useDeckCards({
    location: userLocation,
    categories: userPrefs?.categories ?? [],
    intents: userPrefs?.intents ?? [],
    budgetMin: userPrefs?.budget_min ?? 0,
    budgetMax: userPrefs?.budget_max ?? 1000,
    travelMode: userPrefs?.travel_mode ?? 'walking',
    travelConstraintType: (userPrefs?.travel_constraint_type as 'time' | 'distance') ?? 'time',
    travelConstraintValue: userPrefs?.travel_constraint_value ?? 30,
    datetimePref: userPrefs?.datetime_pref,
    dateOption: userPrefs?.date_option ?? 'now',
    timeSlot: userPrefs?.time_slot ?? null,
    batchSeed,
    enabled: isSoloMode && !!userLocation && !!userPrefs?.categories?.length && !isWaitingForSessionResolution,
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

  // Safety timeout: if isBatchTransitioning stays true for >15s, clear it
  useEffect(() => {
    if (!isBatchTransitioning) return;
    const timeout = setTimeout(() => {
      console.warn('[RecommendationsContext] Batch transition safety timeout — clearing spinner');
      setIsBatchTransitioning(false);
    }, 15_000);
    return () => clearTimeout(timeout);
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

  // ── Refresh Key Handler ─────────────────────────────────────────────────
  // When preferences change (refreshKey increments), reset state and refetch
  useEffect(() => {
    if (previousRefreshKeyRef.current !== undefined && previousRefreshKeyRef.current !== refreshKey) {
      setBatchSeed(0);
      setIsBatchTransitioning(false);
      warmPoolFired.current = false;
      setIsRefreshingAfterPrefChange(true);
      // Invalidate deck-cards so it refetches with fresh params
      queryClient.invalidateQueries({ queryKey: ['deck-cards'] });
      // Also invalidate collaboration fallback queries
      queryClient.invalidateQueries({ queryKey: ['curated-experiences'] });
    }
    previousRefreshKeyRef.current = refreshKey;
  }, [refreshKey, queryClient]);

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

  // ── Pre-fetch next batch at 75% consumption ───────────────────────────
  const handleDeckCardProgress = useCallback((currentIndex: number, total: number) => {
    if (!userLocation || !userPrefs) return;
    if (currentIndex >= Math.floor(total * 0.75) && total > 0) {
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
        staleTime: 30 * 60 * 1000,
      });
    }
  }, [batchSeed, userLocation, userPrefs, queryClient]);

  // ── Sync deck cards to recommendations state ────────────────────────────
  // This replaces the massive 130-line sync effect with a simple one.
  // The deck hook already handles nature/curated routing, conversion, and dedup.
  const previousDeckIdsRef = useRef<string>('');

  useEffect(() => {
    if (isSoloMode) {
      // Solo mode: use unified deck cards
      if (deckCards.length > 0) {
        const deckIdsKey = deckCards.map(c => c.id).sort().join(',');
        if (previousDeckIdsRef.current !== deckIdsKey) {
          previousDeckIdsRef.current = deckIdsKey;
          setRecommendations(deckCards);
        }
        if (isBatchTransitioning && isDeckBatchLoaded) {
          setIsBatchTransitioning(false);
        }
      } else if (!isBatchTransitioning && deckCards.length === 0 && isDeckBatchLoaded && !isDeckFetching) {
        // Genuinely empty — no cards available for these preferences
        if (recommendations.length !== 0) {
          setRecommendations([]);
          previousDeckIdsRef.current = '';
        }
      }
      // During batch transition with 0 cards, keep previous recommendations visible
    }
  }, [deckCards, isDeckBatchLoaded, isDeckFetching, isBatchTransitioning, isSoloMode]);

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
