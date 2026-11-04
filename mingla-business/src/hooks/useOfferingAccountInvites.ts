import { useQuery } from "@tanstack/react-query";

import { marketingKeys } from "./marketing/marketingKeys";
import { getOfferingAccountInvites } from "../services/offeringAccountInvitesService";

/** #3682 wave 2 — followers invited through Mingla for one offering. */
export function useOfferingAccountInvites(eventId: string | null) {
  return useQuery({
    queryKey: marketingKeys.offeringInvites.accountInvites(eventId ?? ""),
    queryFn: () => getOfferingAccountInvites(eventId as string),
    enabled: eventId !== null && eventId.length > 0,
    staleTime: 30_000,
    retry: 1,
  });
}
