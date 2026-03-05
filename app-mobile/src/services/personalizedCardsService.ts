import { supabase } from "./supabase";

// ── Types ───────────────────────────────────────────────────────────────────

export interface PersonalizedCardsParams {
  linkedUserId: string;
  occasion: string;
  location: { latitude: number; longitude: number };
  radius?: number;
  isBirthday?: boolean;
}

export interface PersonalizedCardsResult {
  personalized: boolean;
  totalSwipes: number;
  categoryRanking: Array<{ category: string; score: number }>;
  cards: Array<{
    id: string;
    title: string;
    category: string;
    imageUrl: string | null;
    rating: number | null;
    priceLevel: string | null;
    location: { latitude: number; longitude: number };
    address: string | null;
    googlePlaceId: string;
    cardType?: "curated";
    stops?: Array<{
      name: string;
      category: string;
      address: string;
      imageUrl: string | null;
    }>;
  }>;
}

// ── Service ─────────────────────────────────────────────────────────────────

export async function getPersonalizedCards(
  params: PersonalizedCardsParams
): Promise<PersonalizedCardsResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const response = await fetch(
    `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/get-personalized-cards`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to get personalized cards");
  }

  return response.json();
}
