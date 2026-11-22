/**
 * #4548 — the Guest pack card's read. A read error hides the card (the ticket
 * and its QR are never blocked); it is logged, not toasted.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { fetchMyEventGuestPack } from "../services/guestPackService";
import type { GuestPackData } from "../utils/guestPackDisplay";
import { purchaseKeys } from "./queryKeys";

export function useMyEventGuestPack(
  userId: string | null,
  eventId: string | null,
  enabled: boolean,
): UseQueryResult<GuestPackData | null, Error> {
  return useQuery<GuestPackData | null, Error>({
    queryKey: purchaseKeys.guestPack(userId ?? "none", eventId ?? "none"),
    queryFn: async () => {
      try {
        return await fetchMyEventGuestPack(eventId as string);
      } catch (error) {
        console.error("[guest-pack] read failed", error);
        throw error;
      }
    },
    enabled: enabled && userId !== null && eventId !== null,
    // A live edit shows on the next refresh: refetch when the ticket is opened.
    staleTime: 0,
    retry: 1,
  });
}
