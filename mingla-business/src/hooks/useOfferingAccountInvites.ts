import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { marketingKeys } from "./marketing/marketingKeys";
import { getOfferingAccountInvites } from "../services/offeringAccountInvitesService";

/** #3682 wave 2 — followers invited through Mingla for one offering. */
export function useOfferingAccountInvites(eventId: string | null) {
  // auth.uid()-scoped RPC: wait for auth authority (ORCH-1004).
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: marketingKeys.offeringInvites.accountInvites(eventId ?? ""),
    queryFn: () => getOfferingAccountInvites(eventId as string),
    enabled: isAuthReady && eventId !== null && eventId.length > 0,
    staleTime: 30_000,
    retry: 1,
  });
}
