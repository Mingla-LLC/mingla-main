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
  openingHours: string;
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
    const session = availableSessions.find(
      (s) => s.id === currentMode || s.name === currentMode
    );
    return session?.id || null;
  }, [currentMode, currentSession, availableSessions]);

  const isWaitingForSessionResolution =
    currentMode !== "solo" && !resolvedSessionId && sessionsLoading;

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
  const previousRecommendationsRef = useRef<Recommendation[] | undefined>(undefined);

  // Sync recommendations from TanStack Query to local state and CardsCache
  useEffect(() => {
    // Handle undefined or empty recommendations
    if (!recommendationsData) {
      return; // Don't update state if data is still loading
    }

    // Check if recommendations have actually changed
    const prevRecs = previousRecommendationsRef.current;
    const hasChanged = !prevRecs || 
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
        const currentCardIds = new Set(recommendationsData.map((r: Recommendation) => r.id));
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
      // Empty array - clear recommendations only if not already empty
      if (recommendations.length > 0) {
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
  useEffect(() => {
    const modeChanged =
      previousModeRef.current !== undefined &&
      previousModeRef.current !== currentMode;

    if (modeChanged) {
      setIsModeTransitioning(true);
      setRecommendations([]);
      // Invalidate recommendations query to trigger refetch
      queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    }

    previousModeRef.current = currentMode;
  }, [currentMode, queryClient]);

  // Reset mode transitioning when recommendations are loaded
  useEffect(() => {
    if (recommendationsData && recommendationsData.length > 0) {
      setIsModeTransitioning(false);
    }
  }, [recommendationsData]);

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

  // Compute loading and error states from TanStack Query
  const loading =
    isLoadingLocation ||
    isLoadingPreferences ||
    isLoadingRecommendations ||
    isFetchingRecommendations;
  const error = recommendationsError
    ? (recommendationsError as Error).message === "no_matches"
      ? "no_matches"
      : "Failed to load recommendations"
    : locationError
    ? "Failed to load location"
    : null;

  const hasCompletedInitialFetch =
    !isLoadingRecommendations &&
    !isFetchingRecommendations &&
    (recommendations.length > 0 || recommendationsData?.length === 0);

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
