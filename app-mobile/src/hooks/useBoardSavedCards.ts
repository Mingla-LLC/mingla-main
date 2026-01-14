import { useQuery } from "@tanstack/react-query";
import { BoardCardService } from "../services/boardCardService";

interface SavedCard {
  id: string;
  title: string;
  category: string;
  categoryIcon: any;
  image: string;
  images: string[];
  rating: number;
  reviewCount: number;
  priceRange: string;
  travelTime: string;
  description: string;
  fullDescription: string;
  address: string;
  highlights: string[];
  matchScore: number;
  socialStats: {
    views: number;
    likes: number;
    saves: number;
  };
  dateAdded: string;
  source: "collaboration";
  sessionName?: string;
  purchaseOptions?: Array<{
    id: string;
    title: string;
    price: number;
    currency: string;
    description: string;
    features: string[];
    popular?: boolean;
  }>;
}

const transformBoardCard = (
  boardCard: any,
  sessionName?: string,
  sessionId?: string
): SavedCard => {
  const cardData = boardCard.card_data || boardCard.experience_data || {};
  return {
    id: cardData.id || boardCard.id,
    title: cardData.title || cardData.name || "Untitled",
    category: cardData.category || cardData.type || "Experience",
    categoryIcon: cardData.categoryIcon || null,
    image: cardData.image || cardData.images?.[0] || "",
    images: cardData.images || [cardData.image || ""],
    rating: cardData.rating || 0,
    reviewCount: cardData.reviewCount || cardData.reviews || 0,
    priceRange: cardData.priceRange || cardData.price || "$",
    travelTime: cardData.travelTime || "",
    description: cardData.description || "",
    fullDescription: cardData.fullDescription || cardData.description || "",
    address: cardData.address || cardData.location || "",
    highlights: cardData.highlights || [],
    matchScore: cardData.matchScore || 0,
    socialStats: {
      views: cardData.socialStats?.views || 0,
      likes: cardData.socialStats?.likes || 0,
      saves: cardData.socialStats?.saves || 0,
    },
    dateAdded: boardCard.saved_at || new Date().toISOString(),
    source: "collaboration" as const,
    sessionName,
    sessionId: boardCard.session_id || sessionId, // Include session_id from boardCard
    purchaseOptions: cardData.purchaseOptions || [],
  };
};

const fetchBoardSavedCards = async (
  sessionId: string | null | undefined,
  sessionName?: string
): Promise<SavedCard[]> => {
  if (!sessionId) {
    return [];
  }

  try {
    const { data, error } =
      await BoardCardService.getSessionSavedCards(sessionId);

    if (error) {
      console.error("Error fetching board saved cards:", error);
      return [];
    }

    return (data || []).map((boardCard: any) =>
      transformBoardCard(boardCard, sessionName, sessionId)
    );
  } catch (error) {
    console.error("Error fetching board saved cards:", error);
    return [];
  }
};

export const useBoardSavedCards = (
  sessionId: string | null | undefined,
  sessionName?: string,
  enabled: boolean = true
) => {
  return useQuery({
    queryKey: ["boardSavedCards", sessionId],
    queryFn: async () => await fetchBoardSavedCards(sessionId, sessionName),
    enabled: enabled && !!sessionId,
    staleTime: 30000, // Consider data fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
  });
};

