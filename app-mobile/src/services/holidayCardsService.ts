import { supabase, supabaseUrl } from "./supabase";

export interface HolidayCard {
  id: string;
  title: string;
  category: string;
  categorySlug: string;
  imageUrl: string | null;
  rating: number | null;
  priceLevel: string | null;
  address: string | null;
  googlePlaceId: string | null;
  lat: number | null;
  lng: number | null;
}

export async function getHolidayCards(params: {
  personId: string;
  holidayKey: string;
  categorySlugs: string[];
  location: { latitude: number; longitude: number };
  linkedUserId?: string;
}): Promise<HolidayCard[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const response = await fetch(
    `${supabaseUrl}/functions/v1/get-holiday-cards`,
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
    throw new Error(errorData.error || "Failed to fetch holiday cards");
  }

  const data = await response.json();
  return data.cards ?? [];
}
