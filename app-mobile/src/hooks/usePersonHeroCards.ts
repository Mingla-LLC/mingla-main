import { useQuery } from "@tanstack/react-query";
import { fetchPersonHeroCards } from "../services/personHeroCardsService";
import type { HolidayCardsResponse } from "../services/holidayCardsService";
import { personCardKeys } from "./queryKeys";

// ── Types ───────────────────────────────────────────────────────────────────

interface UsePersonHeroCardsParams {
  pairedUserId: string;
  holidayKey: string;
  categorySlugs: string[];
  curatedExperienceType: string | null;
  location: { latitude: number; longitude: number };
  enabled: boolean;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function usePersonHeroCards(params: UsePersonHeroCardsParams) {
  const {
    pairedUserId,
    holidayKey,
    categorySlugs,
    curatedExperienceType,
    location,
    enabled,
  } = params;

  return useQuery<HolidayCardsResponse>({
    queryKey: personCardKeys.hero(pairedUserId, holidayKey),
    queryFn: () =>
      fetchPersonHeroCards({
        pairedUserId,
        holidayKey,
        categorySlugs,
        curatedExperienceType,
        location,
      }),
    enabled: enabled && !!pairedUserId && !!holidayKey,
    staleTime: Infinity, // Cards persist until shuffle — no auto-refresh
  });
}
