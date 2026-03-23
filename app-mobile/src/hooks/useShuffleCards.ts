import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { personCardKeys } from "./queryKeys";

/**
 * Shuffles cards for the legacy HolidayRow component (uses personCardKeys).
 * For the new PersonHolidayView, use useShufflePairedCards from usePairedCards.ts instead.
 */
export function useShuffleCards() {
  const queryClient = useQueryClient();

  return useCallback(
    (personId: string, holidayKey: string): Promise<void> => {
      return queryClient.invalidateQueries({
        queryKey: personCardKeys.hero(personId, holidayKey),
      });
    },
    [queryClient]
  );
}
