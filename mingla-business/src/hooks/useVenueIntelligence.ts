/**
 * ORCH-1186-B — venue intelligence dashboard hook.
 *
 * React Query wrapper over fetchVenueIntelligence. Distinct entity key
 * (`venue-intelligence`) — does NOT share the event-orders / brand-stats keys
 * (avoids cache drift). Gated on auth session + a non-null brandId, mirroring
 * useEventOrders. 60s staleTime: intelligence is not real-time and module
 * switches should not thrash the network.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  fetchVenueIntelligence,
  type VenueIntelligence,
} from "../services/venueIntelligenceService";

export const venueIntelligenceKeys = {
  all: ["venue-intelligence"] as const,
  detail: (brandId: string): readonly ["venue-intelligence", string] =>
    ["venue-intelligence", brandId] as const,
  // META-ORCH-1255(C) D-D — venue-scoped variant. brandId stays FIRST so
  // existing brand-prefix invalidations keep matching via react-query prefix
  // matching (same convention as the Leg B venue-keyed ops keys).
  byVenue: (
    brandId: string,
    venueId: string,
  ): readonly ["venue-intelligence", string, string] =>
    ["venue-intelligence", brandId, venueId] as const,
};

const DISABLED_KEY = ["venue-intelligence-disabled"] as const;

export function useVenueIntelligence(
  brandId: string | null,
  // META-ORCH-1255(C) D-D: the venue in scope; null → server-side
  // single-venue fallback (legacy brand pointer as last resort).
  venueId: string | null = null,
): UseQueryResult<VenueIntelligence> {
  const { loading, session } = useAuth();
  const enabled = !loading && session !== null && brandId !== null;

  return useQuery<VenueIntelligence>({
    queryKey:
      enabled && brandId !== null
        ? venueId !== null
          ? venueIntelligenceKeys.byVenue(brandId, venueId)
          : venueIntelligenceKeys.detail(brandId)
        : DISABLED_KEY,
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      if (brandId === null) throw new Error("brandId missing");
      return fetchVenueIntelligence(brandId, venueId);
    },
  });
}
