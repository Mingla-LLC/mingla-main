import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { personHeroCardKeys } from "./usePersonHeroCards";

export function useShuffleCards() {
  const queryClient = useQueryClient();

  return useCallback(
    (personId: string, holidayKey: string): Promise<void> => {
      return queryClient.invalidateQueries({
        queryKey: personHeroCardKeys.forPersonHoliday(personId, holidayKey),
      });
    },
    [queryClient]
  );
}
