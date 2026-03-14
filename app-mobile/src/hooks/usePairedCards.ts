import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { fetchPersonHeroCards } from "../services/personHeroCardsService";
import type { HolidayCardsResponse } from "../services/holidayCardsService";
import type { HolidayCardSection } from "../types/holidayTypes";

// ── Query Keys ──────────────────────────────────────────────────────────────

export const pairedCardKeys = {
  all: ["paired-cards"] as const,
  forOccasion: (pairedUserId: string, holidayKey: string) =>
    ["paired-cards", pairedUserId, holidayKey] as const,
};

// ── Types ───────────────────────────────────────────────────────────────────

interface UsePairedCardsParams {
  pairedUserId: string;
  holidayKey: string; // "birthday" | holiday.id | customHoliday.id
  location: { latitude: number; longitude: number };
  sections: HolidayCardSection[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function sectionsToSlugsAndType(sections: HolidayCardSection[]): {
  categorySlugs: string[];
  curatedExperienceType: string | null;
} {
  const categorySlugs: string[] = [];
  let curatedExperienceType: string | null = null;

  for (const section of sections) {
    if (section.type === "category" && section.categorySlug) {
      categorySlugs.push(section.categorySlug);
    } else if (section.type === "romantic") {
      categorySlugs.push("romantic");
      if (!curatedExperienceType) curatedExperienceType = "romantic";
    } else if (section.type === "adventurous") {
      categorySlugs.push("adventurous");
      if (!curatedExperienceType) curatedExperienceType = "adventurous";
    } else if (section.type === "friendly") {
      categorySlugs.push("friendly");
      if (!curatedExperienceType) curatedExperienceType = "friendly";
    }
  }

  // Ensure at least one category slug
  if (categorySlugs.length === 0) {
    categorySlugs.push("fine_dining", "play", "watch");
  }

  return { categorySlugs, curatedExperienceType };
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function usePairedCards(params: UsePairedCardsParams | null) {
  const derived = params ? sectionsToSlugsAndType(params.sections) : null;

  return useQuery<HolidayCardsResponse>({
    queryKey: params
      ? pairedCardKeys.forOccasion(params.pairedUserId, params.holidayKey)
      : pairedCardKeys.all,
    queryFn: () =>
      fetchPersonHeroCards({
        pairedUserId: params!.pairedUserId,
        holidayKey: params!.holidayKey,
        categorySlugs: derived!.categorySlugs,
        curatedExperienceType: derived!.curatedExperienceType,
        location: params!.location,
        mode: "default",
      }),
    enabled: !!params,
    staleTime: Infinity, // Sticky until shuffle
    gcTime: 24 * 60 * 60 * 1000, // 24h garbage collection
  });
}

// ── Shuffle helper ──────────────────────────────────────────────────────────

/**
 * Returns a callback that fetches cards with `mode: "shuffle"` and
 * replaces the React Query cache for that occasion.
 * Unlike simple cache invalidation, this ensures the edge function
 * receives the shuffle flag for personalization gating.
 */
export function useShufflePairedCards() {
  const queryClient = useQueryClient();

  return useCallback(
    async (
      pairedUserId: string,
      holidayKey: string,
      sections: HolidayCardSection[],
      location: { latitude: number; longitude: number }
    ): Promise<void> => {
      const { categorySlugs, curatedExperienceType } =
        sectionsToSlugsAndType(sections);

      const result = await fetchPersonHeroCards({
        pairedUserId,
        holidayKey,
        categorySlugs,
        curatedExperienceType,
        location,
        mode: "shuffle",
      });

      // Replace the cached data so the UI updates immediately
      queryClient.setQueryData(
        pairedCardKeys.forOccasion(pairedUserId, holidayKey),
        result
      );
    },
    [queryClient]
  );
}
