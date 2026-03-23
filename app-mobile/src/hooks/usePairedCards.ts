import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { fetchPersonHeroCards } from "../services/personHeroCardsService";
import type { HolidayCardsResponse } from "../services/holidayCardsService";
import type { HolidayCardSection } from "../types/holidayTypes";
import { personCardKeys } from "./queryKeys";

// ── Types ───────────────────────────────────────────────────────────────────

interface UsePairedCardsParams {
  pairedUserId: string;
  holidayKey: string; // "birthday" | holiday.id | customHoliday.id
  location: { latitude: number; longitude: number };
  sections: HolidayCardSection[];
  excludeCardIds?: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isValidLocation(loc: { latitude: number; longitude: number }): boolean {
  return loc.latitude !== 0 || loc.longitude !== 0;
}

function locationKey(loc: { latitude: number; longitude: number }): string {
  // Coarse key — same cache within ~11km. Prevents needless refetch on GPS drift.
  return `${loc.latitude.toFixed(1)},${loc.longitude.toFixed(1)}`;
}

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
  const hasValidLocation = !!params && isValidLocation(params.location);
  const locKey = params ? locationKey(params.location) : "";

  return useQuery<HolidayCardsResponse>({
    queryKey: params
      ? personCardKeys.paired(params.pairedUserId, params.holidayKey, locKey)
      : personCardKeys.all,
    queryFn: () =>
      fetchPersonHeroCards({
        pairedUserId: params!.pairedUserId,
        holidayKey: params!.holidayKey,
        categorySlugs: derived!.categorySlugs,
        curatedExperienceType: derived!.curatedExperienceType,
        location: params!.location,
        mode: "default",
        excludeCardIds: params!.excludeCardIds,
      }),
    enabled: hasValidLocation,
    staleTime: Infinity, // Cards persist until shuffle — no auto-refresh
    gcTime: 24 * 60 * 60 * 1000, // 24h garbage collection
    retry: 2,
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

      const locK = locationKey(location);

      // Replace the cached data so the UI updates immediately
      queryClient.setQueryData(
        personCardKeys.paired(pairedUserId, holidayKey, locK),
        result
      );
    },
    [queryClient]
  );
}
