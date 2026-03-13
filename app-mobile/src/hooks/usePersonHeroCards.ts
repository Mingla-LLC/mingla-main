import { useQuery } from "@tanstack/react-query";
import { HolidayCardsResponse } from "../services/holidayCardsService";
import { fetchPersonHeroCards } from "../services/personHeroCardsService";

// Bump this version whenever the Card response shape changes.
// This forces all cached data to be ignored after a deployment that
// changes the schema, preventing stale-shape data from being served.
const CACHE_VERSION = "v2";

export const personHeroCardKeys = {
  all: ["person-hero-cards", CACHE_VERSION] as const,
  forPersonHoliday: (personId: string, holidayKey: string) =>
    [...personHeroCardKeys.all, personId, holidayKey] as const,
};

interface UsePersonHeroCardsParams {
  personId: string;
  holidayKey: string;
  categorySlugs: string[];
  curatedExperienceType: string | null;
  location: { latitude: number; longitude: number };
  enabled: boolean;
}

export function usePersonHeroCards(params: UsePersonHeroCardsParams) {
  return useQuery<HolidayCardsResponse>({
    queryKey: personHeroCardKeys.forPersonHoliday(
      params.personId,
      params.holidayKey
    ),
    queryFn: () =>
      fetchPersonHeroCards({
        personId: params.personId,
        holidayKey: params.holidayKey,
        categorySlugs: params.categorySlugs,
        curatedExperienceType: params.curatedExperienceType,
        location: params.location,
      }),
    enabled: params.enabled,
    staleTime: 30 * 60 * 1000, // 30 min — matches other hooks, ensures fresh data after deploys
    gcTime: 60 * 60 * 1000,    // Keep in memory for 1 hour
  });
}
