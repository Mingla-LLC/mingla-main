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
import { ExperienceGenerationService } from "../services/experienceGenerationService";
import { useAuthSimple } from "../hooks/useAuthSimple";
import { useSessionManagement } from "../hooks/useSessionManagement";
import { useBoardSession } from "../hooks/useBoardSession";
import { useCardsCache } from "./CardsCacheContext";
import { useUserLocation } from "../hooks/useUserLocation";
import { useUserPreferences } from "../hooks/useUserPreferences";
import { useRecommendationsQuery } from "../hooks/useRecommendationsQuery";
import { useCuratedExperiences } from "../hooks/useCuratedExperiences";
import { curatedExperiencesService } from "../services/curatedExperiencesService";
import { useQueryClient } from "@tanstack/react-query";

export interface Recommendation {
  id: string;
  title: string;
  category: string;
  categoryIcon: string;
  lat?: number;
  lng?: number;
  timeAway: string;
  description: string;
  budget: string;
  rating: number;
  image: string;
  images: string[];
  priceRange: string;
  distance: string;
  travelTime: string;
  experienceType: string;
  highlights: string[];
  fullDescription: string;
  address: string;
  openingHours:
    | string
    | {
        open_now?: boolean;
        weekday_text?: string[];
      }
    | null;
  tags: string[];
  matchScore: number;
  reviewCount: number;
  socialStats: {
    views: number;
    likes: number;
    saves: number;
    shares: number;
  };
  matchFactors: {
    location: number;
    budget: number;
    category: number;
    time: number;
    popularity: number;
  };
  strollData?: {
    anchor: {
      id: string;
      name: string;
      location: { lat: number; lng: number };
      address: string;
    };
    companionStops: Array<{
      id: string;
      name: string;
      location: { lat: number; lng: number };
      address: string;
      rating?: number;
      reviewCount?: number;
      imageUrl?: string | null;
      placeId: string;
      type: string;
    }>;
    route: {
      duration: number;
      startLocation: { lat: number; lng: number };
      endLocation: { lat: number; lng: number };
    };
    timeline: Array<{
      step: number;
      type: string;
      title: string;
      location: any;
      description: string;
      duration: number;
    }>;
  };
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Converts a CuratedExperienceCard into a Recommendation so SwipeableCards can render it */
function curatedToRecommendation(card: any): Recommendation {
  const stops = card.stops ?? [];
  const firstStop = stops[0];
  const avgRating =
    stops.length > 0
      ? stops.reduce((s: number, st: any) => s + (st.rating ?? 0), 0) / stops.length
      : 0;
  const firstImage = firstStop?.imageUrl || '';
  const allImages = stops.map((s: any) => s.imageUrl).filter(Boolean);

  return {
    // Preserve curated card identity so ExpandedCardModal can detect it
    cardType: 'curated' as const,
    // Preserve original curated fields for CuratedPlanView and TimelineSection
    stops: card.stops,
    totalPriceMin: card.totalPriceMin,
    totalPriceMax: card.totalPriceMax,
    estimatedDurationMinutes: card.estimatedDurationMinutes,
    pairingKey: card.pairingKey,
    tagline: card.tagline,
    id: card.id,
    title: card.title,
    category: 'Adventurous',
    categoryIcon: 'compass',
    lat: firstStop?.lat,
    lng: firstStop?.lng,
    timeAway: `${card.estimatedDurationMinutes ?? 0} min`,
    description: card.tagline ?? '',
    budget: `$${card.totalPriceMin ?? 0}–$${card.totalPriceMax ?? 0}`,
    rating: avgRating,
    image: firstImage,
    images: allImages.length > 0 ? allImages : [firstImage || ''],
    priceRange: `$${card.totalPriceMin ?? 0}–$${card.totalPriceMax ?? 0}`,
    distance: firstStop ? `${firstStop.distanceFromUserKm ?? 0} km` : '0 km',
    travelTime: firstStop ? `${firstStop.travelTimeFromUserMin ?? 0} min` : '0 min',
    experienceType: card.experienceType ?? 'solo-adventure',
    highlights: stops.map((s: any) => s.placeName),
    fullDescription: card.tagline ?? '',
    address: firstStop?.address ?? '',
    openingHours: null,
    tags: stops.map((s: any) => s.placeType),
    matchScore: card.matchScore ?? 50,
    reviewCount: stops.reduce((s: number, st: any) => s + (st.reviewCount ?? 0), 0),
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    matchFactors: { location: 0.5, budget: 0.5, category: 0.5, time: 0.5, popularity: 0.5 },
    // Preserve curated data for expanded view
    strollData: {
      anchor: {
        id: firstStop?.placeId ?? '',
        name: firstStop?.placeName ?? '',
        location: { lat: firstStop?.lat ?? 0, lng: firstStop?.lng ?? 0 },
        address: firstStop?.address ?? '',
      },
      companionStops: stops.slice(1).map((s: any) => ({
        id: s.placeId ?? '',
        name: s.placeName ?? '',
        location: { lat: s.lat ?? 0, lng: s.lng ?? 0 },
        address: s.address ?? '',
        rating: s.rating,
        reviewCount: s.reviewCount,
        imageUrl: s.imageUrl,
        placeId: s.placeId ?? '',
        type: s.placeType ?? '',
      })),
      route: {
        duration: card.estimatedDurationMinutes ?? 0,
        startLocation: { lat: firstStop?.lat ?? 0, lng: firstStop?.lng ?? 0 },
        endLocation: {
          lat: stops[stops.length - 1]?.lat ?? 0,
          lng: stops[stops.length - 1]?.lng ?? 0,
        },
      },
      timeline: stops.map((s: any, i: number) => ({
        step: i + 1,
        type: s.placeType ?? '',
        title: s.placeName ?? '',
        location: { lat: s.lat ?? 0, lng: s.lng ?? 0 },
        description: `${s.stopLabel}: ${s.placeName}`,
        duration: 60,
      })),
    },
  } as Recommendation;
}

/** Puts curated cards first so user sees all 20, then appends regular cards after */
function interleaveCards(
  regular: Recommendation[],
  curated: Recommendation[]
): Recommendation[] {
  if (curated.length === 0) return regular;
  if (regular.length === 0) return curated;
  // Show curated cards as the primary content, regular cards fill in after
  return [...curated, ...regular];
}

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
  // Track whether a batch transition is in-flight so we don't wipe recommendations mid-load
  const [isBatchTransitioning, setIsBatchTransitioning] = useState(false);
  // Store previous batch recommendations so "Review Previous Batch" can restore them
  const previousBatchRef = useRef<Recommendation[]>([]);
  const currentMode = propCurrentMode;
  const refreshKey = propRefreshKey;
  const previousRefreshKeyRef = useRef(propRefreshKey);
  const currentCacheKeyRef = useRef<string | null>(null);
  const warmPoolFired = useRef(false);
  const queryClient = useQueryClient();

