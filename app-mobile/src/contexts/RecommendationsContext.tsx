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
import { ExperienceGenerationService } from "../services/experienceGenerationService";
import { useAuthSimple } from "../hooks/useAuthSimple";
import { useSessionManagement } from "../hooks/useSessionManagement";
import { useBoardSession } from "../hooks/useBoardSession";
import { useCardsCache } from "./CardsCacheContext";
import { useUserLocation } from "../hooks/useUserLocation";
import { useUserPreferences } from "../hooks/useUserPreferences";
import { useRecommendationsQuery } from "../hooks/useRecommendationsQuery";
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

const getDefaultPreferences = (): UserPreferences => ({
  mode: "explore",
  budget_min: 0,
  budget_max: 1000,
  people_count: 1,
  categories: ["Sip & Chill", "Stroll"],
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
  isWaitingForSessionResolution: boolean;
  hasCompletedInitialFetch: boolean;
  refreshRecommendations: (refreshKey?: number | string) => void;
  clearRecommendations: () => void;
  updateCardStrollData: (
    cardId: string,
    strollData: Recommendation["strollData"]
  ) => void;
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
  const [isModeTransitioning, setIsModeTransitioning] = useState(false);
  const [hasCompletedFetchForCurrentMode, setHasCompletedFetchForCurrentMode] =
    useState(false);
  const currentMode = propCurrentMode;
  const refreshKey = propRefreshKey;
  const currentCacheKeyRef = useRef<string | null>(null);
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

  // Use TanStack Query for recommendations
  const isCollaborationMode: boolean = Boolean(
    currentMode !== "solo" && resolvedSessionId
  );

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
    enabled: Boolean(
      userLocation &&
        !isWaitingForSessionResolution &&
        (currentMode === "solo" || !!resolvedSessionId) &&
        Boolean(cardsCache.isCacheLoaded)
    ),
  });

  // Get stable references to cache methods to avoid dependency issues
  const generateCacheKey = cardsCache.generateCacheKey;
  const getCachedCards = cardsCache.getCachedCards;
  const setCachedCards = cardsCache.setCachedCards;

  // Track previous recommendations to prevent unnecessary updates
  const previousRecommendationsRef = useRef<Recommendation[] | undefined>(
    undefined
  );

  // Sync recommendations from TanStack Query to local state and CardsCache
  useEffect(() => {
    // Handle undefined or empty recommendations
    if (!recommendationsData) {
      return; // Don't update state if data is still loading
    }

    // Check if recommendations have actually changed
    const prevRecs = previousRecommendationsRef.current;
    const hasChanged =
      !prevRecs ||
      prevRecs.length !== recommendationsData.length ||
      prevRecs.some((prev, idx) => prev.id !== recommendationsData[idx]?.id);

    if (!hasChanged) {
      return; // No change, skip update
    }

    previousRecommendationsRef.current = recommendationsData;

    if (recommendationsData.length > 0) {
      setRecommendations(recommendationsData);

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
          recommendationsData.map((r: Recommendation) => r.id)
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
            recommendationsData,
            existingCache.currentCardIndex,
            existingCache.removedCardIds || [],
            currentMode,
            userLocation
          );
        } else {
          // New recommendations or cache doesn't exist - initialize with defaults

          setCachedCards(
            cacheKey,
            recommendationsData,
            0,
            [],
            currentMode,
            userLocation
          );
        }
        currentCacheKeyRef.current = cacheKey;

        // Track interaction
        if (user?.id && recommendationsData.length > 0) {
          ExperiencesService.trackInteraction(
            user.id,
            recommendationsData[0].id,
            "view"
          ).catch((error) => {
            console.error("Error tracking view interaction:", error);
          });
        }
      }
    } else if (recommendationsData.length === 0) {
      // Empty array - always sync to state to ensure consistency
      // This is important during mode transitions to show the correct state
      if (recommendations.length !== 0) {
        setRecommendations([]);
      }
    }
  }, [
    recommendationsData,
    userLocation,
    userPrefs,
    currentMode,
    refreshKey,
    user?.id,
    generateCacheKey,
    getCachedCards,
    setCachedCards,
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
    isLoadingLocation || isLoadingPreferences || isLoadingRecommendations;
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
        // Case 3: Query had an error AND finished AND we have a result (error is a valid completion)
        (!!recommendationsError && queryFinished && hasQueryResult);

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
    isWaitingForSessionResolution,
    hasCompletedInitialFetch,
    refreshRecommendations,
    clearRecommendations,
    updateCardStrollData,
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
