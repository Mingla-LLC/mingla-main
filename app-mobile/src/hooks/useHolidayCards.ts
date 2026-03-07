import { useQuery } from "@tanstack/react-query";
import { getHolidayCards, HolidayCard } from "../services/holidayCardsService";

export const holidayCardKeys = {
  all: ["holiday-cards"] as const,
  forHoliday: (personId: string, holidayKey: string) =>
    [...holidayCardKeys.all, personId, holidayKey] as const,
};

export function useHolidayCards(params: {
  personId: string;
  holidayKey: string;
  categorySlugs: string[];
  location: { latitude: number; longitude: number };
  linkedUserId?: string;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: holidayCardKeys.forHoliday(params.personId, params.holidayKey),
    queryFn: () =>
      getHolidayCards({
        personId: params.personId,
        holidayKey: params.holidayKey,
        categorySlugs: params.categorySlugs,
        location: params.location,
        linkedUserId: params.linkedUserId,
      }),
    enabled: params.enabled,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}
