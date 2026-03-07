import { useQuery } from "@tanstack/react-query";
import { ExperienceGenerationService } from "../services/experienceGenerationService";
import { Recommendation } from "../contexts/RecommendationsContext";

interface UseDiscoverQueryParams {
  userLocation: { lat: number; lng: number } | null;
  enabled?: boolean;
  radius?: number; // Optional radius in meters (default 10km)
}

/**
 * Transform generated experience to Recommendation format for compatibility
 */
const transformToRecommendation = (exp: any): Recommendation => {
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
    strollData: exp.strollData,
    website: exp.website || null,
    phone: exp.phone || null,
  };
};

interface DiscoverExperiencesResult {
  cards: Recommendation[];
  featuredCard: Recommendation | null;
}

/**
 * Fetch discover experiences - one per category based on location only
 * Returns 10 grid cards + 1 separate featured card
 */
const fetchDiscoverExperiences = async (
  location: { lat: number; lng: number },
  radius?: number
): Promise<DiscoverExperiencesResult> => {
  const { cards, featuredCard } = await ExperienceGenerationService.discoverExperiences(
    location,
    radius
  );

  return {
    cards: cards.map(transformToRecommendation),
    featuredCard: featuredCard ? transformToRecommendation(featuredCard) : null,
  };
};

/**
 * React Query hook for fetching discover screen experiences
 * Fetches 10 grid cards (one from each category) + 1 featured card based on user location only
 */
export const useDiscoverQuery = (params: UseDiscoverQueryParams) => {
  const { userLocation, enabled = true, radius } = params;

  const queryKey = [
    "discover-experiences",
    userLocation?.lat,
    userLocation?.lng,
    radius,
  ];

  return useQuery<DiscoverExperiencesResult>({
    queryKey,
    queryFn: () => {
      if (!userLocation) {
        throw new Error("User location is required");
      }
      return fetchDiscoverExperiences(userLocation, radius);
    },
    enabled: enabled && !!userLocation,
    staleTime: 60 * 60 * 1000, // 1 hour - data stays fresh for 1 hour
    gcTime: 24 * 60 * 60 * 1000, // 24 hours - keep in cache for 24 hours
    refetchOnMount: false, // Don't refetch when component mounts if data exists
    refetchOnWindowFocus: false, // Don't refetch on window focus
    placeholderData: (previousData) => previousData,
    retry: 2, // Retry twice on failure
  });
};
