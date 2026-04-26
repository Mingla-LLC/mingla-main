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
// ORCH-0640 ch09: experiencesService DELETED; UserPreferences canonical home.
import type { UserPreferences } from "../types/preferences";
import { useSessionManagement } from "../hooks/useSessionManagement";
import { useBoardSession } from "../hooks/useBoardSession";
import { supabase } from "../services/supabase";
import { useCardsCache } from "./CardsCacheContext";
import { useUserLocation } from "../hooks/useUserLocation";
import { useUserPreferences } from "../hooks/useUserPreferences";
import { useDeckCards, buildDeckQueryKey } from "../hooks/useDeckCards";
import { cachedLocationSync } from "../hooks/useUserLocation";
import { deckService } from "../services/deckService";
import { computePrefsHash, normalizeDateTime } from "../utils/cardConverters";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "../store/appStore";
import { Recommendation } from "../types/recommendation";
import { aggregateCollabPrefs } from '../utils/sessionPrefsUtils';
import { normalizeCategoryArray } from '../utils/categoryUtils';
// ORCH-0490 Phase 2.3: per-context deck state registry + feature flag.
import { FEATURE_FLAG_PER_CONTEXT_DECK_STATE } from "../config/featureFlags";
import {
  DeckStateRegistry,
  type DeckContext,
  deckContextKey,
} from "./deckStateRegistry";
// ORCH-0446: useSessionDeck and sessionDeckService deleted. Collab uses useDeckCards (same as solo).

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
  | { type: 'ERROR'; message: string }
  | { type: 'WAITING_FOR_PARTICIPANTS' }
  // ORCH-0507.c (2026-04-20): removed dead 'WAITING_FOR_PREFERENCES' union
  // variant + matching SwipeableCards render branch. Was declared + rendered
  // but never returned by any selector. If a future flow legitimately needs
  // "participant prefs loading but participants accepted" as a distinct UI
  // state, re-introduce here with a concrete trigger and render branch.
  | { type: 'EMPTY_POOL' }
  // ORCH-0474: Two new variants for edge-function failures that were previously
  // misclassified as EMPTY. AUTH_REQUIRED fires when the JWT sub is unreadable
  // (platform misconfiguration or token refresh race); PIPELINE_ERROR fires when
  // the server pipeline throws an exception (transient runtime failure). See
  // SPEC_ORCH-0474 §10. Render: retry banner for auth, toast overlay on LOADED
  // or full-screen retry for pipeline error.
  | { type: 'AUTH_REQUIRED' }
  | { type: 'PIPELINE_ERROR'; message: string };

// Stable empty arrays — prevent new references on every render that trigger
// useEffect dependency changes and cause infinite render loops.
const EMPTY_CARDS: Recommendation[] = [];
const EMPTY_PILLS: string[] = [];

