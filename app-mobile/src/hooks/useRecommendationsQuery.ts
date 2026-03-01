import { useQuery } from "@tanstack/react-query";
import { ExperienceGenerationService } from "../services/experienceGenerationService";
import {
  ExperiencesService,
  UserPreferences,
} from "../services/experiencesService";
import { Recommendation } from "../contexts/RecommendationsContext";

interface FetchRecommendationsParams {
  userId: string | undefined;
  currentMode: string;
  userLocation: { lat: number; lng: number } | null;
  userPreferences?: UserPreferences | null;
  resolvedSessionId: string | null;
  isBoardSession: boolean;
  boardPreferences: any;
  isCollaborationMode: boolean;
  isWaitingForSessionResolution?: boolean;
  batchSeed?: number;
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

const fetchRecommendations = async (
  params: FetchRecommendationsParams
): Promise<Recommendation[]> => {
  const {
    userId,
    currentMode,
    userLocation,
    userPreferences,
    resolvedSessionId,
    isBoardSession,
    boardPreferences,
    isCollaborationMode,
  } = params;

  if (!userLocation) {
    throw new Error("User location is required");
  }

  // Use already-loaded preferences from query cache/context to avoid
  // an extra roundtrip before recommendation generation.
  let userPrefs: UserPreferences = userPreferences || getDefaultPreferences();

  // Override with board preferences if in board session
  if (isBoardSession && boardPreferences) {
    userPrefs = {
      ...userPrefs,
      categories: boardPreferences.categories || userPrefs.categories,
      budget_min: boardPreferences.budget_min ?? userPrefs.budget_min,
      budget_max: boardPreferences.budget_max ?? userPrefs.budget_max,
      people_count: boardPreferences.group_size || userPrefs.people_count,
    };
  }

  // Generate experiences
  let generatedExperiences: any[] = [];

  if (isCollaborationMode && resolvedSessionId) {
    generatedExperiences =
      await ExperienceGenerationService.generateSessionExperiences({
        sessionId: resolvedSessionId,
        userId: userId,
      });
  } else {
    if (currentMode === "solo") {
      generatedExperiences =
        await ExperienceGenerationService.generateExperiences({
          userId: userId || "anonymous",
          preferences: userPrefs,
          location: userLocation,
        });
    } else {
      throw new Error(`Unable to resolve session for mode: ${currentMode}`);
    }
  }

  if (generatedExperiences.length === 0) {
    return [];
  }

  // Transform to Recommendation format
  const transformedRecommendations = generatedExperiences.map((exp) => {
    return {
      id: exp.id,
      title: exp.title,
      category: exp.category,
      categoryIcon: exp.categoryIcon,
      timeAway: exp.travelTime,
      description: exp.description,
      budget: exp.priceRange,
      rating: exp.rating,
      image: exp.heroImage,
      images: exp.images || [exp.heroImage],
      priceRange: exp.priceRange,
      distance: exp.distance,
      travelTime: exp.travelTime,
      experienceType: exp.category,
      highlights: exp.highlights || [],
      fullDescription: exp.description,
      address: exp.address,
      openingHours: exp.openingHours || null,
      tags: exp.highlights || [],
      matchScore: exp.matchScore,
      reviewCount: exp.reviewCount,
      lat: exp.lat,
      lng: exp.lng,
      socialStats: {
        views: 0,
        likes: 0,
        saves: 0,
        shares: 0,
      },
      matchFactors: exp.matchFactors || {
        location: 85,
        budget: 85,
        category: 85,
        time: 85,
        popularity: 85,
      },
      // Preserve strollData if it exists
      strollData: exp.strollData,
    };
  });

  return transformedRecommendations;
};

export const useRecommendationsQuery = (
  params: FetchRecommendationsParams & {
    enabled?: boolean;
  }
) => {
  const {
    userId,
    currentMode,
    userLocation,
    userPreferences,
    resolvedSessionId,
    isBoardSession,
    boardPreferences,
    enabled = true,
  } = params;

  // Create a stable query key that includes all relevant parameters
  const queryKey = [
    "recommendations",
    userId,
    currentMode,
    userLocation?.lat,
    userLocation?.lng,
    userPreferences?.mode,
    userPreferences?.budget_min,
    userPreferences?.budget_max,
    userPreferences?.people_count,
    userPreferences?.travel_mode,
    userPreferences?.travel_constraint_type,
    userPreferences?.travel_constraint_value,
    userPreferences?.datetime_pref,
    userPreferences?.categories?.join(","),
    resolvedSessionId,
    isBoardSession,
    boardPreferences?.categories?.join(","),
    boardPreferences?.budget_min,
    boardPreferences?.budget_max,
    boardPreferences?.group_size,
    params.batchSeed,
  ];

  return useQuery({
    queryKey,
    queryFn: () => fetchRecommendations(params),
    enabled:
      enabled &&
      !!userLocation &&
      !params.isWaitingForSessionResolution &&
      (currentMode === "solo" || !!params.resolvedSessionId),
    staleTime: 60 * 60 * 1000, // 1 hour - data stays fresh for 1 hour
    gcTime: 24 * 60 * 60 * 1000, // 24 hours - keep in cache for 24 hours
    refetchOnMount: false, // Don't refetch when component mounts if data exists
    refetchOnWindowFocus: false, // Don't refetch on window focus
    // Show cached data immediately while fresh data loads
    placeholderData: (previousData) => previousData,
    retry: 1,
  });
};
