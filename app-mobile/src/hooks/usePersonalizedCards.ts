import { useQuery } from "@tanstack/react-query";
import {
  getPersonalizedCards,
  PersonalizedCardsParams,
} from "../services/personalizedCardsService";

export const personalizedCardKeys = {
  all: ["personalized-cards"] as const,
  forPerson: (linkedUserId: string, occasion: string) =>
    [...personalizedCardKeys.all, linkedUserId, occasion] as const,
};

export function usePersonalizedCards(params: PersonalizedCardsParams | null) {
  return useQuery({
    queryKey: params
      ? personalizedCardKeys.forPerson(params.linkedUserId, params.occasion)
      : personalizedCardKeys.all,
    queryFn: () => getPersonalizedCards(params!),
    enabled: !!params,
    staleTime: 10 * 60 * 1000,
  });
}
