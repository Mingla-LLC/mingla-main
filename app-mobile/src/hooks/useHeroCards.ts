import { useQuery } from "@tanstack/react-query";
import { getHolidayCardsWithMeta, HolidayCardsResponse } from "../services/holidayCardsService";

export const heroCardKeys = {
  all: ["hero-cards"] as const,
  forPerson: (personId: string) =>
    [...heroCardKeys.all, personId] as const,
};

export function useHeroCards(params: {
  personId: string;
  description: string | null;
  location: { latitude: number; longitude: number };
  linkedUserId?: string;
  enabled: boolean;
}) {
  return useQuery<HolidayCardsResponse>({
    queryKey: heroCardKeys.forPerson(params.personId),
    queryFn: () =>
      getHolidayCardsWithMeta({
        personId: params.personId,
        holidayKey: "hero",
        categorySlugs: ["description_match", "fine_dining", "watch", "play"],
        location: params.location,
        linkedUserId: params.linkedUserId,
        description: params.description ?? undefined,
        mode: "hero",
      }),
    enabled: params.enabled,
    staleTime: 30 * 60 * 1000, // 30 min — matches useHolidayCards
    gcTime: 60 * 60 * 1000, // 1 hour
  });
}
