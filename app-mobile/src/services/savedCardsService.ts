import { supabase } from "./supabase";

export interface SavedCardRecord {
  id: string;
  profile_id: string;
  experience_id: string;
  title: string | null;
  category: string | null;
  image_url: string | null;
  match_score?: number | null;
  card_data: any;
  created_at: string;
}

export interface SavedCardModel {
  id: string;
  title: string;
  category: string | null;
  categoryIcon?: any;
  image: string | null;
  images: string[];
  rating?: number;
  reviewCount?: number;
  priceRange?: string;
  travelTime?: string;
  description?: string;
  fullDescription?: string;
  address?: string;
  highlights?: string[];
  matchScore?: number;
  socialStats?: {
    views: number;
    likes: number;
    saves: number;
  };
  dateAdded: string;
  source?: "solo" | "collaboration";
  [key: string]: any;
}

const normalizeRecord = (record: SavedCardRecord): SavedCardModel => {
  const cardData = record.card_data || {};
  const fallbackImage = cardData.image || record.image_url || null;

  return {
    ...cardData,
    id: cardData.id || record.experience_id,
    title: cardData.title || record.title || "Saved experience",
    category: cardData.category || record.category,
    image: fallbackImage,
    images:
      cardData.images ||
      (fallbackImage
        ? Array.isArray(fallbackImage)
          ? fallbackImage
          : [fallbackImage]
        : []),
    matchScore: cardData.matchScore ?? record.match_score ?? null,
    dateAdded: cardData.dateAdded || record.created_at,
    source: cardData.source || "solo",
  };
};

export const savedCardsService = {
  async saveCard(profileId: string, card: any) {
    const payload = {
      profile_id: profileId,
      experience_id: card.id,
      title: card.title,
      category: card.category,
      image_url: card.image || (card.images?.[0] ?? null),
      match_score: card.matchScore ?? null,
      card_data: {
        ...card,
        dateAdded: new Date().toISOString(),
        source: card.source || "solo",
      },
    };

    const { error } = await supabase
      .from("saved_card")
      .upsert(payload, { onConflict: "profile_id,experience_id" });

    if (error) {
      if ((error as any).code === "23505") {
        console.warn("Card already saved; skipping duplicate insert");
      } else {
        throw error;
      }
    }
  },

  async removeCard(profileId: string, experienceId: string) {
    const { error } = await supabase
      .from("saved_card")
      .delete()
      .eq("profile_id", profileId)
      .eq("experience_id", experienceId);

    if (error) {
      throw error;
    }
  },

  async fetchSavedCards(profileId: string): Promise<SavedCardModel[]> {
    // Fetch ALL cards saved by the user:
    // 1. Solo mode saves from saved_card table
    // 2. Collaboration/board mode saves from board_saved_cards table
    
    // Fetch cards from saved_card table (solo mode saves)
    const { data: soloCards, error: soloError } = await supabase
      .from("saved_card")
      .select("*")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false });

    if (soloError) {
      console.error("Error fetching solo saved cards:", soloError);
      // Continue with empty array if solo fetch fails - we'll still try board cards
    }

    // Fetch cards from board_saved_cards table (collaboration/board mode saves)
    // Only include cards where this user saved them (saved_by = profileId)
    const { data: boardCards, error: boardError } = await supabase
      .from("board_saved_cards")
      .select(`
        id,
        session_id,
        experience_id,
        saved_experience_id,
        saved_by,
        saved_at,
        card_data,
        collaboration_sessions!inner(name)
      `)
      .eq("saved_by", profileId)
      .order("saved_at", { ascending: false });

    if (boardError) {
      console.error("Error fetching board saved cards:", boardError);
      // Don't throw - continue with solo cards if board fetch fails
    }

    // Normalize solo cards - ensure source is set to "solo"
    const normalizedSoloCards = ((soloCards as SavedCardRecord[]) || []).map((record) => {
      const normalized = normalizeRecord(record);
      return {
        ...normalized,
        source: "solo" as const,
      };
    });

    // Normalize board cards - ensure source is set to "collaboration"
    const normalizedBoardCards = (boardCards || []).map((record: any) => {
      const cardData = record.card_data || {};
      const sessionName = record.collaboration_sessions?.name || "Board Session";

      return {
        ...cardData,
        id:
          cardData.id ||
          record.experience_id ||
          record.saved_experience_id ||
          record.id,
        title: cardData.title || "Saved experience",
        category: cardData.category || null,
        image:
          cardData.image ||
          (Array.isArray(cardData.images) ? cardData.images[0] : null),
        images: cardData.images || (cardData.image ? [cardData.image] : []),
        matchScore: cardData.matchScore ?? null,
        dateAdded: cardData.dateAdded || record.saved_at,
        source: "collaboration" as const,
        sessionName: sessionName,
        sessionId: record.session_id,
      };
    });

    // Combine ALL cards (both solo and collaboration)
    // Deduplicate by experience ID - if same card saved in both solo and board, prefer board version
    // (board version has more context like session name)
    const uniqueCards = new Map<string, SavedCardModel>();
    
    // Add board cards first (they take precedence if duplicate)
    normalizedBoardCards.forEach((card) => {
      if (card.id) {
        uniqueCards.set(card.id, card);
      }
    });
    
    // Add solo cards - include all, even if duplicate (will be overwritten by board version if exists)
    normalizedSoloCards.forEach((card) => {
      if (card.id && !uniqueCards.has(card.id)) {
        uniqueCards.set(card.id, card);
      }
    });

    // Return ALL unique cards sorted by date (most recent first)
    // This includes both solo and collaboration cards saved by the user
    return Array.from(uniqueCards.values()).sort((a, b) => {
      const dateA = new Date(a.dateAdded || 0).getTime();
      const dateB = new Date(b.dateAdded || 0).getTime();
      return dateB - dateA;
    });
  },
};

