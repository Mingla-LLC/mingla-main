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
import { useAuthSimple } from "../hooks/useAuthSimple";
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
import { aggregateNonRotatingPrefs } from '../utils/sessionPrefsUtils';
import { rotateToNext, getRotationLabel, initializeRotationOrder } from '../utils/sessionRotation';

// Re-export so all existing consumer imports keep working
export type { Recommendation };

const MAX_BATCHES = 3;

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
  activeRotationOwner: string | null;
  rotationOrder: string[];
  handleRotateNext: () => Promise<void>;
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
  const [activeRotationOwner, setActiveRotationOwner] = useState<string | null>(null);
  const [rotationOrder, setRotationOrder] = useState<string[]>([]);
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

  // Read rotation + all participants' prefs from board session
  const allParticipantPrefs = boardSessionResult?.allParticipantPreferences ?? null;
  const boardSession = boardSessionResult?.session;

  // ── Collaboration mode flag (must be declared before rotation effects) ──
  const isCollaborationMode: boolean = Boolean(
    currentMode !== "solo" && resolvedSessionId
  );
  const isSoloMode = currentMode === "solo";

  // Sync rotation state from session
  useEffect(() => {
    if (boardSession?.active_preference_owner_id) {
      setActiveRotationOwner(boardSession.active_preference_owner_id);
    }
    if (boardSession?.rotation_order?.length && boardSession.rotation_order.length > 0) {
      setRotationOrder(boardSession.rotation_order);
    }
  }, [boardSession?.active_preference_owner_id, boardSession?.rotation_order]);

  // Initialize rotation order when session exists but rotation not yet set up
  const rotationInitializedRef = useRef(false);
  useEffect(() => {
    if (
      !isCollaborationMode ||
      !boardSession?.id ||
      !boardSession?.created_by ||
      !boardSession?.participants?.length ||
      rotationInitializedRef.current ||
      (boardSession.rotation_order && boardSession.rotation_order.length > 0)
    ) {
      return;
    }
    // Only initialize if at least one participant has preferences
    if (!allParticipantPrefs || allParticipantPrefs.length === 0) return;

    rotationInitializedRef.current = true;
    initializeRotationOrder(
      boardSession.id,
      boardSession.created_by,
      boardSession.participants.map((p: any) => ({
        user_id: p.user_id,
        joined_at: p.joined_at || p.created_at,
      }))
    ).then((order) => {
      setRotationOrder(order);
      setActiveRotationOwner(order[0]);
    }).catch((err) => {
      console.warn('[RecommendationsContext] Rotation init failed:', err);
      rotationInitializedRef.current = false;
    });
  }, [isCollaborationMode, boardSession, allParticipantPrefs]);

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

  // ── Unified Deck Pool Warming ───────────────────────────────────────────
  useEffect(() => {
    if (userLocation && userPrefs && !warmPoolFired.current) {
      warmPoolFired.current = true;
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
    }
  }, [userLocation, userPrefs]);

  // ── Stabilize deck params — only compute once categories OR intents are available
  const stableDeckParams = useMemo(() => {
    const cats = userPrefs?.categories ?? [];
    const ints = userPrefs?.intents ?? [];
    if (cats.length === 0 && ints.length === 0) return null; // not ready
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

  // ── Collaboration deck params (rotation-aware) ────────────────────────
  const collabDeckParams = useMemo(() => {
    if (!isCollaborationMode || !allParticipantPrefs || allParticipantPrefs.length === 0) {
      return null;
    }

    // Categories and intents come from the ACTIVE rotation owner only
    const activeOwnerPrefs = allParticipantPrefs.find(
      (p) => p.user_id === activeRotationOwner
    );
    if (!activeOwnerPrefs) return null;

    const categories = activeOwnerPrefs.categories ?? [];
    const intents = activeOwnerPrefs.intents ?? [];
    if (categories.length === 0 && intents.length === 0) return null;

    // Non-rotating prefs aggregated across all participants
    const aggregated = aggregateNonRotatingPrefs(allParticipantPrefs);

    return {
      categories,
      intents,
      priceTiers: aggregated.priceTiers,
      budgetMin: aggregated.budgetMin,
      budgetMax: aggregated.budgetMax,
      travelMode: aggregated.travelMode,
      travelConstraintType: aggregated.travelConstraintType,
      travelConstraintValue: aggregated.travelConstraintValue,
      datetimePref: aggregated.datetimePref,
      location: aggregated.location,
    };
  }, [
    isCollaborationMode,
    allParticipantPrefs,
    activeRotationOwner,
  ]);

  // ── Unified Deck Hook (replaces all independent hooks) ────────────────
  const activeDeckParams = isSoloMode ? stableDeckParams : collabDeckParams;
  const activeDeckLocation = isSoloMode
    ? userLocation
    : (collabDeckParams?.location ?? userLocation);

  const {
    cards: deckCards,
    deckMode,
    activePills,
    isLoading: isDeckLoading,
    isFetching: isDeckFetching,
    isFullBatchLoaded: isDeckBatchLoaded,
    hasMore: deckHasMore,
  } = useDeckCards({
    location: activeDeckLocation,
    categories: activeDeckParams?.categories ?? [],
    intents: activeDeckParams?.intents ?? [],
    priceTiers: isSoloMode
      ? (userPrefs?.price_tiers ?? ['chill', 'comfy', 'bougie', 'lavish'])
      : (activeDeckParams?.priceTiers ?? ['chill', 'comfy', 'bougie', 'lavish']),
    budgetMin: isSoloMode ? (userPrefs?.budget_min ?? 0) : (activeDeckParams?.budgetMin ?? 0),
    budgetMax: isSoloMode ? (userPrefs?.budget_max ?? 1000) : (activeDeckParams?.budgetMax ?? 1000),
    travelMode: isSoloMode
      ? (userPrefs?.travel_mode ?? 'walking')
      : (activeDeckParams?.travelMode ?? 'walking'),
    travelConstraintType: 'time' as const,
    travelConstraintValue: isSoloMode
      ? (userPrefs?.travel_constraint_value ?? 30)
      : (activeDeckParams?.travelConstraintValue ?? 30),
    datetimePref: isSoloMode ? userPrefs?.datetime_pref : activeDeckParams?.datetimePref ?? undefined,
    dateOption: isSoloMode ? (userPrefs?.date_option ?? 'now') : 'now',
    timeSlot: isSoloMode ? (userPrefs?.time_slot ?? null) : null,
    batchSeed,
    enabled: (isSoloMode || isCollaborationMode) &&
      !!activeDeckLocation &&
      activeDeckParams !== null &&
      !isWaitingForSessionResolution,
  });

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

      queryClient.prefetchQuery({
        queryKey: [
          'deck-cards',
          activeDeckLocation.lat, activeDeckLocation.lng,
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
  }, [batchSeed, hasMoreCards, activeDeckLocation, activeDeckParams, isSoloMode, userPrefs, queryClient]);

  // ── Sync deck cards to recommendations state (unified for solo + collab) ──
  const previousDeckIdsRef = useRef<string>('');

  useEffect(() => {
    if (isSoloMode || isCollaborationMode) {
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
      } else if (deckCards.length === 0 && isDeckBatchLoaded && !isDeckFetching && !isBatchTransitioning && !isSlowBatchLoad) {
        // Genuinely empty — no cards available. All guards must be false
        // to avoid clearing recommendations while a slow batch is still loading.
        setRecommendations([]);
      }
      // During batch transition with 0 cards from new query,
      // keep previous recommendations visible (no else branch needed)
    }
  }, [deckCards, isDeckBatchLoaded, isDeckFetching, isBatchTransitioning, isSlowBatchLoad, isExhausted, isSoloMode, isCollaborationMode, batchSeed]);

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
      previousDeckIdsRef.current = '';

      completionTimeoutRef.current = setTimeout(() => {
        console.warn("Recommendations fetch timeout - forcing completion");
        setHasCompletedFetchForCurrentMode(true);
        setIsModeTransitioning(false);
      }, 5000);

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
        (locationError && queryFinished);

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
    recommendations.length,
    userLocation,
    isWaitingForSessionResolution,
    currentMode,
    loading,
    locationError,
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

  const hasCompletedInitialFetch =
    !isModeTransitioning &&
    !isWaitingForSessionResolution &&
    hasCompletedFetchForCurrentMode &&
    !isDeckLoading;

  const refreshRecommendations = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["deck-cards"] });
    queryClient.invalidateQueries({ queryKey: ["userLocation"] });
    queryClient.invalidateQueries({ queryKey: ["userPreferences"] });
  }, [queryClient]);

  const clearRecommendations = useCallback(() => {
    setRecommendations([]);
    queryClient.removeQueries({ queryKey: ["deck-cards"] });
  }, [queryClient]);

  // ── Rotation handler ──────────────────────────────────────────────────
  const handleRotateNext = useCallback(async () => {
    if (!resolvedSessionId || !allParticipantPrefs) return;

    const withPrefs = new Set(
      allParticipantPrefs
        .filter((p) => (p.categories?.length ?? 0) > 0 || (p.intents?.length ?? 0) > 0)
        .map((p) => p.user_id!)
    );

    const nextOwner = await rotateToNext(
      resolvedSessionId,
      activeRotationOwner,
      rotationOrder,
      withPrefs
    );

    if (nextOwner && nextOwner !== activeRotationOwner) {
      setActiveRotationOwner(nextOwner);
      setBatchSeed(0);
    }
  }, [resolvedSessionId, activeRotationOwner, rotationOrder, allParticipantPrefs]);

  // ── Collab params change detector ─────────────────────────────────────
  const prevCollabParamsRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isCollaborationMode || !collabDeckParams) return;
    const paramsKey = JSON.stringify(collabDeckParams);
    if (prevCollabParamsRef.current !== null && prevCollabParamsRef.current !== paramsKey) {
      // Collab params changed (preference update or rotation) — invalidate deck
      queryClient.invalidateQueries({ queryKey: ['deck-cards'] });
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
    activeRotationOwner,
    rotationOrder,
    handleRotateNext,
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