const getDefaultPreferences = (): UserPreferences => ({
  mode: "explore",
  people_count: 1,
  categories: ["nature", "drinks_and_music", "icebreakers"],
  travel_mode: "walking",
  travel_constraint_type: "time",
  travel_constraint_value: 30,
  datetime_pref: null,
  use_gps_location: true,
  intent_toggle: true,
  category_toggle: true,
  selected_dates: null,
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
  /** ORCH-0474: true when the last deck fetch failed with pipeline-error AND
   *  stale accumulated cards are still being shown. SwipeableCards overlays a
   *  dismissible retry toast in this state. Self-clears when serverPath becomes
   *  'pipeline' again on the next successful fetch. */
  showPipelineErrorToast: boolean;
  /** ORCH-0474: Which `discover-cards` path produced the last observed result.
   *  Exposed for analytics dimension (Mixpanel server_path) and for UI state
   *  machine routing inside SwipeableCards. Undefined when the hook hasn't
   *  resolved yet (loading, disabled, or pre-first-fetch). */
  serverPath?: import('../services/deckService').DeckServerPath;
  /** ORCH-0490 Phase 2.3: expansion signal. True when the current deck swap
   *  is a same-context pref expansion (not a mode/session switch). Drives
   *  SwipeableCards' decision to preserve swipe state vs reset on deck
   *  replacement. Undefined when flag is off or when no transition is live.
   *  Phase 2.3 default behavior: false on context change, false on non-
   *  superset deck arrival; strict-superset transitions are EXPANSION
   *  regardless of this flag. Phase 2.6 will set true for collab realtime
   *  pref propagation to realize I-COLLAB-LIVE-POSITION-STABLE fully. */
  isDeckExpandingWithinContext?: boolean;
  /** ORCH-0490 Phase 2.3 rework (AH-138): stable reference to the per-context
   *  DeckState registry. SwipeableCards uses this to save/restore
   *  `removedCards` + `currentCardIndex` across mode toggles — closes
   *  SC-2.3-01 which failed user device retest because the DeckState type
   *  had those fields but nothing wrote or read them. Null when flag-off —
   *  consumers must guard. */
  deckStateRegistry?: DeckStateRegistry | null;
  /** ORCH-0490 Phase 2.3 rework (AH-138): the active DeckContext tuple.
   *  SwipeableCards reads this to key its registry lookups on context
   *  change. Undefined under flag-off. */
  activeDeckContext?: DeckContext;
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
  /** Pre-resolved session UUID from AsyncStorage — enables instant session resolution
   *  without waiting for the full loadUserSessions() network round-trip. */
  persistedSessionId?: string | null;
  /** ORCH-0444 INV-DEL-1: Called when the current collab session is detected as
   *  deleted/removed while the user is on the deck. Triggers solo mode switch. */
  onSessionLost?: () => void;
}

export const RecommendationsProvider: React.FC<
  RecommendationsProviderProps
> = ({
  children,
  currentMode: propCurrentMode = "solo",
  refreshKey: propRefreshKey,
  persistedSessionId: propPersistedSessionId = null,
  onSessionLost,
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
  const consecutiveSkipCountRef = useRef(0);
  // Note: `hasStartedRef` removed in ORCH-0490 Phase 2.1 along with the 20s
  // first-mount safety timer (see ORCH-0494 + I-DECK-EMPTY-IS-SERVER-VERDICT).
  // Accumulated cards from all pages (flat array, not per-batch)
  const accumulatedCardsRef = useRef<Recommendation[]>([]);
  // Guard: prevents stale batchSeed from firing a query during pref-change reset.
  // Set to false when reset starts, true after batchSeed has been confirmed 0.
  const [batchSeedReady, setBatchSeedReady] = useState(true);
  const currentMode = propCurrentMode;
  const refreshKey = propRefreshKey;
  const previousRefreshKeyRef = useRef(propRefreshKey);
  const currentCacheKeyRef = useRef<string | null>(null);
  const queryClient = useQueryClient();

  // ── ORCH-0490 Phase 2.3: Per-context deck state registry ──────────────
  // Holds one DeckState per (mode, sessionId) tuple. Mode/session toggle
  // swaps the active-context pointer instead of wiping state. Flag-gated;
  // when off, the legacy single-state path continues unchanged. See
  // `contexts/deckStateRegistry.ts` for the invariant contract.
  const registryRef = useRef<DeckStateRegistry | null>(null);
  if (registryRef.current === null) {
    registryRef.current = new DeckStateRegistry();
  }
  const registry = registryRef.current;

  // Expansion signal — true when the current deck change is a same-context
  // pref expansion (not a mode/session switch). Phase 2.3 sets to false on
  // context change and on non-superset deck arrival; SwipeableCards'
  // strict-superset check handles the EXPANSION case without needing this
  // flag. Phase 2.6 will wire this to true on collab realtime pref
  // propagation. Under flag-off this value is never read by consumers.
  const [isDeckExpandingWithinContext, setIsDeckExpandingWithinContext] =
    useState<boolean>(false);

  // ORCH-0490 Phase 2.3: declared here (hoisted from sync effect) so the
  // context-change detector below can reset it when the active context
  // changes. Previously lived inline beside the sync effect.
  const previousDeckIdsRef = useRef<string>('');

  // ── ORCH-0391: Persisted deck key for instant cold-start render ─────
  // On cold start, loads the last-used deck query key from AsyncStorage.
  // Only set if the persisted location matches current GPS hint (within 3dp
  // rounding = ~110m). Prevents wrong-city cards. See ORCH-0391 precedence report.
  const DECK_LAST_KEY = '@mingla/lastDeckQueryKey';
  const DECK_LAST_LOCATION_KEY = '@mingla/lastDeckLocation';
  const [lastDeckKey, setLastDeckKey] = useState<readonly unknown[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [keyRaw, locRaw] = await Promise.all([
          AsyncStorage.getItem(DECK_LAST_KEY),
          AsyncStorage.getItem(DECK_LAST_LOCATION_KEY),
        ]);
        if (!keyRaw || !locRaw) return;

        const persistedLoc = JSON.parse(locRaw) as { lat: number; lng: number };

        // cachedLocationSync is the module-level GPS hint loaded from AsyncStorage
        // on import. Available before React renders. If not yet populated, skip —
        // we can't verify location, so fall back to normal loading path.
        if (!cachedLocationSync) return;

        const currentRoundedLat = Math.round(cachedLocationSync.lat * 1000) / 1000;
        const currentRoundedLng = Math.round(cachedLocationSync.lng * 1000) / 1000;

        if (persistedLoc.lat === currentRoundedLat && persistedLoc.lng === currentRoundedLng) {
          // User hasn't moved — safe to show cached deck instantly
          setLastDeckKey(JSON.parse(keyRaw));
          if (__DEV__) console.log('[Deck] Cold-start proximity match — using persisted deck key');
        } else {
          if (__DEV__) console.log('[Deck] Cold-start location mismatch — skipping persisted key',
            { persisted: persistedLoc, current: { lat: currentRoundedLat, lng: currentRoundedLng } });
        }
      } catch {}
    })();
  }, []);

  // ── Deck session state (Zustand) ────────────────────────────────────
  const {
    addSwipedCard,
    resetDeckHistory,
    deckPrefsHash,
    sessionSwipedCards,
  } = useAppStore();

  const user = useAppStore((state) => state.user);

  // ── ORCH-0490 Phase 2.3: Logout / user-swap registry clear ──────────
  // Constitutional #6: logout must clear all private state. The registry
  // holds per-context DeckState in memory for the signed-in user; on user
  // change (logout → null, or rare user swap) we wipe all entries. Flag-
  // gated — under flag-off the registry is not populated and this is a
  // cheap no-op.
  const prevUserIdRef = useRef<string | null>(user?.id ?? null);
  useEffect(() => {
    if (!FEATURE_FLAG_PER_CONTEXT_DECK_STATE) return;
    const currentUserId = user?.id ?? null;
    if (prevUserIdRef.current !== currentUserId) {
      registry.clearAll();
      prevUserIdRef.current = currentUserId;
    }
  }, [user?.id, registry]);

  // Persist exhaustion state so "That's a Wrap" survives app restart.
  // Scoped per user+mode. Resets on preference change (refreshKey change).
  const exhaustionKey = `deck_exhausted_${user?.id}_${currentMode}`;
  // ORCH-0443: Guard prevents the AsyncStorage read from overriding a mode-change reset.
  // Set to true during mode transition, cleared after the read effect runs.
  const suppressExhaustionReadRef = useRef(false);
  useEffect(() => {
    if (suppressExhaustionReadRef.current) {
      suppressExhaustionReadRef.current = false;
      return;
    }
    AsyncStorage.getItem(exhaustionKey).then(val => {
      if (val === 'true') setIsExhausted(true);
    }).catch(() => {});
  }, [exhaustionKey]);
  useEffect(() => {
    AsyncStorage.setItem(exhaustionKey, isExhausted ? 'true' : 'false').catch(() => {});
  }, [isExhausted, exhaustionKey]);

  const cardsCache = useCardsCache();
  const {
    currentSession,
    isInSolo,
    availableSessions,
    loading: sessionsLoading,
  } = useSessionManagement();

  // Saved/scheduled cards are NOT excluded from the deck. They reappear
  // on preference refresh with "Saved" / "Scheduled" labels. Immediate
  // removal on save/schedule is handled by removedCards in SwipeableCards.

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

  // ── Collaboration mode flag ──
  const isCollaborationMode: boolean = Boolean(
    currentMode !== "solo" && resolvedSessionId
  );
  const isSoloMode = currentMode === "solo";

  // ── ORCH-0490 Phase 2.3: Current DeckContext ─────────────────────────
  // Derived from mode + resolvedSessionId. Drives registry lookups, query
  // key mode discriminant, and the context-change detection effect below.
  // Collab with no resolved session (still loading) falls back to solo —
  // the useDeckCards hooks gate on `enabled` to avoid fetching in that
  // transitional state.
  const currentContext: DeckContext = useMemo(() => {
    if (currentMode === "solo" || !resolvedSessionId) {
      return { kind: "solo" };
    }
    return { kind: "collab", sessionId: resolvedSessionId };
  }, [currentMode, resolvedSessionId]);
  const currentContextKey = deckContextKey(currentContext);

  // ── ORCH-0490 Phase 2.3: Context-change detector ─────────────────────
  // Swaps the registry's active-context pointer AND saves-then-restores
  // accumulated state across contexts. Flow on toggle:
  //   1. Capture current ref state into the OLD context's DeckState record.
  //   2. Flip the registry's active-context pointer.
  //   3. Read the NEW context's DeckState and restore refs + recommendations.
  //      If the new context has never been visited, the factory returns a
  //      fresh empty DeckState → refs reset + setRecommendations([]) → the
  //      new context's useDeckCards hook fetches.
  //   4. Clear expansion signal — context actually changed, not a same-
  //      context pref expansion. SwipeableCards may reset (or restore from
  //      its own per-mode AsyncStorage under the existing pattern).
  //
  // Flag-off: effect is a full no-op; legacy mode-transition handler wipes
  //   state as before.
  const prevContextKeyRef = useRef<string>(currentContextKey);
  const prevContextRef = useRef<DeckContext>(currentContext);
  useEffect(() => {
    if (!FEATURE_FLAG_PER_CONTEXT_DECK_STATE) return;
    if (prevContextKeyRef.current !== currentContextKey) {
      // 1. Save current ref state into OLD context.
      const oldCtx = prevContextRef.current;
      const oldState = registry.get(oldCtx);
      oldState.accumulatedCards = accumulatedCardsRef.current;
      oldState.servedIds = new Set(sessionServedIdsRef.current);
      oldState.batchSeed = batchSeed;
      oldState.isExhausted = isExhausted;

      // 2. Swap active context.
      registry.setActiveContext(currentContext);

      // 3. Restore new context from registry (lazy-creates empty if first visit).
      const newState = registry.get(currentContext);
      accumulatedCardsRef.current = newState.accumulatedCards;
      sessionServedIdsRef.current = new Set(newState.servedIds);
      // Reset previousDeckIdsRef so the sync effect re-processes deckCards
      // for the new context rather than skipping because the string matches.
      previousDeckIdsRef.current = '';
      setRecommendations(newState.accumulatedCards);

      // 4. Expansion signal off — genuine context change.
      setIsDeckExpandingWithinContext(false);

      prevContextKeyRef.current = currentContextKey;
      prevContextRef.current = currentContext;
    }
  }, [currentContextKey, currentContext, registry, batchSeed, isExhausted]);

  // ORCH-0443: Use isCollaborationMode instead of isInSolo from useSessionManagement.
  // isInSolo is never set to false because switchToCollaborative is not called
  // from the pill-bar select handler. isCollaborationMode derives from currentMode
  // which IS set correctly.
  const isBoardSession = isCollaborationMode;

  const boardSessionResult = useBoardSession(
    isBoardSession ? resolvedSessionId ?? undefined : undefined
  );
  const boardPreferences = boardSessionResult?.preferences || null;

  // Read all participants' prefs from board session
  const allParticipantPrefs = boardSessionResult?.allParticipantPreferences ?? null;

  // ── Location & Preferences ──────────────────────────────────────────────
  const {
    data: userLocationData,
    isLoading: isLoadingLocation,
    error: locationError,
  } = useUserLocation(user?.id, currentMode);

  const userLocation: { lat: number; lng: number } | null = useMemo(
    () => userLocationData
      ? { lat: userLocationData.lat, lng: userLocationData.lng }
      : null,
    [userLocationData?.lat, userLocationData?.lng]
  );

  const { data: userPrefs, isLoading: isLoadingPreferences } =
    useUserPreferences(user?.id);

  // ── Stabilize deck params — only compute once preferences are known or timed out
  const stableDeckParams = useMemo(() => {
    // Defensive normalization: converts any display names to slugs, drops invalids.
    // Prevents corrupted DB data from reaching the deck. See ORCH-0346.
    const rawCats = userPrefs?.categories ?? [];
    const cats = rawCats.length > 0 ? normalizeCategoryArray(rawCats) : [];
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
          : ["nature", "drinks_and_music", "icebreakers"],     // true empty state — sensible default
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

    // ORCH-0446: Corrected aggregation with proper algorithms
    const aggregated = aggregateCollabPrefs(allParticipantPrefs);

    if (aggregated.categories.length === 0 && aggregated.intents.length === 0) return null;

    return {
      categories: aggregated.categories,
      intents: aggregated.intents,
      travelMode: aggregated.travelMode,
      travelConstraintType: aggregated.travelConstraintType,
      travelConstraintValue: aggregated.travelConstraintValue,
      datetimePref: aggregated.datetimePref,
      dateOption: aggregated.dateOption,
      dateWindows: aggregated.dateWindows, // ORCH-0446: for AND date logic
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

  const effectiveTravelMode = isCollaborationMode && collabDeckParams
    ? collabDeckParams.travelMode
    : userPrefs?.travel_mode ?? 'walking';

  const effectiveTravelConstraintValue = isCollaborationMode && collabDeckParams
    ? collabDeckParams.travelConstraintValue
    : userPrefs?.travel_constraint_value ?? 30;

  const effectiveDatetimePref = isCollaborationMode && collabDeckParams
    ? (collabDeckParams.datetimePref ?? undefined)
    : userPrefs?.datetime_pref ?? undefined;

  // dateOption: collab aggregation doesn't compute this (solo-only UI concept).
  // For collab, pass 'today' so the edge function uses datetimePref-based filtering.
  const effectiveDateOption = isCollaborationMode ? 'today' : (userPrefs?.date_option ?? 'today');

  // ── ORCH-0490 Phase 2.3: Parallel deck hooks (flag-on) + legacy hook (flag-off) ──
  //
  // Three hook calls total. Exactly one pair is actively fetching at any time:
  //   - Flag-on + solo mode  → flag-solo active, flag-collab disabled, legacy disabled
  //   - Flag-on + collab     → flag-solo may be cached-alive (registry.has), flag-collab active, legacy disabled
  //   - Flag-off             → legacy active, flag-solo + flag-collab both disabled
  //
  // React Query does not fetch disabled queries; the disabled hook calls are
  // effectively free. The flag-on solo hook is kept `enabled` when the user
  // is in a collab session but has ever visited solo — so the cached solo
  // entry survives toggle-back at zero latency. (`registry.has` check.)
  //
  // Spec §3 Phase 2.3 items 3 + 5. Kill switch: flip FEATURE_FLAG_PER_CONTEXT_DECK_STATE
  // to false → legacy path runs verbatim pre-2.3.

  // Legacy hook — flag-off path. Preserves pre-2.3 unified solo+collab behavior.
  // [TRANSITIONAL] deletable on flag exit condition per featureFlags.ts.
  const legacyDeck = useDeckCards({
    location: activeDeckLocation,
    categories: activeDeckParams?.categories ?? [],
    intents: activeDeckParams?.intents ?? [],
    travelMode: effectiveTravelMode,
    travelConstraintType: 'time' as const,
    travelConstraintValue: effectiveTravelConstraintValue,
    datetimePref: effectiveDatetimePref,
    dateOption: effectiveDateOption,
    batchSeed,
    enabled: !FEATURE_FLAG_PER_CONTEXT_DECK_STATE &&
      (isSoloMode || isCollaborationMode) &&
      !!activeDeckLocation &&
      activeDeckParams !== null &&
      isDeckParamsStable &&
      !isWaitingForSessionResolution &&
      batchSeedReady,
    excludeCardIds: [],
    lastKnownQueryKey: lastDeckKey,
    dateWindows: isCollaborationMode ? (collabDeckParams as any)?.dateWindows : undefined,
    sessionId: isCollaborationMode ? resolvedSessionId ?? undefined : undefined,
    // No `mode` field — legacy key shape.
  });

  // Flag-on SOLO hook. Always enabled when solo is active OR when the
  // registry has a solo entry (means user previously visited solo and we
  // want the cache warm for instant toggle-back).
  const flagSoloDeck = useDeckCards({
    mode: 'solo',
    location: isSoloMode ? userLocation : null,
    categories: isSoloMode ? (stableDeckParams?.categories ?? []) : [],
    intents: isSoloMode ? (stableDeckParams?.intents ?? []) : [],
    travelMode: userPrefs?.travel_mode ?? 'walking',
    travelConstraintType: 'time' as const,
    travelConstraintValue: userPrefs?.travel_constraint_value ?? 30,
    datetimePref: userPrefs?.datetime_pref ?? undefined,
    dateOption: userPrefs?.date_option ?? 'today',
    batchSeed,
    enabled: FEATURE_FLAG_PER_CONTEXT_DECK_STATE &&
      isSoloMode &&
      !!userLocation &&
      stableDeckParams !== null &&
      isDeckParamsStable &&
      batchSeedReady,
    excludeCardIds: [],
    lastKnownQueryKey: isSoloMode ? lastDeckKey : null,
  });

  // Flag-on COLLAB hook. Enabled when we're actively in a collab session
  // with resolved params. One hook instance serves whichever collab session
  // is active — the query key's sessionId discriminant keeps cache entries
  // separate across sessions.
  const flagCollabDeck = useDeckCards({
    mode: 'collab',
    sessionId: resolvedSessionId ?? undefined,
    location: isCollaborationMode
      ? (collabDeckParams?.location ?? userLocation)
      : null,
    categories: isCollaborationMode ? (collabDeckParams?.categories ?? []) : [],
    intents: isCollaborationMode ? (collabDeckParams?.intents ?? []) : [],
    travelMode: collabDeckParams?.travelMode ?? 'walking',
    travelConstraintType: 'time' as const,
    travelConstraintValue: collabDeckParams?.travelConstraintValue ?? 30,
    datetimePref: collabDeckParams?.datetimePref ?? undefined,
    dateOption: 'today',
    batchSeed,
    enabled: FEATURE_FLAG_PER_CONTEXT_DECK_STATE &&
      isCollaborationMode &&
      !!resolvedSessionId &&
      !!collabDeckParams &&
      !isWaitingForSessionResolution &&
      isDeckParamsStable &&
      batchSeedReady,
    excludeCardIds: [],
    dateWindows: (collabDeckParams as any)?.dateWindows,
  });

  // Active-deck selection: one flag branch, one mode branch within the flag-on.
  const activeDeck = FEATURE_FLAG_PER_CONTEXT_DECK_STATE
    ? (isSoloMode ? flagSoloDeck : flagCollabDeck)
    : legacyDeck;

  // Alias to the existing identifier names so downstream consumers (effects,
  // memos, context value) don't need to change. Phase 2.3's scope is
  // architectural plumbing — renaming would multiply the diff with no user
  // benefit. Cleanup commit post-flag-exit will collapse these.
  const soloDeckCards = activeDeck.cards;
  const soloDeckMode = activeDeck.deckMode;
  const soloActivePills = activeDeck.activePills;
  const isSoloDeckLoading = activeDeck.isLoading;
  const isSoloDeckFetching = activeDeck.isFetching;
  const isSoloDeckPlaceholder = activeDeck.isPlaceholderData;
  const isSoloDeckBatchLoaded = activeDeck.isFullBatchLoaded;
  const soloDeckHasMore = activeDeck.hasMore;
  const soloDeckError = activeDeck.error;
  const soloServerPath = activeDeck.serverPath;
  // ORCH-0677 RC-2: when curated-only deck returns 0 cards, this carries the
  // server's verdict so the EMPTY branch can fire instead of stuck-loading.
  // Applies to both solo and collab — both flow through useDeckCards.
  const soloCuratedEmptyReason = activeDeck.curatedEmptyReason;

  // ── ORCH-0391: Persist deck key + location on first successful solo load ──
  // Enables instant cold-start render on next app open (if location matches).
  const deckPersistFiredRef = useRef(false);
  useEffect(() => {
    if (
      soloDeckCards.length > 0 &&
      activeDeckLocation &&
      activeDeckParams &&
      isSoloMode &&
      !deckPersistFiredRef.current
    ) {
      deckPersistFiredRef.current = true;
      // ORCH-0490 Phase 2.3: pass `mode: 'solo'` when flag-on so the persisted
      // key shape matches the hook's key shape. Flag-off omits `mode` to
      // preserve the pre-2.3 legacy shape. If the flag flips between sessions
      // (e.g. OTA rolling the flag to true for prod), the first cold launch
      // post-flip sees a shape mismatch and cold-starts through the fetch
      // path (one-time skeleton). Acceptable for dark-ship rollout.
      const key = buildDeckQueryKey({
        ...(FEATURE_FLAG_PER_CONTEXT_DECK_STATE ? { mode: 'solo' as const } : {}),
        lat: activeDeckLocation.lat,
        lng: activeDeckLocation.lng,
        categories: activeDeckParams.categories,
        intents: activeDeckParams.intents,
        travelMode: effectiveTravelMode,
        travelConstraintType: 'time',
        travelConstraintValue: effectiveTravelConstraintValue,
        datetimePref: effectiveDatetimePref,
        dateOption: effectiveDateOption,
        batchSeed,
        excludeCardIds: [],
      });
      AsyncStorage.setItem(DECK_LAST_KEY, JSON.stringify(key)).catch(() => {});
      AsyncStorage.setItem(DECK_LAST_LOCATION_KEY, JSON.stringify({
        lat: Math.round(activeDeckLocation.lat * 1000) / 1000,
        lng: Math.round(activeDeckLocation.lng * 1000) / 1000,
      })).catch(() => {});
      if (__DEV__) console.log('[Deck] Persisted deck key + location for cold-start cache');
    }
  }, [soloDeckCards.length, activeDeckLocation?.lat, activeDeckLocation?.lng, isSoloMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ORCH-0446: useSessionDeck DELETED. Collab deck now uses useDeckCards (above)
  // with aggregated params from collabDeckParams. Same code path as solo.
  // No server middleman. No session_decks cache. No generate-session-deck edge function.

  // ── ORCH-0446: Unified deck output — both modes use useDeckCards ─────
  // No branching needed. Solo and collab use the same hook with different params.
  const deckCards = soloDeckCards;
  const deckMode = soloDeckMode;
  const activePills = soloActivePills;
  const isDeckLoading = isSoloDeckLoading;
  const isDeckFetching = isSoloDeckFetching;
  // ORCH-0446: Both solo and collab use useDeckCards now. No branching needed.
  const isDeckBatchLoaded = isSoloDeckBatchLoaded;
  const deckHasMore = soloDeckHasMore;
  // ORCH-0451: true when deckCards comes from placeholderData (stale, from a previous
  // query key). Must not be synced to recommendations — would show the user old cards.
  const isDeckPlaceholder = isSoloDeckPlaceholder;

  // batchSeed race guard: re-enable queries once batchSeed has settled to 0
  useEffect(() => {
    if (!batchSeedReady && batchSeed === 0) {
      setBatchSeedReady(true);
    }
  }, [batchSeed, batchSeedReady]);

  // Safety timeout: if batchSeedReady stays false for 3s, force it true.
  // Prevents permanent deck freeze if the reset effect doesn't fire.
  //
  // ORCH-0490 Phase 2.1 audit (OBS-0A-1): this timer does NOT contribute to the
  // ORCH-0494 false-EMPTY race. It unblocks `useDeckCards`'s `enabled` gate —
  // it does NOT set `hasCompletedFetchForCurrentMode` and does NOT set
  // `recommendations=[]`. When it fires, the deck query starts fetching; EMPTY
  // renders only if the server genuinely returns zero cards (real server
  // verdict). Safe to keep as a freeze prevention guard. Kept.
  useEffect(() => {
    if (batchSeedReady) return;
    const timer = setTimeout(() => {
      console.warn('[RecommendationsContext] batchSeedReady safety timeout — forcing true after 3s');
      setBatchSeedReady(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, [batchSeedReady]);

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
    // ORCH-0469 / ORCH-0472: "Exhausted" requires the user to have actually been
    // served cards in this pref session. An empty first page (batchSeed === 0 with
    // no accumulated cards) is EMPTY, not EXHAUSTED. Without this gate, any
    // category that returns zero server results on entry is mislabelled as
    // "You've seen everything available" — a lie.
    const userHasBeenServedCards = batchSeed > 0 || accumulatedCardsRef.current.length > 0;
    if (
      userHasBeenServedCards &&
      deckCards.length === 0 &&
      !deckHasMore &&
      isDeckBatchLoaded &&
      !isDeckFetching &&
      !isModeTransitioning &&
      !isRefreshingAfterPrefChange  // ORCH-0451: guard now effective — flag no longer prematurely cleared
    ) {
      setIsExhausted(true);
    }
  }, [deckHasMore, deckCards.length, isDeckBatchLoaded, isDeckFetching, isModeTransitioning, isRefreshingAfterPrefChange, batchSeed]);

  // Reset prefetchFiredRef when batchSeed changes
  useEffect(() => {
    prefetchFiredRef.current = false;
  }, [batchSeed]);

  // ── Refresh Key Handler ─────────────────────────────────────────────────
  // When preferences change (refreshKey increments), reset state.
  // The query key change from updated categories/intents handles refetching automatically.
  // ORCH-0431 + ORCH-0451: This reset set MUST mirror the mode transition handler (~line 838).
  // Both represent "old deck invalid, new fetch needed." VERIFIED PARITY:
  // - setBatchSeed(0)             ✓ both
  // - setIsExhausted(false)       ✓ both
  // - setHasCompletedFetch(false) ✓ both
  // - setRecommendations(EMPTY)   ✓ pref-change only (mode transition relies on sync)
  // - previousDeckIdsRef = ''     ✓ both (ORCH-0451 fix)
  // - accumulatedCardsRef = []    ✓ both
  // - sessionServedIdsRef.clear() ✓ both
  // - AsyncStorage exhaustion rm  ✓ both
  // If you add a reset to one, ADD IT TO THE OTHER.
  useEffect(() => {
    if (previousRefreshKeyRef.current !== undefined && previousRefreshKeyRef.current !== refreshKey) {
      // Reset page to 0 — the query key change from new params will
      // naturally trigger a refetch. No need to manually invalidate.
      setBatchSeedReady(false); // Block queries until batchSeed is confirmed 0
      setBatchSeed(0);
      setIsExhausted(false);
      setHasCompletedFetchForCurrentMode(false);
      setRecommendations(EMPTY_CARDS);
      setHasMoreCards(true);
      setIsRefreshingAfterPrefChange(true);
      setDismissedCards([]);
      accumulatedCardsRef.current = [];
      // HF-003 fix: clear dismissed cards from AsyncStorage on preference change
      if (user?.id) {
        AsyncStorage.removeItem(`dismissed_cards_${user.id}_${currentMode}`).catch(() => {});
        // ORCH-0451: Clear persisted exhaustion state on preference change.
        // Without this, a cold-start AsyncStorage read of deck_exhausted_* can
        // re-set isExhausted=true AFTER the refresh handler cleared it, causing
        // "You've seen everything" to flash for preferences the user just set.
        AsyncStorage.removeItem(`deck_exhausted_${user.id}_${currentMode}`).catch(() => {});
      }
      sessionServedIdsRef.current.clear();
      consecutiveSkipCountRef.current = 0;
      // ORCH-0451: Reset dedup guard so stale placeholder cards from the old query
      // key don't pass the "new data" check. Mirrors mode transition handler.
      previousDeckIdsRef.current = '';
      // DO NOT call queryClient.invalidateQueries — the query key change
      // from updated categories/intents handles refetching automatically

      // ORCH-0446B: In collab mode, re-read session from DB so this instance's
      // allParticipantPreferences updates with the new prefs. Without this,
      // collabDeckParams stays stale (PreferencesSheet uses a separate useBoardSession).
      if (isCollaborationMode && resolvedSessionId) {
        boardSessionResult.loadSession(resolvedSessionId);
      }
    }
    previousRefreshKeyRef.current = refreshKey;
  }, [refreshKey, user?.id]);

  // ── Clear isRefreshingAfterPrefChange once NEW deck data arrives ─────────
  // ORCH-0444: The old check (isDeckBatchLoaded && !isDeckFetching) could be
  // satisfied by stale React Query cache state before the new fetch completed.
  // This caused premature completion → EXHAUSTED flash → "You've seen everything"
  // while new cards were still loading. Now we wait until cards actually arrive
  // OR batchSeedReady confirms the new query cycle has fully settled.
  useEffect(() => {
    if (!isRefreshingAfterPrefChange) return;
    // ORCH-0451: Don't clear the flag while data is still placeholder.
    // Real data hasn't arrived yet — the skeleton must keep showing.
    if (isDeckPlaceholder) return;
    // New cards have arrived (from real fetch, not placeholder) — safe to clear
    if (recommendations.length > 0) {
      setIsRefreshingAfterPrefChange(false);
      return;
    }
    // No cards, but new fetch cycle has genuinely completed (not stale cache)
    // batchSeedReady gates the new query; once it + isDeckBatchLoaded are both true
    // AND isDeckFetching is false, the new fetch is truly done with 0 results.
    if (batchSeedReady && isDeckBatchLoaded && !isDeckFetching) {
      setIsRefreshingAfterPrefChange(false);
    }
  }, [isRefreshingAfterPrefChange, recommendations.length, batchSeedReady, isDeckBatchLoaded, isDeckFetching, isDeckPlaceholder]);

  // Pref refresh safety timeout REMOVED — state machine handles this:
  // pref change → INITIAL_LOADING → query resolves → LOADED/EMPTY.
  // The settle effect above (isDeckBatchLoaded && !isDeckFetching) clears the flag.

  // ORCH-0490 Phase 2.1 + ORCH-0494: The 20-second first-mount safety timer was
  // REMOVED here. It force-set `hasCompletedFetchForCurrentMode=true` before real
  // cards arrived, producing false EMPTY renders during in-flight preference-change
  // fetches. EMPTY is now server-verdict-only per I-DECK-EMPTY-IS-SERVER-VERDICT —
  // the EMPTY branch in deckUIState requires either (a) serverPath==='pool-empty'
  // or (b) the final paginated batch resolved with zero cards. No timer shortcut.
  // Edge case the old timer protected (GPS never resolves, no device location) is
  // now handled gracefully: deck stays in INITIAL_LOADING indefinitely and the
  // user sees the location permission prompt / location resolution UX flow.

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

      // ORCH-0446/0636: both solo and collab prefetch via deckService under the
      // shared deck-cards query key — useDeckCards consumes the same key for
      // both modes (see flagSoloDeck / flagCollabDeck above). The retired
      // server-side collab deck hook + helper type were deleted in ORCH-0446;
      // this removes the dead collab-specific branch that still referenced them.
      const prefetchCategories = activeDeckParams.categories ?? [];
      const prefetchIntents = activeDeckParams.intents ?? [];
      const prefetchTravelMode = isSoloMode ? (userPrefs?.travel_mode ?? 'walking') : (collabDeckParams?.travelMode ?? 'walking');
      const prefetchConstraintType = 'time' as const;
      const prefetchConstraintValue = isSoloMode ? (userPrefs?.travel_constraint_value ?? 30) : (collabDeckParams?.travelConstraintValue ?? 30);
      const prefetchDateOption = isSoloMode ? (userPrefs?.date_option ?? 'today') : 'today';
      const rawDatetimePref = isSoloMode ? userPrefs?.datetime_pref : (collabDeckParams?.datetimePref ?? undefined);
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
          prefetchTravelMode,
          prefetchConstraintType,
          prefetchConstraintValue,
          prefetchDatetimePref,
          prefetchDateOption,
          nextSeed,
          '', // no exclusions
        ],
        queryFn: () => deckService.fetchDeck({
          location: activeDeckLocation,
          categories: prefetchCategories,
          intents: prefetchIntents,
          travelMode: prefetchTravelMode,
          travelConstraintType: prefetchConstraintType,
          travelConstraintValue: prefetchConstraintValue,
          datetimePref: prefetchDatetimePref,
          dateOption: prefetchDateOption,
          batchSeed: nextSeed,
          limit: 10000,
          excludeCardIds: [],
        }),
        staleTime: 5 * 60 * 1000,
      });
    }
  }, [batchSeed, hasMoreCards, activeDeckLocation, activeDeckParams, isSoloMode, isCollaborationMode, resolvedSessionId, userPrefs, queryClient]);

  // ── Sync deck cards to recommendations state (unified for solo + collab) ──
  // Infinite deck: APPEND new page results to accumulated cards instead of replacing.
  // ORCH-0490 Phase 2.3: previousDeckIdsRef hoisted to top-of-provider so the
  // context-change detector can reset it on context swap.

  useEffect(() => {
    if (isSoloMode || isCollaborationMode) {
      // ORCH-0451: Do NOT sync placeholder (stale) data into recommendations.
      // During a preference change, placeholderData provides old cards from the
      // previous query key. Writing them to recommendations would show the user
      // stale cards and suppress the skeleton. Only sync REAL data.
      if (isDeckPlaceholder) return;

      if (deckCards.length > 0) {
        // [ORCH-0503] Order-preserving canonical key. Same-IDs-different-order
        // must register as a change so the partial→final transition (Phase 2.2
        // progressive delivery) hits the expansion branch and
        // setRecommendations(deckCards) adopts the authoritative interleaved
        // order from fetchDeck's queryFn return. Identical-reference re-writes
        // from React Query still produce the same string (array is traversed
        // in order; IDs are the same; string matches), preserving idempotency
        // for cache refreshes that carry no new information.
        //
        // [ORCH-0503] DO NOT re-introduce .sort() on this key. The sort masks
        // partial→final reorder arrivals (same IDs, different order) as "no
        // change" and prevents setRecommendations from adopting fetchDeck's
        // authoritative interleaved order. Fix verified by T-REM-09 + T-REM-10.
        const deckIdsKey = `${batchSeed}:${deckCards.map(c => c.id).join(',')}`;
        if (previousDeckIdsRef.current !== deckIdsKey) {
          previousDeckIdsRef.current = deckIdsKey;
          // Deduplicate against already-served cards in this session
          const dedupedCards = deckCards.filter(c => !sessionServedIdsRef.current.has(c.id));
          for (const c of dedupedCards) sessionServedIdsRef.current.add(c.id);
          if (dedupedCards.length === 0 && batchSeed > 0 && deckHasMore && isDeckBatchLoaded) {
            // All cards on this page are duplicates, fetch succeeded, server says more exist.
            const consecutiveSkips = consecutiveSkipCountRef.current + 1;
            consecutiveSkipCountRef.current = consecutiveSkips;
            if (consecutiveSkips >= 3) {
              // Circuit breaker: 3 consecutive all-duplicate pages means something is wrong
              console.warn('[deck] Circuit breaker: 3 consecutive duplicate pages, declaring exhausted');
              setIsExhausted(true);
              setHasMoreCards(false);
            } else {
              // Skip to next page. (If deckHasMore is false or fetch errored, stop.)
              setBatchSeed(prev => prev + 1);
              prefetchFiredRef.current = false;
            }
            // Don't overwrite accumulatedCardsRef — keep existing cards visible
          } else if (batchSeed === 0) {
            // First page behavior differs by flag:
            //
            // Flag-on (CF-2.3-8): strict-superset check. If prev was empty OR
            //   new deckCards is a strict superset of accumulated, APPEND via
            //   merge-preserving order — keeps user's position + removedCards
            //   intact across progressive-delivery partial→final transitions
            //   (ORCH-0498) AND across any same-context pref-change expansion
            //   where new cards are a superset of old. If NOT a superset, this
            //   is a fresh-context seed — REPLACE the accumulated cards and
            //   signal `isDeckExpandingWithinContext=false` so SwipeableCards
            //   resets (user conceptually wants a fresh deck).
            //
            // Flag-off: pre-2.3 unconditional replace. [TRANSITIONAL].
            consecutiveSkipCountRef.current = 0;

            if (FEATURE_FLAG_PER_CONTEXT_DECK_STATE) {
              const prev = accumulatedCardsRef.current;
              const newIdSet = new Set(deckCards.map(c => c.id));

              let isStrictSuperset = newIdSet.size >= prev.length;
              if (isStrictSuperset) {
                for (const card of prev) {
                  if (!newIdSet.has(card.id)) {
                    isStrictSuperset = false;
                    break;
                  }
                }
              }

              if (prev.length === 0 || isStrictSuperset) {
                // ORCH-0503 v3 — I-PROGRESSIVE-DELIVERY-INTERLEAVE-AUTHORITATIVE.
                //
                // When React Query's cache holds a non-placeholder `deckCards`
                // whose ID set is a strict superset of our accumulator,
                // `deckCards` is the authoritative view — adopt it verbatim.
                // DO NOT reintroduce a prev-preserving merge fallback here
                // (e.g., `[...prev, ...toAppend]`).
                //
                // Why this matters: React Query + React 18 collapse partial-2
                // setQueryData + queryFn-resolve into a SINGLE observer
                // notification when both happen in the same microtask. The
                // sync effect then sees only two fires (not three): Fire 1
                // with partial-1, Fire 2 with the final interleaved result.
                // Any branch that tries to distinguish "partial still growing"
                // from "final arrived" by cardinality will mis-classify Fire 2
                // as growing and destroy fetchDeck's 1:1 interleave. See:
                //   - outputs/INVESTIGATION_ORCH-0503_GROWING_BRANCH_INTERLEAVE_LOSS.md
                //   - outputs/IMPLEMENTATION_ORCH-0503_MIXED_DECK_FINAL_INTERLEAVE_REPORT.md §4
                //     (AH-139's 3-fire trace that turned out to be 2 fires on device)
                //
                // ORCH-0498 mid-swipe stability is preserved: `removedCards`
                // is an ID-keyed Set (SwipeableCards filters via
                // `removedCards.has(id)`, not position), so any card the user
                // rejected stays filtered even if deckCards reorders.
                // `currentCardIndex` indexes into `availableRecommendations`
                // (post-filter), so a full-array reorder that preserves the
                // filtered set keeps the user pointed at the same card.
                const merged = deckCards;

                if (__DEV__) {
                  // I-PROGRESSIVE-DELIVERY-INTERLEAVE-AUTHORITATIVE runtime
                  // guard. If a future edit reintroduces a prev-preserving
                  // merge, the first few IDs of `merged` will diverge from
                  // `deckCards` on the partial→final transition. Fires loudly
                  // in dev; no-op in prod.
                  if (prev.length > 0 && merged.length >= 4 && deckCards.length >= 4) {
                    for (let i = 0; i < 4; i++) {
                      if (merged[i].id !== deckCards[i].id) {
                        console.error(
                          '[ORCH-0503] Invariant I-PROGRESSIVE-DELIVERY-INTERLEAVE-AUTHORITATIVE violated: ' +
                          'strict-superset transition did not adopt deckCards verbatim',
                          {
                            prevLen: prev.length,
                            newLen: deckCards.length,
                            mergedHead: merged.slice(0, 4).map(c => c.id),
                            deckCardsHead: deckCards.slice(0, 4).map(c => c.id),
                          }
                        );
                        break;
                      }
                    }
                  }
                }

                accumulatedCardsRef.current = merged;
                sessionServedIdsRef.current = new Set(merged.map(c => c.id));
                setRecommendations(merged);
              } else {
                // Fresh-context seed: non-superset means the user's prior cards
                // are NOT all still in the deck. Replace and signal RESET.
                sessionServedIdsRef.current = new Set(deckCards.map(c => c.id));
                accumulatedCardsRef.current = deckCards;
                setRecommendations(deckCards);
                setIsDeckExpandingWithinContext(false);
              }

              // Mirror into registry for context-switch restoration.
              const regState = registry.get(currentContext);
              regState.accumulatedCards = accumulatedCardsRef.current;
              regState.servedIds = new Set(sessionServedIdsRef.current);
              regState.batchSeed = batchSeed;
              regState.isExhausted = isExhausted;
            } else {
              // Legacy (flag-off): unconditional replace on first page.
              // onPartialReady (ORCH-0490 Phase 2.2) may have already added
              // partial IDs to sessionServedIdsRef, which would strip singles
              // from the final interleaved result. Clearing ensures the full
              // interleaved deck is what the user sees. See ORCH-0345.
              sessionServedIdsRef.current = new Set(deckCards.map(c => c.id));
              accumulatedCardsRef.current = deckCards;
              setRecommendations(deckCards);
            }
          } else {
            // Subsequent pages: append new unique cards
            consecutiveSkipCountRef.current = 0;
            accumulatedCardsRef.current = [...accumulatedCardsRef.current, ...dedupedCards];
            setRecommendations(accumulatedCardsRef.current);

            // Flag-on: mirror into registry after append too.
            if (FEATURE_FLAG_PER_CONTEXT_DECK_STATE) {
              const regState = registry.get(currentContext);
              regState.accumulatedCards = accumulatedCardsRef.current;
              regState.servedIds = new Set(sessionServedIdsRef.current);
              regState.batchSeed = batchSeed;
              regState.isExhausted = isExhausted;
            }
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
  }, [deckCards, isDeckBatchLoaded, isDeckFetching, isExhausted, isSoloMode, isCollaborationMode, batchSeed, isModeTransitioning, deckHasMore, isDeckPlaceholder, currentContextKey, registry, currentContext]);

  // ── Mode Transition Handling ────────────────────────────────────────────
  const previousModeRef = useRef<string | undefined>(undefined);
  const completionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const prevMode = previousModeRef.current;
    const modeChanged =
      prevMode !== undefined &&
      prevMode !== currentMode;

    // [ORCH-0505 C-1] hasCompletedFetchForCurrentMode reset must fire outside
    // the FEATURE_FLAG_PER_CONTEXT_DECK_STATE gate. Do NOT move this inside
    // the legacy modeChanged block. Pre-2.3: this was set inside that block
    // below. Phase 2.3's CF-2.3-4 gated the block, silently stopping the
    // reset under flag-on and leaving the flag stuck from the prior mode —
    // which caused the WAITING_FOR_PARTICIPANTS selector branch to misfire
    // on collab entry. Lifted here so it fires regardless of flag state. The
    // legacy modeChanged block below keeps its existing wipe semantics
    // (accumulatedCardsRef, sessionServedIdsRef, etc.) for flag-off rollback
    // parity. Verified by T-REM-03 + T-REM-04.
    if (modeChanged) {
      setHasCompletedFetchForCurrentMode(false);
    }

    // ORCH-0490 Phase 2.3 (CF-2.3-4 + CF-2.3-10): under flag-on, mode change
    // does NOT wipe state. The context-change detector effect swaps the
    // registry's active context pointer; previous context's DeckState is
    // preserved. No setBatchSeed(0), no accumulatedCardsRef clear, no
    // sessionServedIdsRef clear, no invalidateQueries. The previous mode's
    // React Query cache stays alive under its own (mode, sessionId) key and
    // is instantly available on toggle-back. Flag-off preserves the legacy
    // wipe. [TRANSITIONAL] — legacy branch removed at flag exit condition.
    if (modeChanged && !FEATURE_FLAG_PER_CONTEXT_DECK_STATE) {
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
        completionTimeoutRef.current = null;
      }

      // ── Full state reset on mode change ────────────────────────────────
      // ORCH-0446/0636: the prior cache-first check against the retired
      // server-side collab deck cache was removed. useDeckCards' initialData
      // + RQ persistence now handle the cache for BOTH solo and collab modes —
      // returning cached data instantly when the deck-cards key matches.
      // Every mode change starts with a clean slate; the transition spinner
      // is short-lived when the cache is warm.
      setIsModeTransitioning(true);
      setHasCompletedFetchForCurrentMode(false);
      previousDeckIdsRef.current = '';
      setBatchSeed(0);
      prefetchFiredRef.current = false;
      setIsExhausted(false);
      // ORCH-0443: Suppress the next AsyncStorage read so it can't override this reset.
      // Also clear the persisted value for belt-and-suspenders safety.
      suppressExhaustionReadRef.current = true;
      AsyncStorage.removeItem(`deck_exhausted_${user?.id}_${currentMode}`).catch(() => {});
      // ORCH-0444: Mark session-deck cache as stale but don't trigger immediate re-fetch.
      // Using invalidateQueries instead of removeQueries prevents the dual-fetch race (RC-4):
      // removeQueries caused React Query to re-mount and auto-fetch (call #1) while
      // collabDeckParams changing enabled → true triggered call #2. invalidateQueries
      // marks stale and waits for the enabled gate (which includes !!activeDeckLocation).
      // ORCH-0446: session-deck queries no longer exist. Deck uses deck-cards key.
      queryClient.invalidateQueries({ queryKey: ['deck-cards'] });
      setHasMoreCards(true);
      setDismissedCards([]);
      accumulatedCardsRef.current = [];
      sessionServedIdsRef.current.clear();
      consecutiveSkipCountRef.current = 0;

      // Clear deck session state — each mode starts fresh
      const { resetDeckHistory } = useAppStore.getState();
      resetDeckHistory('');

      // No need to wipe persisted dismissed cards — the storage key is
      // mode-specific (`dismissed_cards_${userId}_${mode}`), so each mode's
      // dismissed cards persist independently and don't cross-contaminate.

      // Safety timer: force completion if fetch hangs beyond 5s. Cleared by
      // the ORCH-0446B effect below once collab params resolve, OR by the
      // solo fetch completion path.
      completionTimeoutRef.current = setTimeout(() => {
        console.warn("Recommendations fetch timeout - forcing completion");
        setHasCompletedFetchForCurrentMode(true);
        setIsModeTransitioning(false);
      }, 5000);
    }

    previousModeRef.current = currentMode;

    return () => {
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
      }
    };
  }, [currentMode, queryClient]);

  // ── ORCH-0446B: Clear mode transition once collab params resolve ───────
  // isModeTransitioning blocks isDeckParamsStable's fast path, preventing
  // the collab deck from fetching. The 5s timeout is too slow — clear as
  // soon as collabDeckParams is available (loadSession completed).
  // Guard: boardSessionResult.loading must be false — prevents firing on STALE
  // prefs from a previous session before loadSession has read the current one.
  useEffect(() => {
    if (isCollaborationMode && collabDeckParams && isModeTransitioning && !boardSessionResult.loading) {
      setIsModeTransitioning(false);
      setHasCompletedFetchForCurrentMode(false); // Let it complete naturally
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
        completionTimeoutRef.current = null;
      }
    }
  }, [isCollaborationMode, collabDeckParams, isModeTransitioning]);

  // ── ORCH-0444 INV-DEL-1: Session health monitor ──────────────────────────
  // Detects when the current collab session is deleted by another participant.
  // The session_pills Realtime channel fires loadUserSessions() on participant
  // deletion, which updates availableSessions. This effect detects when the
  // current session disappears and forces a switch to solo.
  //
  // CRITICAL: We must NOT fire during the initial mode transition. When a user
  // taps a session pill, currentMode changes instantly (synchronous) but
  // availableSessions hasn't refreshed yet — the session may not be in the list
  // until loadUserSessions() completes. Without this guard, the monitor
  // ── ORCH-0446 R3.8: Update GPS on each collab session entry ──────────
  useEffect(() => {
    if (!isCollaborationMode || !resolvedSessionId || !userLocation || !user?.id) return;

    // Atomic GPS update via RPC — deep merge preserves all other pref fields
    void Promise.resolve(supabase.rpc('upsert_participant_prefs', {
      p_session_id: resolvedSessionId,
      p_user_id: user.id,
      p_prefs: {
        custom_lat: userLocation.lat,
        custom_lng: userLocation.lng,
      },
    })).catch(() => { /* Non-blocking GPS update */ });
  }, [isCollaborationMode, resolvedSessionId, userLocation?.lat, userLocation?.lng, user?.id]);

  // immediately kicks back to solo, creating an enter→exit→enter loop.
  //
  // The sessionSeenInListRef tracks whether we've EVER seen the current session
  // in availableSessions. We only trigger the "session lost" path after the
  // session was previously present and then disappeared — a true deletion.
  const sessionSeenInListRef = useRef(false);

  // Reset the "seen" flag when the target session changes
  useEffect(() => {
    sessionSeenInListRef.current = false;
  }, [resolvedSessionId]);

  useEffect(() => {
    console.log('[HEALTH_MONITOR] check:', { isCollaborationMode, resolvedSessionId: resolvedSessionId?.slice(0, 8), sessionsLoading, sessionCount: availableSessions.length, seenRef: sessionSeenInListRef.current });
    if (!isCollaborationMode || !resolvedSessionId) return;
    if (sessionsLoading) { console.log('[HEALTH_MONITOR] skipping — sessions loading'); return; }

    const currentSessionExists = availableSessions.some(
      (s) => s.id === resolvedSessionId,
    );

    console.log('[HEALTH_MONITOR] sessionExists:', currentSessionExists, 'seenBefore:', sessionSeenInListRef.current, 'sessionIds:', availableSessions.map(s => s.id.slice(0, 8)));

    if (currentSessionExists) {
      sessionSeenInListRef.current = true;
    } else if (sessionSeenInListRef.current) {
      console.log('[HEALTH_MONITOR] Session GONE — calling onSessionLost');
      onSessionLost?.();
    } else {
      console.log('[HEALTH_MONITOR] Session not in list but never seen — waiting');
    }
  }, [isCollaborationMode, resolvedSessionId, availableSessions, sessionsLoading, onSessionLost]);

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

      const rawShouldMarkComplete =
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
        // ORCH-0431: isRefreshingAfterPrefChange guard mirrors isModeTransitioning —
        // without it, placeholderData keeps isDeckLoading false after a pref change,
        // causing premature completion before new cards arrive.
        (!isLoadingLocation && !isLoadingPreferences && !isDeckLoading && !isModeTransitioning && !isRefreshingAfterPrefChange);

      // [ORCH-0507.a] Collab gate — do NOT mark complete until all collab-side
      // data is ready. Without this, the composite above can evaluate true
      // while useBoardSession is still loading participants or
      // collabDeckParams is still null (board session loaded but aggregation
      // pending). That race lets the WAITING_FOR_PARTICIPANTS selector
      // branch fire before any real "is the session short-handed?" answer is
      // available. Establishes I-COLLAB-COMPLETION-GATES-ON-PARTICIPANT-LOAD.
      const collabDataReady = !isCollaborationMode || (
        !boardSessionResult.loading &&
        allParticipantPrefs !== null &&
        collabDeckParams !== null
      );

      const shouldMarkComplete = rawShouldMarkComplete && collabDataReady;

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
    isRefreshingAfterPrefChange,
    // [ORCH-0507.a] Dependencies for the collabDataReady gate added so the
    // effect re-evaluates when collab-side data resolves. Without these, the
    // effect would stay at its pre-load closure and never transition the
    // completion flag once participant + params data actually lands.
    isCollaborationMode,
    boardSessionResult.loading,
    allParticipantPrefs,
    collabDeckParams,
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
    // ORCH-0490 Phase 2.3: clearRecommendations() is called from logout /
    // full-clear paths. Wipe the per-context registry so private deck state
    // from the previous user doesn't leak into the next session.
    // Constitutional #6. Flag-gated (no-op when flag off — registry unused).
    if (FEATURE_FLAG_PER_CONTEXT_DECK_STATE) {
      registry.clearAll();
    }
  }, [queryClient, registry]);

  // ── Collab params change detector ─────────────────────────────────────
  const prevCollabParamsRef = useRef<string | null>(null);
  const prevCollabModeRef = useRef(false);
  useEffect(() => {
    if (!isCollaborationMode || !collabDeckParams) {
      prevCollabModeRef.current = false;
      return;
    }
    const paramsKey = JSON.stringify(collabDeckParams);

    // ORCH-0437: When entering collab mode (solo→collab transition), always
    // invalidate session-deck to clear any cached errors from prior attempts
    // where the other participant hadn't set preferences yet.
    if (!prevCollabModeRef.current) {
      // Initial collab entry — mode transition effect already invalidated deck-cards.
      // Don't double-invalidate here (causes duplicate fetch). Just mark collab active.
      prevCollabModeRef.current = true;
    } else if (prevCollabParamsRef.current !== null && prevCollabParamsRef.current !== paramsKey) {
      // Collab params changed (preference update) — invalidate session deck
      // ORCH-0446: session-deck queries no longer exist. Deck uses deck-cards key.
      //
      // ORCH-0490 Phase 2.3 (CF-2.3-9): under flag-on the invalidate + batchSeed
      // reset are NO-OPs. New aggregated params produce a different query key,
      // which naturally causes a cache miss in React Query; `placeholderData`
      // keepPrevious keeps old cards visible during fetch; the sync effect
      // (CF-2.3-8) does append-not-replace on superset, fresh-seed on non-
      // superset. Phase 2.6 will add a realtime signal here that sets
      // `isDeckExpandingWithinContext=true` so non-superset collab realtime
      // pref propagation preserves position. Flag-off preserves legacy wipe.
      // [TRANSITIONAL] — deletable at flag exit condition.
      if (!FEATURE_FLAG_PER_CONTEXT_DECK_STATE) {
        queryClient.invalidateQueries({ queryKey: ['deck-cards'] });
        setBatchSeed(0);
      }
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

    // ORCH-0474: AUTH_REQUIRED routes BEFORE the generic ERROR catch. The
    // DeckFetchError is tagged via serverPath by deckService → useDeckCards;
    // we surface the sign-in retry banner here instead of a generic
    // "something went wrong." Only fires after first fetch completed — avoids
    // flickering the banner during the initial warm-up window.
    if (soloServerPath === 'auth-required' && hasCompletedFetchForCurrentMode) {
      return { type: 'AUTH_REQUIRED' };
    }

    // ORCH-0474: PIPELINE_ERROR routes BEFORE the generic ERROR catch.
    // Two sub-cases:
    //   - Stale cards present: render LOADED (cards stay visible), toast
    //     overlays via showPipelineErrorToast (read by SwipeableCards).
    //   - No stale cards: full-screen PIPELINE_ERROR with retry.
    if (soloServerPath === 'pipeline-error' && hasCompletedFetchForCurrentMode) {
      if (recommendations.length > 0) {
        return { type: 'LOADED', cards: recommendations };
      }
      return { type: 'PIPELINE_ERROR', message: 'We had trouble loading the deck.' };
    }

    // DECK FETCH ERROR — only when no cards exist (don't overwrite visible cards
    // with an error for a background refetch failure). ORCH-0474-tagged errors
    // already routed above; this is the fallback for untagged errors.
    if (soloDeckError && recommendations.length === 0 && hasCompletedFetchForCurrentMode) {
      return { type: 'ERROR', message: 'Something went wrong loading experiences' };
    }

    // ORCH-0446: Collab now uses useDeckCards (same as solo). Errors are unified.
    // The soloDeckError check above covers both modes.

    // ORCH-0446: Collab-specific waiting state — ≥2 participants required.
    //
    // [ORCH-0507.b] WAITING_FOR_PARTICIPANTS must distinguish "participant
    // data is still loading" (allParticipantPrefs === null) from "participant
    // data loaded and genuinely < 2 accepted" (length check). Without the
    // null check, the branch misfires during the useBoardSession load window
    // as a lying state (surface Constitutional #3 violation). Load-in-
    // progress falls through to INITIAL_LOADING below via the existing
    // `!hasCompletedFetchForCurrentMode && recommendations.length === 0`
    // branch. Establishes I-WAITING-STATE-LOADING-AWARE.
    //
    // Belt-and-suspenders with Layer 3 (Mark-Fetch-Complete collab gate):
    // Layer 3 prevents hasCompletedFetchForCurrentMode from flipping true
    // during the load window; this null-check defends against any residual
    // race that Layer 3's gate might miss.
    if (
      isCollaborationMode &&
      hasCompletedFetchForCurrentMode &&
      recommendations.length === 0 &&
      allParticipantPrefs !== null  // [ORCH-0507.b] only decide once data is loaded
    ) {
      const acceptedCount = allParticipantPrefs.length;
      if (acceptedCount < 2) {
        return { type: 'WAITING_FOR_PARTICIPANTS' };
      }
    }

    // MODE_TRANSITIONING
    if (isModeTransitioning || isWaitingForSessionResolution) {
      return { type: 'MODE_TRANSITIONING' };
    }

    // INITIAL_LOADING (first load or pref change — no cards yet)
    if (!hasCompletedFetchForCurrentMode && recommendations.length === 0) {
      return { type: 'INITIAL_LOADING' };
    }

    // EXHAUSTED — user has been served AND swiped through all accumulated cards.
    // The exhaustion effect at line 576 enforces "has been served" via a
    // batchSeed > 0 || accumulatedCardsRef.current.length > 0 gate. Empty first page
    // (server returned zero for this filter) resolves to EMPTY below, not here.
    if (isExhausted && recommendations.length === 0) {
      return { type: 'EXHAUSTED' };
    }

    // EMPTY (server returned 0 cards for location/prefs).
    //
    // ORCH-0490 Phase 2.1 + I-DECK-EMPTY-IS-SERVER-VERDICT: EMPTY is server-verdict
    // only. Three acceptable conditions:
    //   (a) soloServerPath === 'pool-empty' — server explicitly reported empty pool
    //       (genuine seeding gap, or auth-ok-but-empty result for these filters).
    //   (b) isDeckBatchLoaded && !deckHasMore — the final paginated batch resolved
    //       with no more pages, and recommendations is empty (filter killed all
    //       cards the pipeline returned).
    //   (c) ORCH-0677 RC-2: soloCuratedEmptyReason is set — curated-only deck
    //       returned 0 cards with an explicit empty verdict. Without this gate,
    //       curated-only empty results fall through to the INITIAL_LOADING
    //       fallback at line 1684, leaving the user on "Curating your lineup"
    //       indefinitely. Do not remove the curatedEmptyReason check — it is
    //       the only signal that surfaces curated-only empty results.
    // `hasCompletedFetchForCurrentMode` is intentionally NOT in this condition —
    // it was the hook the old 20s safety timer used to force false EMPTY. With
    // the timer removed, we require a REAL server signal here.
    if (
      recommendations.length === 0 &&
      !isModeTransitioning &&
      (soloServerPath === 'pool-empty' ||
        (isDeckBatchLoaded && !deckHasMore) ||
        soloCuratedEmptyReason !== undefined)
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
    hasCompletedFetchForCurrentMode, recommendations, isCollaborationMode,
    // [ORCH-0507.b] Full reference needed so `allParticipantPrefs !== null`
    // transitions (null → loaded) re-evaluate the selector. `?.length` alone
    // would not change when transitioning from null to an empty-but-loaded
    // array (both read 0 / undefined); the null-check requires the reference.
    allParticipantPrefs, isExhausted,
    soloServerPath, // ORCH-0474: drives AUTH_REQUIRED + PIPELINE_ERROR routing
    isDeckBatchLoaded, deckHasMore, // ORCH-0490 Phase 2.1: drive server-verdict EMPTY branch
    soloCuratedEmptyReason, // ORCH-0677 RC-2: drive curated-only EMPTY routing
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

  // ── ORCH-0474: Pipeline-error toast overlay signal ──────────────────────
  // Fires when the last deck fetch returned path:'pipeline-error' AND stale
  // accumulated cards are still being shown. SwipeableCards consumes this in
  // its LOADED branch to overlay a retry toast. Self-clears when serverPath
  // becomes 'pipeline' again on the next successful fetch.
  const showPipelineErrorToast =
    soloServerPath === 'pipeline-error' &&
    recommendations.length > 0 &&
    hasCompletedFetchForCurrentMode;

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
    // ORCH-0474
    showPipelineErrorToast,
    serverPath: soloServerPath,
    // ORCH-0490 Phase 2.3: expansion signal consumed by SwipeableCards.
    // Undefined under flag-off (Phase 2.3 feature flag off) — consumers
    // must handle undefined as "no signal, use legacy heuristic."
    isDeckExpandingWithinContext: FEATURE_FLAG_PER_CONTEXT_DECK_STATE
      ? isDeckExpandingWithinContext
      : undefined,
    // ORCH-0490 Phase 2.3 rework (AH-138): expose registry + active context
    // so SwipeableCards can save/restore its swipe state (removedCards +
    // currentCardIndex) per context. The registry ref is stable across
    // renders (useRef); currentContext is useMemo-stable unless mode/session
    // actually change. Under flag-off, both undefined/null — SwipeableCards
    // falls through to its legacy AsyncStorage-backed restoration.
    deckStateRegistry: FEATURE_FLAG_PER_CONTEXT_DECK_STATE ? registry : null,
    activeDeckContext: FEATURE_FLAG_PER_CONTEXT_DECK_STATE
      ? currentContext
      : undefined,
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
