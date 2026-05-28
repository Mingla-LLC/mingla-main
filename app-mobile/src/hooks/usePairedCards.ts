import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { fetchPersonHeroCards } from "../services/personHeroCardsService";
import type { HolidayCardsResponse } from "../services/holidayCardsService";
import type { HolidayCardSection } from "../types/holidayTypes";
import { personCardKeys } from "./queryKeys";

// ── Types ───────────────────────────────────────────────────────────────────

export type PairedCardsMode = "default" | "individual" | "bilateral";

interface UsePairedCardsParams {
  pairedUserId: string;
  holidayKey: string;
  sections: HolidayCardSection[];
  excludeCardIds?: string[];
  // ORCH-0684 D-Q4: explicit user override of bilateral auto-detect.
  // "default" lets the edge fn auto-decide; "individual" forces off; "bilateral" forces on.
  mode?: PairedCardsMode;
  // ORCH-0684 D-Q1: anniversary detection for custom holidays.
  isCustomHoliday?: boolean;
  yearsElapsed?: number;
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
  const mode: PairedCardsMode = params?.mode ?? "default";

  return useQuery<HolidayCardsResponse>({
    queryKey: params
      ? personCardKeys.paired(params.pairedUserId, params.holidayKey, "server-friend-gps", mode)
      : personCardKeys.all,
    queryFn: () =>
      fetchPersonHeroCards({
        pairedUserId: params!.pairedUserId,
        holidayKey: params!.holidayKey,
        categorySlugs: derived!.categorySlugs,
        curatedExperienceType: derived!.curatedExperienceType,
        mode,
        isCustomHoliday: params!.isCustomHoliday,
        yearsElapsed: params!.yearsElapsed,
        excludeCardIds: params!.excludeCardIds,
      }),
    enabled: !!params,
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
      excludeCardIds?: string[],
      isCustomHoliday?: boolean,
      yearsElapsed?: number,
    ): Promise<void> => {
      const { categorySlugs, curatedExperienceType } =
        sectionsToSlugsAndType(sections);

      const result = await fetchPersonHeroCards({
        pairedUserId,
        holidayKey,
        categorySlugs,
        curatedExperienceType,
        mode: "shuffle",
        isCustomHoliday,
        yearsElapsed,
        excludeCardIds,
      });

      // Replace the cached data so the UI updates immediately.
      // ORCH-0684: shuffle writes into the "default"-mode key so the next
      // render in default mode shows the shuffled set; explicit-mode users
      // (individual/bilateral) get their own caches.
      queryClient.setQueryData(
        personCardKeys.paired(pairedUserId, holidayKey, "server-friend-gps", "default"),
        result
      );
    },
    [queryClient]
  );
}
