/**
 * useTripTierAllIn — META-ORCH-1174 Leg B3 [trip-page multi-tier selector].
 *
 * Resolves the SERVER all-in (tax/fee-inclusive) cents per ticket_type for a trip's
 * event, via the single-owner `fetchTierAllInCents` (pg_public_event_tier_allin) the
 * cart + event public page already use (ORCH-1147). Trips ride the SAME engine — the
 * §10 multi-package box DISPLAYS + SUMS this all-in (WYSIWYP, I-PROPOSED-1174-ALLIN-
 * SERVER-SOURCED) instead of the bare base price (which is all trip pages showed
 * pre-Leg-B). Anon-safe: the RPC is a SECURITY DEFINER public read; this page is an
 * anon buyer route, so no auth is required.
 *
 * Returns a Map<ticket_type_id, all_in_cents>; the route threads it into the trip
 * offering adapter so the body never touches a service (I-MOR-0827 isolation).
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { fetchTierAllInCents } from "../services/publicEventsService";

export function useTripTierAllIn(
  eventId: string | null,
): UseQueryResult<Map<string, number>> {
  return useQuery({
    queryKey: ["tripTierAllIn", eventId],
    enabled: eventId !== null && eventId.length > 0,
    // The all-in is stable for the page session (fee/tax config rarely changes mid
    // browse); refetch on remount keeps it fresh enough without spamming the RPC.
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, number>> => {
      if (eventId === null || eventId.length === 0) return new Map();
      return fetchTierAllInCents(eventId);
    },
  });
}
