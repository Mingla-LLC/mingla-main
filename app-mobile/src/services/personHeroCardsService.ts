import { supabase } from "./supabase";

// ── Types ───────────────────────────────────────────────────────────────────

export interface HeroCard {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  category: string | null;
  price: number | null;
  rating: number | null;
  source: string | null;
  url: string | null;
  metadata: Record<string, any> | null;
}

export interface HolidayCardsResponse {
  cards: HeroCard[];
  holidayKey: string;
  totalCount: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getAuthToken(): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return token;
}

// ── Service Functions ───────────────────────────────────────────────────────

/**
 * Fetch hero cards for a paired user's holiday.
 */
export async function fetchPersonHeroCards(params: {
  pairedUserId: string;
  holidayKey: string;
  categorySlugs: string[];
  curatedExperienceType: string | null;
  location: { latitude: number; longitude: number };
}): Promise<HolidayCardsResponse> {
  const token = await getAuthToken();

  const response = await fetch(
    `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/get-person-hero-cards`,
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

  const text = await response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Unexpected response from server: ${text}`);
  }

  if (!response.ok) {
    throw new Error(parsed.error || parsed.message || "Failed to fetch hero cards");
  }

  return parsed;
}
