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
  const { isAuthReady, user } = useAuth();
  const userId = user?.id ?? null;
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
      // #4490 P2 — a brand `scanner` is not venue staff (the RPC answers "not
      // scoped"), but may only work the door of every venue of the brand
      // (spec 02 §2.5, Q9): Today and Check-in. The server enforces it too.
      if (row.scoped !== true && userId !== null) {
        const venue = await supabase.from("venue_listings").select("brand_id").eq("id", venueId).maybeSingle();
        const brandId = (venue.data as { brand_id?: string } | null)?.brand_id ?? null;
        if (brandId !== null) {
          const member = await supabase
            .from("brand_team_members")
            .select("role")
            .eq("brand_id", brandId)
            .eq("user_id", userId)
            .is("removed_at", null)
            .maybeSingle();
          if ((member.data as { role?: string } | null)?.role === "scanner") {
            return { scoped: true, capabilities: ["venue.check_in"] };
          }
        }
      }
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
