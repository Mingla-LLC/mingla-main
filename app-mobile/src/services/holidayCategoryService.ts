import { supabase, supabaseUrl } from "./supabase";
import type { HolidayCardSection } from "../types/holidayTypes";

export interface CategorySlot {
  cardType: "curated" | "single";
  experienceType?: string;
  categorySlug?: string;
  displayLabel: string;
}

/**
 * Calls the generate-holiday-categories edge function to get
 * AI-generated category slots for a given holiday.
 */
export async function fetchHolidayCategories(
  holidayName: string,
  holidayDescription?: string
): Promise<CategorySlot[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const response = await fetch(
    `${supabaseUrl}/functions/v1/generate-holiday-categories`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        holidayName,
        holidayDescription,
      }),
    }
  );

  if (!response.ok) {
    const rawText = await response.text().catch(() => "");
    let errorMessage = `Holiday categories fetch failed (HTTP ${response.status})`;
    try {
      const errorData = JSON.parse(rawText);
      if (errorData.error) errorMessage = errorData.error;
    } catch {
      if (rawText) errorMessage += `: ${rawText.slice(0, 200)}`;
    }
    throw new Error(errorMessage);
  }

  const data = await response.json();
  return data.categories ?? [];
}

/**
 * Converts AI-generated CategorySlots into HolidayCardSections
 * compatible with the existing card system.
 */
export function slotsToSections(slots: CategorySlot[]): HolidayCardSection[] {
  return slots.map((slot) => {
    if (slot.cardType === "curated") {
      const type =
        slot.experienceType === "romantic"
          ? "romantic"
          : slot.experienceType === "adventurous"
          ? "adventurous"
          : "romantic"; // conservative fallback

      return {
        label: slot.displayLabel,
        type,
        experienceType: slot.experienceType,
      } as HolidayCardSection;
    }

    return {
      label: slot.displayLabel,
      type: "category",
      categorySlug: slot.categorySlug,
    } as HolidayCardSection;
  });
}