  const { user } = useAuthSimple();
  const cardsCache = useCardsCache();
  const {
    currentSession,
    isInSolo,
    availableSessions,
    loading: sessionsLoading,
  } = useSessionManagement();

  // Wait for cache to be loaded from storage before checking cache
  const shouldCheckCache = cardsCache.isCacheLoaded;

  // Resolve session ID from currentMode
  const resolvedSessionId = React.useMemo(() => {
    if (currentMode === "solo") return null;
    if (currentSession?.id) return currentSession.id;

    // Check if currentMode itself looks like a UUID (session ID)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(currentMode)) return currentMode;

    const session = availableSessions.find(
      (s) => s.id === currentMode || s.name === currentMode
    );
    return session?.id || null;
  }, [currentMode, currentSession, availableSessions]);

  // Add a state to track if we've given up on session resolution
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

  // Use TanStack Query hooks
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

  // ── Turbo Pipeline: Pre-warm curated pool on app load ──────────
  useEffect(() => {
    if (userLocation && userPrefs && !warmPoolFired.current) {
      warmPoolFired.current = true;
      curatedExperiencesService.warmPool({
        experienceType: 'solo-adventure',
        location: userLocation,
        budgetMax: userPrefs.budget_max ?? 1000,
        travelMode: userPrefs.travel_mode ?? 'walking',
        travelConstraintType: (userPrefs.travel_constraint_type as string) ?? 'time',
        travelConstraintValue: userPrefs.travel_constraint_value ?? 30,
      }).catch(() => {}); // Fire and forget
    }
  }, [userLocation, userPrefs]);

