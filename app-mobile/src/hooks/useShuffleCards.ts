import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { personHeroCardKeys } from "./usePersonHeroCards";

/**
 * Shuffles cards for the legacy HolidayRow component (uses personHeroCardKeys).
 * For the new PersonHolidayView, use useShufflePairedCards from usePairedCards.ts instead.
 */
export function useShuffleCards() {
  const queryClient = useQueryClient();

  return useCallback(
    (personId: string, holidayKey: string): Promise<void> => {
      return queryClient.invalidateQueries({
        queryKey: personHeroCardKeys.forPairedUserHoliday(personId, holidayKey),
      });
    },
    [queryClient]
  );
}
