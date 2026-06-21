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
};

const DISABLED_KEY = ["venue-intelligence-disabled"] as const;

export function useVenueIntelligence(
  brandId: string | null,
): UseQueryResult<VenueIntelligence> {
  const { loading, session } = useAuth();
  const enabled = !loading && session !== null && brandId !== null;

  return useQuery<VenueIntelligence>({
    queryKey:
      enabled && brandId !== null
        ? venueIntelligenceKeys.detail(brandId)
        : DISABLED_KEY,
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      if (brandId === null) throw new Error("brandId missing");
      return fetchVenueIntelligence(brandId);
    },
  });
}
