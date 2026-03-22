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
import type { DeckBatch } from "../store/appStore";
import { Recommendation } from "../types/recommendation";
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
  | { type: 'BATCH_LOADING'; previousCards: Recommendation[] }
  | { type: 'BATCH_SLOW'; previousCards: Recommendation[] }
  | { type: 'MODE_TRANSITIONING' }
  | { type: 'EXHAUSTED' }
  | { type: 'EMPTY' }
  | { type: 'ERROR'; message: string };

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
  deckUIState: DeckUIState;
  /** Aggregated travel mode from collaboration session (majority vote). null in solo mode. */
  collabTravelMode: string | null;
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
  const [isBatchTransitioning, setIsBatchTransitioning] = useState(false);
  const [isRefreshingAfterPrefChange, setIsRefreshingAfterPrefChange] = useState(false);
  const [hasMoreCards, setHasMoreCards] = useState(true);
  const [dismissedCards, setDismissedCards] = useState<Recommendation[]>([]);
  const [isExhausted, setIsExhausted] = useState(false);
  const [isSlowBatchLoad, setIsSlowBatchLoad] = useState(false);
  const prefetchFiredRef = useRef(false);
  const previousBatchRef = useRef<Recommendation[]>([]);
  // Session-scoped dedup: tracks all card IDs served in the current session.
  // Cleared on preference change and mode switch. Catches the prefetch race
  // condition where batch 2 starts before batch 1's impressions are committed.
  const sessionServedIdsRef = useRef<Set<string>>(new Set());
  // hasStartedRef: previously used by the 15s nuclear safety timeout (removed).
  // Kept for potential future mount-tracking needs.
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
    priceTiers: userPrefs?.price_tiers ?? ['chill', 'comfy', 'bougie', 'lavish'],
    budgetMin: userPrefs?.budget_min ?? 0,
    budgetMax: userPrefs?.budget_max ?? 1000,
    travelMode: userPrefs?.travel_mode ?? 'walking',
    travelConstraintType: 'time' as const,
    travelConstraintValue: userPrefs?.travel_constraint_value ?? 30,
    datetimePref: userPrefs?.datetime_pref ?? undefined,
    dateOption: userPrefs?.date_option ?? 'now',
    timeSlot: userPrefs?.time_slot ?? null,
    exactTime: userPrefs?.exact_time ?? null,
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

    // 16s = DeckService client timeout (15s) + 1s buffer
    const hardTimer = setTimeout(() => {
      if (isBatchTransitioning) {
        console.warn('[RecommendationsContext] Batch transition timed out after 16s — clearing transition state');
        setIsBatchTransitioning(false);
        setIsSlowBatchLoad(false);
        // Do NOT setIsExhausted(true) here. A slow batch is not an exhausted
        // batch. The query result effect handles actual exhaustion
        // when isDeckBatchLoaded && deckCards.length === 0.
      }
    }, 16000);

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
    // Guard: never mark exhausted during transitions — the empty state is
    // transient (old batch cleared, new batch not yet arrived). Only mark
    // exhausted when ALL transition flags are false, meaning the deck has
    // genuinely settled on 0 cards.
    if (
      deckCards.length === 0 &&
      !deckHasMore &&
      isDeckBatchLoaded &&
      !isDeckFetching &&
      !isBatchTransitioning &&
      !isModeTransitioning &&
      !isRefreshingAfterPrefChange
    ) {
      setIsExhausted(true);
    }
  }, [deckHasMore, deckCards.length, isDeckBatchLoaded, isDeckFetching, isBatchTransitioning, isModeTransitioning, isRefreshingAfterPrefChange]);

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
      lastSyncedBatchIndexRef.current = -1;
      // HF-003 fix: clear dismissed cards from AsyncStorage on preference change
      if (user?.id) {
        AsyncStorage.removeItem(`dismissed_cards_${user.id}_${currentMode}`).catch(() => {});
      }
      setIsSlowBatchLoad(false);
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
  // Track the last index we synced to prevent re-fires when deckBatches
  // array reference changes but the target batch hasn't actually changed.
  const lastSyncedBatchIndexRef = useRef(-1);

  useEffect(() => {
    if (
      currentDeckBatchIndex >= 0 &&
      currentDeckBatchIndex < deckBatches.length
    ) {
      const batch = deckBatches[currentDeckBatchIndex];
      // Only sync if the index actually changed AND the batchSeed differs.
      // Without the index guard, every deckBatches array reference change
      // (e.g. from addDeckBatch) re-fires this effect and bounces batchSeed.
      if (
        batch.batchSeed !== batchSeed &&
        currentDeckBatchIndex !== lastSyncedBatchIndexRef.current
      ) {
        lastSyncedBatchIndexRef.current = currentDeckBatchIndex;
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
        const prefetchExactTime = isSoloMode ? (userPrefs?.exact_time ?? '') : '';
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
            prefetchExactTime,
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
            exactTime: isSoloMode ? (userPrefs?.exact_time ?? null) : null,
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
          // Filter out cards already served in this session (catches prefetch race).
          const dedupedCards = deckCards.filter(c => !sessionServedIdsRef.current.has(c.id));
          for (const c of dedupedCards) sessionServedIdsRef.current.add(c.id);
          if (dedupedCards.length === 0 && deckCards.length > 0) {
            console.warn(`[RecommendationsContext] All ${deckCards.length} cards in batch already served this session — showing anyway to avoid empty deck`);
          }
          setRecommendations(dedupedCards.length > 0 ? dedupedCards : deckCards);
        }

        if (isDeckBatchLoaded && (isBatchTransitioning || isSlowBatchLoad)) {
          setIsBatchTransitioning(false);
          setIsSlowBatchLoad(false);
        }

        // If we timed out but batch arrived late, un-exhaust
        if (isDeckBatchLoaded && isExhausted && deckCards.length > 0) {
          setIsExhausted(false);
        }
      // IMMEDIATE EXHAUSTION DETECTION (Block 6 — hardened 2026-03-22)
      // When server returns 0 cards during batch transition, clear immediately
      // instead of waiting for 16s timeout. Timer kept as safety net.
      } else if (
        deckCards.length === 0 &&
        isDeckBatchLoaded &&
        !isDeckFetching &&
        (isBatchTransitioning || isSlowBatchLoad)
      ) {
        setIsBatchTransitioning(false);
        setIsSlowBatchLoad(false);
        // Note: setIsExhausted is NOT called here. The exhaustion effect
        // will fire on the next render cycle now that isBatchTransitioning
        // is false, and it checks deckHasMore too.
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
      setIsSlowBatchLoad(false);
      setDismissedCards([]);
      warmPoolFired.current = false;
      sessionServedIdsRef.current.clear();

      // Clear deck history — each mode builds its own rounds
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

    // BATCH_SLOW (soft timer fired, batch still in flight)
    if (isSlowBatchLoad && !isExhausted) {
      return { type: 'BATCH_SLOW', previousCards: recommendations };
    }

    // BATCH_LOADING (transition in progress, not yet slow)
    if (isBatchTransitioning) {
      return { type: 'BATCH_LOADING', previousCards: recommendations };
    }

    // EXHAUSTED (all batches viewed, 0 cards remain)
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
      !isModeTransitioning &&
      !isBatchTransitioning
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
    hasCompletedFetchForCurrentMode, recommendations, isSlowBatchLoad,
    isExhausted, isBatchTransitioning,
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
