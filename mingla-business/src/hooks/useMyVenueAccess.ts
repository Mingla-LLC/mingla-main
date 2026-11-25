import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import type { VenueCapability } from "../services/brandInvitationsService";
import { supabase } from "../services/supabase";
import {
  venueAccessCanKitchen,
  venueAccessCanManageMoney,
  venueAccessCanSell,
} from "../components/venue/venueCapabilityGate";

export interface MyVenueAccess {
  scoped: boolean;
  capabilities: VenueCapability[];
  /**
   * #4490 spec 08 O1 — may sell at the Till here, by the server's rule
   * (`issue_4490_can_sell`): an event manager or above, or venue staff holding
   * venue.sell. Absent (older cached reads, test doubles) reads as no.
   */
  canSell?: boolean;
  /**
   * #4490 spec 08 O3 — may work the kitchen and bar screens here
   * (`issue_4490_can_kitchen`). Absent reads as no.
   */
  canKitchen?: boolean;
  /**
   * #4490 spec 08 O5 part B — may close the day and handle money here
   * (`issue_4490_can_manage_money`). Absent reads as no.
   */
  canManageMoney?: boolean;
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
      if (venueId === null) return { scoped: false, capabilities: [], canSell: false, canKitchen: false, canManageMoney: false };
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
      let role: string | null = null;
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
          role = (member.data as { role?: string } | null)?.role ?? null;
          if (role === "scanner") {
            return { scoped: true, capabilities: ["venue.check_in"], canSell: false, canKitchen: false, canManageMoney: false };
          }
        }
      }
      const capabilities = Array.isArray(row.capabilities)
        ? row.capabilities.filter(
            (capability): capability is VenueCapability =>
              typeof capability === "string",
          )
        : [];
      const scoped = row.scoped === true;
      return {
        scoped,
        capabilities,
        canSell: venueAccessCanSell({ scoped, capabilities, role }),
        canKitchen: venueAccessCanKitchen({ scoped, capabilities, role }),
        canManageMoney: venueAccessCanManageMoney({ scoped, capabilities, role }),
      };
    },
  });
}
