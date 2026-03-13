import { useQuery } from "@tanstack/react-query";
import { HolidayCardsResponse } from "../services/holidayCardsService";
import { fetchPersonHeroCards } from "../services/personHeroCardsService";

export const personHeroCardKeys = {
  all: ["person-hero-cards"] as const,
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
    staleTime: Infinity, // Cards persist until user shuffles — never auto-refetch
    gcTime: 60 * 60 * 1000, // Keep in memory for 1 hour
  });
}
