import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import type { VenueCapability } from "../services/brandInvitationsService";
import { supabase } from "../services/supabase";

export interface MyVenueAccess {
  scoped: boolean;
  capabilities: VenueCapability[];
}

export function useMyVenueAccess(
  venueId: string | null,
): UseQueryResult<MyVenueAccess> {
  const { isAuthReady } = useAuth();
  // ORCH-1004: protected venue RPCs must wait until the Supabase session is
  // restored, otherwise an RLS-empty pre-auth response can be cached as success.
  const enabled = isAuthReady && venueId !== null && venueId.length > 0;
  return useQuery<MyVenueAccess>({
    queryKey: enabled
      ? ["my-venue-access", venueId]
      : ["my-venue-access", "disabled"],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      if (venueId === null) return { scoped: false, capabilities: [] };
      const { data, error } = await supabase.rpc(
        "issue_4188_my_venue_access",
        { p_venue_id: venueId },
      );
      if (error) throw error;
      const row = data && typeof data === "object"
        ? data as Record<string, unknown>
        : {};
      return {
        scoped: row.scoped === true,
        capabilities: Array.isArray(row.capabilities)
          ? row.capabilities.filter(
              (capability): capability is VenueCapability =>
                typeof capability === "string",
            )
          : [],
      };
    },
  });
}