  // Use TanStack Query for recommendations
  const isCollaborationMode: boolean = Boolean(
    currentMode !== "solo" && resolvedSessionId
  );

  const generateNextBatch = useCallback(() => {
    // Save current recommendations so "Review Previous Batch" can restore them
    previousBatchRef.current = recommendations;
    setIsBatchTransitioning(true);
    setBatchSeed(prev => prev + 1);
    // Pre-warm for the next-next batch (fire-and-forget)
    if (userLocation && userPrefs) {
      curatedExperiencesService.warmPool({
        experienceType: 'solo-adventure',
        location: userLocation,
        budgetMax: userPrefs.budget_max ?? 1000,
        travelMode: userPrefs.travel_mode ?? 'walking',
        travelConstraintType: (userPrefs.travel_constraint_type as string) ?? 'time',
        travelConstraintValue: userPrefs.travel_constraint_value ?? 30,
      }).catch(() => {});
    }
  }, [recommendations, userLocation, userPrefs]);

  // Safety timeout: if isBatchTransitioning stays true for >15 s, clear it
  // so the user isn't stuck on a spinner if the background query hangs.
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
    if (previousBatchRef.current.length > 0) {
      setRecommendations(previousBatchRef.current);
      // Ensure the spinner is cleared when restoring
      setIsBatchTransitioning(false);
    }
  }, []);

  // Reset batchSeed when preferences change (refreshKey changes)
  useEffect(() => {
    if (previousRefreshKeyRef.current !== undefined && previousRefreshKeyRef.current !== refreshKey) {
      setBatchSeed(0);
      setIsBatchTransitioning(false);
      warmPoolFired.current = false; // Allow re-warm after pref change
      // Invalidate curated-experiences so they refetch with fresh params
      queryClient.invalidateQueries({ queryKey: ['curated-experiences'] });
    }
    previousRefreshKeyRef.current = refreshKey;
  }, [refreshKey, queryClient]);

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
      userLocation &&
        !isWaitingForSessionResolution &&
        (currentMode === "solo" || !!resolvedSessionId) &&
        Boolean(cardsCache.isCacheLoaded)
    ),
  });

  // Curated Experiences — interleaved into solo swipe stack
  // Derive experience types from the categories array (which stores both intents and categories)
  const INTENT_IDS = new Set(['solo-adventure', 'first-dates', 'romantic', 'friendly', 'group-fun', 'business']);
  const experienceTypes: string[] = (userPrefs?.categories ?? []).filter(c => INTENT_IDS.has(c));

  const baseParams = {
    location: userLocation,
    budgetMin: userPrefs?.budget_min ?? 0,
    budgetMax: userPrefs?.budget_max ?? 1000,
    travelMode: userPrefs?.travel_mode ?? 'walking',
    travelConstraintType:
      (userPrefs?.travel_constraint_type as 'time' | 'distance') ?? 'time',
    travelConstraintValue: userPrefs?.travel_constraint_value ?? 30,
    datetimePref: userPrefs?.datetime_pref ?? new Date().toISOString(),
    batchSeed,
  };
  const isSoloMode = currentMode === 'solo';
  const curatedSessionId = isCollaborationMode ? resolvedSessionId : undefined;

  // In solo mode: hooks fire based on user's selected experience types
  // In collaboration mode: only solo-adventure fires (Turbo Pipeline).
  // Other experience types use the legacy fallback pipeline which produces
  // non-curated-format cards — these get mixed in and look wrong.
  // The session edge function handles location aggregation server-side.
  const { cards: curatedSoloCards, isLoading: isLoadingCuratedSolo, isFullBatchLoaded: isSoloBatchLoaded } = useCuratedExperiences({
    experienceType: 'solo-adventure',
    ...baseParams,
    sessionId: curatedSessionId ?? undefined,
    enabled: isSoloMode
      ? (experienceTypes.length === 0 || experienceTypes.includes('solo-adventure'))
      : isCollaborationMode,
  });
  const { cards: curatedDateCards, isLoading: isLoadingCuratedDate, isFullBatchLoaded: isDateBatchLoaded } = useCuratedExperiences({
    experienceType: 'first-dates',
    ...baseParams,
    sessionId: curatedSessionId ?? undefined,
    enabled: isSoloMode
      ? experienceTypes.includes('first-dates')
      : false,  // Disabled in collab — fallback pipeline produces non-curated cards
  });
  const { cards: curatedRomCards, isLoading: isLoadingCuratedRom, isFullBatchLoaded: isRomBatchLoaded } = useCuratedExperiences({
    experienceType: 'romantic',
    ...baseParams,
    sessionId: curatedSessionId ?? undefined,
    enabled: isSoloMode
      ? experienceTypes.includes('romantic')
      : false,  // Disabled in collab — fallback pipeline produces non-curated cards
  });
  const { cards: curatedFriendCards, isLoading: isLoadingCuratedFriend, isFullBatchLoaded: isFriendBatchLoaded } = useCuratedExperiences({
    experienceType: 'friendly',
    ...baseParams,
    sessionId: curatedSessionId ?? undefined,
    enabled: isSoloMode
      ? experienceTypes.includes('friendly')
      : false,  // Disabled in collab — fallback pipeline produces non-curated cards
  });
  const { cards: curatedGroupCards, isLoading: isLoadingCuratedGroup, isFullBatchLoaded: isGroupBatchLoaded } = useCuratedExperiences({
    experienceType: 'group-fun',
    ...baseParams,
    sessionId: curatedSessionId ?? undefined,
    enabled: isSoloMode
      ? experienceTypes.includes('group-fun')
      : false,  // Disabled in collab — fallback pipeline produces non-curated cards
  });

  // True when ALL enabled curated hooks have finished loading (success or error).
  // Used to gate isBatchTransitioning.
  const allCuratedBatchesLoaded =
    isSoloBatchLoaded && isDateBatchLoaded && isRomBatchLoaded &&
    isFriendBatchLoaded && isGroupBatchLoaded;

  const allCuratedCards = [
    ...curatedSoloCards,
    ...curatedDateCards,
    ...curatedRomCards,
    ...curatedFriendCards,
    ...curatedGroupCards,
  ];
  // Stabilize with useMemo keyed on card IDs to prevent re-shuffle every render
  const curatedRecommendations = useMemo(() => {
    if (allCuratedCards.length === 0) return [];
    return shuffleArray(allCuratedCards).map(curatedToRecommendation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCuratedCards.map(c => c.id).sort().join(',')]);

  // Get stable references to cache methods to avoid dependency issues
  const generateCacheKey = cardsCache.generateCacheKey;
  const getCachedCards = cardsCache.getCachedCards;
  const setCachedCards = cardsCache.setCachedCards;

  // Track previous recommendations to prevent unnecessary updates
  const previousRecommendationsRef = useRef<Recommendation[] | undefined>(
    undefined
  );
  const previousCuratedIdsRef = useRef<string>('');

  // Sync recommendations from TanStack Query to local state and CardsCache
  useEffect(() => {
    // Handle undefined or empty recommendations
    // Allow curated cards to surface even when regular fetch errors/returns undefined
    if (!recommendationsData && curatedRecommendations.length === 0) {
      return; // Don't update state if data is still loading and no curated cards
    }
    const regularCards = recommendationsData ?? [];

    // Check if recommendations have actually changed (including curated)
    const prevRecs = previousRecommendationsRef.current;
    const curatedIdsKey = curatedRecommendations.map(c => c.id).sort().join(',');
    const curatedChanged = previousCuratedIdsRef.current !== curatedIdsKey;
    const hasChanged =
      curatedChanged ||
      !prevRecs ||
      prevRecs.length !== regularCards.length ||
      prevRecs.some((prev, idx) => prev.id !== regularCards[idx]?.id);

    if (!hasChanged) {
      return; // No change, skip update
    }

    previousRecommendationsRef.current = regularCards;
    previousCuratedIdsRef.current = curatedIdsKey;

    if (regularCards.length > 0 || curatedRecommendations.length > 0) {
      const merged = interleaveCards(regularCards, curatedRecommendations);
      setRecommendations(merged);
      // Clear batch-transitioning flag once all curated batches have settled.
      if (isBatchTransitioning && allCuratedBatchesLoaded) {
        setIsBatchTransitioning(false);
      }

      // Also cache in CardsCacheContext for card state management
      if (userLocation && userPrefs) {
        const cacheKey = generateCacheKey(
          currentMode,
          userLocation,
          userPrefs,
          refreshKey
        );

        // Check if there's an existing cache entry with matching recommendations
        const existingCache = getCachedCards(cacheKey);
        const currentCardIds = new Set(
          regularCards.map((r: Recommendation) => r.id)
        );
        const cachedCardIds = existingCache
          ? new Set(existingCache.cards.map((c: Recommendation) => c.id))
          : null;

        // If cache exists and recommendations match, preserve existing state
        if (
          existingCache &&
          cachedCardIds &&
          currentCardIds.size === cachedCardIds.size &&
          Array.from(currentCardIds).every((id) => cachedCardIds.has(id))
        ) {
          // Recommendations match - preserve existing cache entry
          // Only update the cards array if it's different, but keep state

          setCachedCards(
            cacheKey,
            regularCards,
            existingCache.currentCardIndex,
            existingCache.removedCardIds || [],
            currentMode,
            userLocation
          );
        } else {
          // New recommendations or cache doesn't exist - initialize with defaults

          setCachedCards(
            cacheKey,
            regularCards,
            0,
            [],
            currentMode,
            userLocation
          );
        }
        currentCacheKeyRef.current = cacheKey;

        // Track interaction
        if (user?.id && regularCards.length > 0) {
          ExperiencesService.trackInteraction(
            user.id,
            regularCards[0].id,
            "view"
          ).catch((error) => {
            console.error("Error tracking view interaction:", error);
          });
        }
      }
    } else if (regularCards.length === 0) {
      // Both regular and curated are empty.
      // During a batch transition (Generate Another 20), KEEP the previous
      // recommendations visible instead of flashing an empty state while the
      // new curated cards are loading.
      if (isBatchTransitioning) {
        // Preserve existing recommendations — the new curated batch is still loading
        return;
      }
      // Not transitioning — genuinely empty; sync to state
      if (recommendations.length !== 0) {
        setRecommendations([]);
      }
    }
  }, [
    recommendationsData,
    curatedRecommendations,
    userLocation,
    userPrefs,
    currentMode,
    refreshKey,
    user?.id,
    generateCacheKey,
    getCachedCards,
    setCachedCards,
    isBatchTransitioning,
    allCuratedBatchesLoaded,
  ]);

  // Handle mode transitions
  const previousModeRef = useRef<string | undefined>(undefined);
  const completionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const modeChanged =
      previousModeRef.current !== undefined &&
      previousModeRef.current !== currentMode;

    if (modeChanged) {
      // Clear any existing timeout
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
        completionTimeoutRef.current = null;
      }

      setIsModeTransitioning(true);
      setRecommendations([]);
      setHasCompletedFetchForCurrentMode(false);

      // Reset the previous recommendations ref so new data is properly detected
      previousRecommendationsRef.current = undefined;

      // Set a safety timeout to force completion after 5 seconds
      // This prevents infinite loading if something goes wrong
      completionTimeoutRef.current = setTimeout(() => {
        console.warn("Recommendations fetch timeout - forcing completion");
        setHasCompletedFetchForCurrentMode(true);
        setIsModeTransitioning(false);
      }, 5000);

      // Invalidate recommendations query to trigger refetch for new mode
      // Since query keys include currentMode, different modes get separate cache entries
      // This prevents stale data from previous mode while allowing in-flight queries to complete gracefully
      queryClient.invalidateQueries({ queryKey: ["recommendations"] });
      queryClient.invalidateQueries({ queryKey: ["curated-experiences"] });
    }

    previousModeRef.current = currentMode;

    // Cleanup timeout on unmount
    return () => {
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current);
      }
    };
  }, [currentMode, queryClient]);

  // Compute loading and error states from TanStack Query (moved up for use in effect)
  const loading =
    isLoadingLocation || isLoadingPreferences || isLoadingRecommendations || isLoadingCuratedSolo;
  const isFetching = isFetchingRecommendations;

  // Reset mode transitioning and mark fetch as complete when query finishes
  useEffect(() => {
    // Don't mark as complete if we're waiting for session resolution or query is disabled
    const queryEnabled = Boolean(
      userLocation &&
        !isWaitingForSessionResolution &&
        (currentMode === "solo" || !!resolvedSessionId) &&
        Boolean(cardsCache.isCacheLoaded)
    );

    // Clear timeout if we're marking as complete
    if (hasCompletedFetchForCurrentMode && completionTimeoutRef.current) {
      clearTimeout(completionTimeoutRef.current);
      completionTimeoutRef.current = null;
    }

    // Only process if we're currently transitioning or haven't completed fetch for this mode
    if (isModeTransitioning || !hasCompletedFetchForCurrentMode) {
      // Check if query has finished (either with data, empty array, or error)
      const queryFinished =
        !isLoadingRecommendations && !isFetchingRecommendations;

      // CRITICAL: During mode transitions, we MUST wait for the query to actually run
      // and return data for the new mode before marking as complete.
      // We cannot mark complete if:
      // 1. We're transitioning AND the query hasn't returned data yet (recommendationsData is undefined)
      // 2. We're transitioning AND we don't have recommendations in state yet
      //
      // Mark as complete ONLY if:
      // 1. Query was enabled AND it has finished AND we have data (even if empty array)
      //    - This ensures the query actually ran and returned a result for the current mode
      // 2. OR we already have recommendations in state (from cache or previous fetch) AND not transitioning
      // 3. OR the query had an error AND finished AND we're not transitioning (error is valid result)
      //
      // CRITICAL: During transitions, we MUST wait for recommendationsData to be defined
      // This ensures we don't mark complete before the new mode's query runs
      const isInTransition = isModeTransitioning;
      const hasQueryResult = recommendationsData !== undefined;
      const hasRecommendationsInState = recommendations.length > 0;

      const shouldMarkComplete =
        // Case 1: Query ran and finished (enabled + finished + has data)
        (queryEnabled && queryFinished && hasQueryResult) ||
        // Case 2: We have recommendations AND we're not transitioning (from cache/previous)
        (hasRecommendationsInState &&
          !isInTransition &&
          !isLoadingRecommendations) ||
        // Case 3: Query had an error AND finished (error is a valid completion even without data)
        (!!recommendationsError && queryFinished);

      if (shouldMarkComplete) {
        // Mark fetch as completed
        setHasCompletedFetchForCurrentMode(true);
        // Reset transitioning flag
        if (isModeTransitioning) {
          setIsModeTransitioning(false);
        }
        // Clear timeout since we completed
        if (completionTimeoutRef.current) {
          clearTimeout(completionTimeoutRef.current);
          completionTimeoutRef.current = null;
        }
      }
    }
  }, [
    isModeTransitioning,
    hasCompletedFetchForCurrentMode,
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
    isFetching,
  ]);

  const updateCardStrollData = useCallback(
    (cardId: string, strollData: Recommendation["strollData"]) => {
      // Update the recommendation in state
      setRecommendations((prev) =>
        prev.map((card) =>
          card.id === cardId ? { ...card, strollData } : card
        )
      );

      // Update the cache if we have a cache key
      if (currentCacheKeyRef.current) {
        const cachedEntry = cardsCache.getCachedCards(
          currentCacheKeyRef.current
        );
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

  const error = recommendationsError
    ? (recommendationsError as Error).message === "no_matches"
      ? "no_matches"
      : "Failed to load recommendations"
    : locationError
    ? "Failed to load location"
    : null;

  // Compute hasCompletedInitialFetch - must not be transitioning and must have completed fetch for current mode
  // Mark as complete if we've successfully finished our initial work for this mode
  const hasCompletedInitialFetch =
    !isModeTransitioning &&
    !isWaitingForSessionResolution &&
    hasCompletedFetchForCurrentMode &&
    !isLoadingRecommendations;

  const refreshRecommendations = useCallback(() => {
    // Invalidate queries to trigger refetch
    queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    queryClient.invalidateQueries({ queryKey: ["userLocation"] });
    queryClient.invalidateQueries({ queryKey: ["userPreferences"] });
  }, [queryClient]);

  const clearRecommendations = useCallback(() => {
    setRecommendations([]);
    queryClient.removeQueries({ queryKey: ["recommendations"] });
  }, [queryClient]);

  const value: RecommendationsContextType = {
    recommendations,
    loading,
    isFetching,
    error,
    userLocation,
    isModeTransitioning,
    isBatchTransitioning,
    isWaitingForSessionResolution,
    hasCompletedInitialFetch,
    refreshRecommendations,
    clearRecommendations,
    updateCardStrollData,
    batchSeed,
    generateNextBatch,
    restorePreviousBatch,
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
