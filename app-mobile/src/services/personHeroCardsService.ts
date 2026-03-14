import { supabase, supabaseUrl } from "./supabase";
import { HolidayCardsResponse } from "./holidayCardsService";

export async function fetchPersonHeroCards(params: {
  pairedUserId: string;
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
      body: JSON.stringify({
        pairedUserId: params.pairedUserId,
        holidayKey: params.holidayKey,
        categorySlugs: params.categorySlugs,
        curatedExperienceType: params.curatedExperienceType,
        location: params.location,
      }),
    }
  );

  if (!response.ok) {
    const rawText = await response.text().catch(() => "");
    let errorMessage = `Hero cards fetch failed (HTTP ${response.status})`;
    try {
      const errorData = JSON.parse(rawText);
      if (errorData.error) errorMessage = errorData.error;
    } catch {
      if (rawText) errorMessage += `: ${rawText.slice(0, 200)}`;
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  return {
    cards: data.cards ?? [],
    hasMore: data.hasMore ?? false,
  };
}
