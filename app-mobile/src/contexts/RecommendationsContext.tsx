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
import { deckService } from "../services/deckService";
import { computePrefsHash } from "../utils/cardConverters";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "../store/appStore";
import type { DeckBatch } from "../store/appStore";
import { Recommendation } from "../types/recommendation";
import { aggregateAllPrefs } from '../utils/sessionPrefsUtils';
import { useSessionDeck } from '../hooks/useSessionDeck';
import { fetchSessionDeck } from '../services/sessionDeckService';

// Re-export so all existing consumer imports keep working
export type { Recommendation };

const MAX_BATCHES = 3;

// Stable empty arrays — prevent new references on every render that trigger
// useEffect dependency changes and cause infinite render loops.
const EMPTY_CARDS: Recommendation[] = [];
const EMPTY_PILLS: string[] = [];

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
  resumeCount?: number;
}

export const RecommendationsProvider: React.FC<
  RecommendationsProviderProps
> = ({
  children,
  currentMode: propCurrentMode = "solo",
  refreshKey: propRefreshKey,
  resumeCount: propResumeCount = 0,
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
  // hasStartedRef: used by the 15-second nuclear safety timeout (mount-only, never resets)
  const hasStartedRef = useRef(false);
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

  const user = useAppStore((state) => state.user);
  const cardsCache = useCardsCache();
  const {
    currentSession,
    isInSolo,
    availableSessions,
    loading: sessionsLoading,
  } = useSessionManagement();

  // HF-003 fix: Load dismissed cards from AsyncStorage on mount
  useEffect(() => {
    if (!user?.id) return;
    const key = `dismissed_cards_${user.id}`;
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
  }, [user?.id]);

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

      // Stagger warm pool 2s after initial load. The warm pool is fire-and-forget
      // (UI doesn't wait for it), so delaying it costs nothing. But it prevents
      // 4+ concurrent HTTP/2 requests from competing for the same TCP connection
      // on iOS, which causes head-of-line blocking and cascading timeouts.
      const warmDelay = setTimeout(() => {
        const warmStart = Date.now();
        deckService.warmDeckPool({
          location: userLocation,
          categories: userPrefs.categories ?? [],
          intents: userPrefs.intents ?? [],
          priceTiers: userPrefs.price_tiers ?? ['chill', 'comfy', 'bougie', 'lavish'],
          budgetMin: userPrefs.budget_min ?? 0,
          budgetMax: userPrefs.budget_max ?? 1000,
          travelMode: userPrefs.travel_mode ?? 'walking',
          travelConstraintType: 'time' as const,
          travelConstraintValue: userPrefs.travel_constraint_value ?? 30,
          datetimePref: userPrefs.datetime_pref,
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
    // Use actual prefs if available, otherwise apply a sensible fallback deck so the
    // spinner doesn't block forever when preferences fail to load (e.g. network timeout).
    const effectivePrefs = userPrefs ?? {
      categories: ["Nature", "Casual Eats", "Drink"],
    };
    const cats = effectivePrefs.categories ?? [];
    const ints = (userPrefs as UserPreferences | undefined)?.intents ?? [];
    // If still loading (not yet settled), return null to wait.
    // Once preferences query has settled (data or error), always return a valid deck.
    if (cats.length === 0 && ints.length === 0 && isLoadingPreferences) return null;
    return {
      categories: cats.length > 0 ? cats : ["Nature", "Casual Eats", "Drink"],
      intents: ints,
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

  const {
    cards: soloDeckCards,
    deckMode: soloDeckMode,
    activePills: soloActivePills,
    isLoading: isSoloDeckLoading,
    isFetching: isSoloDeckFetching,
    isFullBatchLoaded: isSoloDeckBatchLoaded,
    hasMore: soloDeckHasMore,
  } = useDeckCards({
    location: activeDeckLocation,
    categories: activeDeckParams?.categories ?? [],
    intents: activeDeckParams?.intents ?? [],
    priceTiers: userPrefs?.price_tiers ?? ['chill', 'comfy', 'bougie', 'lavish'],
    budgetMin: userPrefs?.budget_min ?? 0,
    budgetMax: userPrefs?.budget_max ?? 1000,
    travelMode: userPrefs?.travel_mode ?? 'walking',
    travelConstraintType: 'time' as const,
    travelConstraintValue: userPrefs?.travel_constraint_value ?? 30,
    datetimePref: userPrefs?.datetime_pref,
    dateOption: userPrefs?.date_option ?? 'now',
    timeSlot: userPrefs?.time_slot ?? null,
    batchSeed,
    enabled: isSoloMode &&
      !!activeDeckLocation &&
      activeDeckParams !== null &&
      isDeckParamsStable &&
      !isWaitingForSessionResolution,
  });

  // ── Collaboration Deck Hook (server-side synchronized deck) ──────────
  const {
    data: sessionDeckData,
    isLoading: isSessionDeckLoading,
    isFetching: isSessionDeckFetching,
  } = useSessionDeck(
    isCollaborationMode ? resolvedSessionId ?? undefined : undefined,
    batchSeed,
    isCollaborationMode && !!resolvedSessionId && !isWaitingForSessionResolution
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

  // ── Generate Next Batch ─────────────────────────────────────────────────
  // Capped at MAX_BATCHES. Once all batches are loaded, rotate back to batch 0.
  const generateNextBatch = useCallback(() => {
    const nextSeed = batchSeed + 1;

    // If we've hit the cap, rotate to the first batch instead of fetching more
    if (nextSeed >= MAX_BATCHES) {
      if (deckBatches.length > 0) {
        setIsExhausted(false);
        navigateToDeckBatch(0);
      }
      return;
    }

    previousBatchRef.current = recommendations;
    setIsBatchTransitioning(true);
    setBatchSeed(nextSeed);
  }, [recommendations, batchSeed, deckBatches, navigateToDeckBatch]);

  // Soft timeout (3s): show "Still loading..." indicator
  // Hard timeout (20s): match DeckService 15s + network buffer. Do NOT mark
  // exhausted on timeout — exhaustion is determined by the query returning 0
  // cards, not by slow network. Premature exhaustion was the #1 bug.
  useEffect(() => {
    if (!isBatchTransitioning) return;

    const softTimer = setTimeout(() => {
      if (isBatchTransitioning) {
        console.log('[RecommendationsContext] Batch transition slow (3s) — showing intermediate state');
        setIsSlowBatchLoad(true);
      }
    }, 3000);

    const hardTimer = setTimeout(() => {
      if (isBatchTransitioning) {
        console.warn('[RecommendationsContext] Batch transition timed out after 20s — clearing transition state');
        setIsBatchTransitioning(false);
        setIsSlowBatchLoad(false);
        // Do NOT setIsExhausted(true) here. A slow batch is not an exhausted
        // batch. The query result effect (line ~629) handles actual exhaustion
        // when isDeckBatchLoaded && deckCards.length === 0.
      }
    }, 20000);

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
    setDismissedCards(prev => {
      const updated = [...prev, card];
      // HF-003 fix: persist to AsyncStorage
      if (user?.id) {
        AsyncStorage.setItem(
          `dismissed_cards_${user.id}`,
          JSON.stringify(updated)
        ).catch(() => {});
      }
      return updated;
    });
  }, [user?.id]);

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
      // HF-003 fix: clear dismissed cards from AsyncStorage on preference change
      if (user?.id) {
        AsyncStorage.removeItem(`dismissed_cards_${user.id}`).catch(() => {});
      }
      setIsSlowBatchLoad(false);
      // Reset warm pool so it re-fires with new preferences
      warmPoolFired.current = false;
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

  // Safety timeout: prevent infinite spinner if deck hangs
  useEffect(() => {
    if (!isRefreshingAfterPrefChange) return;
    const timeout = setTimeout(() => {
      console.warn('[RecommendationsContext] Preference refresh safety timeout — clearing spinner');
      setIsRefreshingAfterPrefChange(false);
    }, 8_000);
    return () => clearTimeout(timeout);
  }, [isRefreshingAfterPrefChange]);

  // Nuclear safety timeout: mount-only 15-second guarantee that the fetch completes.
  // Fires once when the component mounts, regardless of any state change.
  // Handles edge cases where GPS, prefs, and deck all silently hang simultaneously.
  // setHasCompletedFetchForCurrentMode is a useState setter — React guarantees stability.
  useEffect(() => {
    if (hasStartedRef.current) return; // Only run on first mount
    hasStartedRef.current = true;

    const safetyTimer = setTimeout(() => {
      setHasCompletedFetchForCurrentMode(true);
      console.warn('[RecommendationsContext] 15s safety timeout fired — forcing complete');
    }, 15000);

    return () => clearTimeout(safetyTimer);
  }, []); // Empty deps — mount only

  // Resume safety timeout: re-armable 10-second guarantee that the spinner clears
  // after the app resumes from background. Unlike the mount-only nuclear timeout,
  // this fires on EVERY resume event (tracked by resumeCount from useForegroundRefresh).
  //
  // Scenario: app backgrounded before initial load completed, then resumed.
  // The mount-only nuclear timeout already fired. All queries re-start but might
  // hang again. This timeout ensures the spinner clears within 10 seconds of resume.
  const prevResumeCountRef = useRef(propResumeCount);
  useEffect(() => {
    if (propResumeCount === prevResumeCountRef.current) return; // Not a resume event
    prevResumeCountRef.current = propResumeCount;

    // Only arm the timeout if loading is actually true. If the UI is already showing
    // content, no rescue is needed.
    if (!loading) return;

    const resumeTimer = setTimeout(() => {
      if (__DEV__) {
        console.warn('[RecommendationsContext] Resume safety timeout (10s) — forcing complete');
      }
      setHasCompletedFetchForCurrentMode(true);
    }, 10000);

    return () => clearTimeout(resumeTimer);
  }, [propResumeCount, loading]);

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
        // Clear exhaustion when navigating to a batch with cards
        if (isExhausted) {
          setIsExhausted(false);
        }
      }
    }
  }, [currentDeckBatchIndex, deckBatches]);

  // ── Pre-fetch next batch when 8 or fewer cards remain ─────────────────
  const handleDeckCardProgress = useCallback((currentIndex: number, total: number) => {
    if (!activeDeckLocation || !activeDeckParams) return;
    const remainingCards = total - currentIndex - 1;

    // When 8 or fewer cards remain, prefetch next batch (once per batch)
    // Skip prefetch if we've already hit the max batch cap
    if (remainingCards <= 8 && !prefetchFiredRef.current && hasMoreCards && batchSeed + 1 < MAX_BATCHES) {
      prefetchFiredRef.current = true;
      const nextSeed = batchSeed + 1;

      // Collaboration mode: prefetch via server-side session deck
      if (isCollaborationMode && resolvedSessionId) {
        queryClient.prefetchQuery({
          queryKey: ['session-deck', resolvedSessionId, nextSeed],
          queryFn: () => fetchSessionDeck(resolvedSessionId, nextSeed),
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
        const prefetchDatetimePref = isSoloMode ? userPrefs?.datetime_pref : (activeDeckParams.datetimePref ?? undefined);

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
          }),
          staleTime: 5 * 60 * 1000,
        });
      }
    }
  }, [batchSeed, hasMoreCards, activeDeckLocation, activeDeckParams, isSoloMode, isCollaborationMode, resolvedSessionId, userPrefs, queryClient]);

  // ── Sync deck cards to recommendations state (unified for solo + collab) ──
  const previousDeckIdsRef = useRef<string>('');

  useEffect(() => {
    if (isSoloMode || isCollaborationMode) {
      if (deckCards.length > 0) {
        const deckIdsKey = `${batchSeed}:${deckCards.map(c => c.id).sort().join(',')}`;
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
      } else if (deckCards.length === 0 && isDeckBatchLoaded && !isDeckFetching && !isBatchTransitioning && !isSlowBatchLoad && !isModeTransitioning) {
        // Genuinely empty — no cards available. All guards must be false
        // to avoid clearing recommendations while a slow batch is still loading
        // or while a mode transition is settling (new mode's data may not have arrived yet).
        // Use stable EMPTY_CARDS and guard against no-op to prevent infinite re-renders
        // (Object.is([], []) is false — a new [] always triggers a re-render).
        setRecommendations(prev => prev.length === 0 ? prev : EMPTY_CARDS);
      }
      // During batch transition with 0 cards from new query,
      // keep previous recommendations visible (no else branch needed)
    }
  }, [deckCards, isDeckBatchLoaded, isDeckFetching, isBatchTransitioning, isSlowBatchLoad, isExhausted, isSoloMode, isCollaborationMode, batchSeed, isModeTransitioning]);

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

      setIsModeTransitioning(true);
      setHasCompletedFetchForCurrentMode(false);
      previousDeckIdsRef.current = '';

      // Don't wipe recommendations here — let the sync effect (line ~683)
      // replace them when the target mode's deck data arrives. If the data
      // is cached (e.g. session deck with 30min staleTime), the sync effect
      // populates recommendations in the same React batch, so the user never
      // sees a loader flash. Only clear if genuinely switching away from
      // existing data that shouldn't persist (handled by the sync effect
      // naturally producing new data or EMPTY_CARDS).

      completionTimeoutRef.current = setTimeout(() => {
        console.warn("Recommendations fetch timeout - forcing completion");
        setHasCompletedFetchForCurrentMode(true);
        setIsModeTransitioning(false);
      }, 5000);

      // No query invalidation on mode switch. Each mode's queries have their
      // own cache lifecycle (staleTime 30min). The query keys include all
      // preference params, so stale prefs = different key = automatic refetch.
      // Invalidating here races with the query re-enabling (causes duplicate
      // fetches: enable triggers fetch #1, invalidation cancels + triggers #2).
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

    if (hasCompletedFetchForCurrentMode && completionTimeoutRef.current) {
      clearTimeout(completionTimeoutRef.current);
      completionTimeoutRef.current = null;
    }

    if (isModeTransitioning || !hasCompletedFetchForCurrentMode) {
      const queryFinished = isDeckBatchLoaded;
      const hasQueryResult = deckCards.length > 0 || isDeckBatchLoaded;
      const hasRecommendationsInState = recommendations.length > 0;

      const shouldMarkComplete =
        (queryEnabled && queryFinished && hasQueryResult) ||
        (hasRecommendationsInState && !isModeTransitioning && !loading) ||
        (locationError && queryFinished) ||
        // Settled state: all three loading flags are false regardless of data/null.
        // This fires when location resolves to null (no error, no data) — without it
        // the spinner runs forever in that case.
        (!isLoadingLocation && !isLoadingPreferences && !isDeckLoading);

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
