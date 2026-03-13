import { supabase, supabaseUrl } from "./supabase";
import { HolidayCardsResponse } from "./holidayCardsService";

export async function fetchPersonHeroCards(params: {
  personId: string;
  holidayKey: string;
  categorySlugs: string[];
  curatedExperienceType: string | null;
  location: { latitude: number; longitude: number };
}): Promise<HolidayCardsResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const response = await fetch(
    `${supabaseUrl}/functions/v1/get-person-hero-cards`,
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
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to fetch hero cards");
  }

  const data = await response.json();
  return {
    cards: data.cards ?? [],
    hasMore: data.hasMore ?? false,
  };
}
