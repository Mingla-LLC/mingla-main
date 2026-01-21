import { supabase } from "./supabase";
import { ExpandedCardData } from "../types/expandedCardTypes";

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

  async removeCard(
    profileId: string,
    experienceId: string,
    source?: "solo" | "collaboration",
    sessionId?: string
  ) {
    try {
      console.log(
        "Removing card from saved_cards service",
        profileId,
        experienceId,
        source,
        sessionId
      );

      // If source is specified, only delete from that specific mode
      if (source === "solo") {
        const { error } = await supabase
          .from("saved_card")
          .delete()
          .eq("profile_id", profileId)
          .eq("experience_id", experienceId);

        if (error) {
          console.error("Error removing card from saved_card:", error);
          throw error;
        }
        return;
      }

      if (source === "collaboration") {
        // Query by card_data->>'id' since experience_id is UUID and may be null
        // The Google Places ID is stored in card_data JSONB
        // IMPORTANT: Also filter by session_id to ensure we delete from the correct session
        let query = supabase
          .from("board_saved_cards")
          .delete()
          .eq("saved_by", profileId)
          .eq("card_data->>id", experienceId);

        // Add session_id filter if provided
        if (sessionId) {
          query = query.eq("session_id", sessionId);
        }

        const { error } = await query;

        if (error) {
          console.error("Error removing card from board_saved_cards:", error);
          throw error;
        }
        console.log("Card removed from board_saved_cards");
        return;
      }

      // If source is undefined, try solo first, then board only if solo fails
      // Try solo mode first
      const { error: soloErr } = await supabase
        .from("saved_card")
        .delete()
        .eq("profile_id", profileId)
        .eq("experience_id", experienceId);

      if (soloErr) {
        console.log("Error removing card from saved_card:", soloErr);
        // Only try board mode if solo failed
        let query = supabase
          .from("board_saved_cards")
          .delete()
          .eq("saved_by", profileId)
          .eq("card_data->>id", experienceId);

        // Add session_id filter if provided to ensure we delete from the correct session
        if (sessionId) {
          query = query.eq("session_id", sessionId);
        }

        const { error: boardErr } = await query;

        if (boardErr) {
          console.error(
            "Error removing card from board_saved_cards:",
            boardErr
          );
          // Both failed, throw the last error
          throw boardErr;
        }
        // Board deletion succeeded, that's fine
      }
      // Solo deletion succeeded, no need to try board
    } catch (error) {
      console.error("Error in removeCard:", error);
      throw error;
    }
  },

  async fetchSavedCards(profileId: string): Promise<SavedCardModel[]> {
    // Fetch ALL cards saved by the user:
    // 1. Solo mode saves from saved_card table
    // 2. Collaboration/board mode saves from board_saved_cards table

    // Fetch cards from saved_card table (solo mode saves)
    // PAGINATION: For now, fetch only 1 card
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
    // PAGINATION: For now, fetch only 1 card
    const { data: boardCards, error: boardError } = await supabase
      .from("board_saved_cards")
      .select(
        `
        id,
        session_id,
        experience_id,
        saved_experience_id,
        saved_by,
        saved_at,
        card_data,
        collaboration_sessions!inner(name)
      `
      )
      .eq("saved_by", profileId)
      .order("saved_at", { ascending: false });

    if (boardError) {
      console.error("Error fetching board saved cards:", boardError);
      // Don't throw - continue with solo cards if board fetch fails
    }

    // Normalize solo cards - ensure source is set to "solo"
    const normalizedSoloCards = ((soloCards as SavedCardRecord[]) || []).map(
      (record) => {
        const normalized = normalizeRecord(record);
        return {
          ...normalized,
          source: "solo" as const,
        };
      }
    );

    // Normalize board cards - ensure source is set to "collaboration"
    const normalizedBoardCards = (boardCards || []).map((record: any) => {
      const cardData = record.card_data || {};
      const sessionName =
        record.collaboration_sessions?.name || "Board Session";
      /* console.log("cardDataP", cardData.picnicData) */
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

  async updateCardStrollData(
    profileId: string,
    cardData: ExpandedCardData,
    strollData: ExpandedCardData["strollData"],
    source: "solo" | "collaboration",
    sessionId?: string
  ) {
    try {
      // Merge strollData into the existing card data
      const updatedCardData = {
        ...cardData,
        strollData,
      };

      if (source === "solo") {
        const { error: updateError } = await supabase
          .from("saved_card")
          .update({ card_data: updatedCardData })
          .eq("profile_id", profileId)
          .eq("experience_id", cardData.id);

        if (updateError) {
          console.error("Error updating solo card stroll data:", updateError);
          throw updateError;
        }

        return;
      }

      if (source === "collaboration") {
        let updateQuery = supabase
          .from("board_saved_cards")
          .update({ card_data: updatedCardData })
          .eq("saved_by", profileId)
          .eq("card_data->>id", cardData.id);

        if (sessionId) {
          updateQuery = updateQuery.eq("session_id", sessionId);
        }

        const { error: updateError } = await updateQuery;

        if (updateError) {
          console.error("Error updating board card stroll data:", updateError);
          throw updateError;
        }

        return;
      }
    } catch (error) {
      console.error("Error in updateCardStrollData:", error);
      throw error;
    }
  },

  async updateCardPicnicData(
    profileId: string,
    cardData: ExpandedCardData,
    picnicData: ExpandedCardData["picnicData"],
    source: "solo" | "collaboration",
    sessionId?: string
  ) {
    try {
      // Merge picnicData into the existing card data
      // Ensure location is preserved - it should be in cardData.location
      const updatedCardData = {
        ...cardData,
        picnicData,
        // Explicitly preserve location if it exists in cardData
        location: cardData.location,
      };
      if (source === "solo") {
        const { error: updateError } = await supabase
          .from("saved_card")
          .update({ card_data: updatedCardData })
          .eq("profile_id", profileId)
          .eq("experience_id", cardData.id);

        if (updateError) {
          console.error("Error updating solo card picnic data:", updateError);
          throw updateError;
        }

        return;
      }

      if (source === "collaboration") {

        let updateQuery = supabase
          .from("board_saved_cards")
          .update({ card_data: updatedCardData })
          .eq("saved_by", profileId)
          .eq("card_data->>id", cardData.id);

        if (sessionId) {
          updateQuery = updateQuery.eq("session_id", sessionId);
        }

        const { error: updateError } = await updateQuery;

        if (updateError) {
          console.error("Error updating board card picnic data:", updateError);
          throw updateError;
        }

        return;
      }
    } catch (error) {
      console.error("Error in updateCardPicnicData:", error);
      throw error;
    }
  },
};
