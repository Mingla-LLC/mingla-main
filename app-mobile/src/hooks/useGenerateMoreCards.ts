import { useMutation } from "@tanstack/react-query";
import { getHolidayCardsWithMeta, HolidayCardsResponse } from "../services/holidayCardsService";

export function useGenerateMoreCards() {
  return useMutation<
    HolidayCardsResponse,
    Error,
    {
      personId: string;
      description: string;
      location: { latitude: number; longitude: number };
      linkedUserId?: string;
      excludeCardIds: string[];
    }
  >({
    mutationFn: (params) =>
      getHolidayCardsWithMeta({
        personId: params.personId,
        holidayKey: "generate_more",
        categorySlugs: [],
        location: params.location,
        linkedUserId: params.linkedUserId,
        description: params.description,
        mode: "generate_more",
        excludeCardIds: params.excludeCardIds,
      }),
    onError: (error) => {
      console.error('[useGenerateMoreCards] Generation failed:', error);
    },
  });
}
