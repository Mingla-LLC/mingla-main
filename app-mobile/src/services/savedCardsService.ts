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
    const { data, error } = await supabase
      .from("saved_card")
      .select("*")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return (data as SavedCardRecord[]).map(normalizeRecord);
  },
};

