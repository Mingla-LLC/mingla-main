/**
 * useTripHasWebPurchases — predicate hook driving SMS-channel gate in
 * `tripChangeNotifier.deriveTripChannelFlags` (ORCH-0876).
 *
 * Calls server-side `biz_trip_has_web_purchases(p_event_id)` RPC which
 * returns true iff the trip has at least one confirmed order with
 * payment_method ∈ {card, apple_pay, google_pay}. Cached for 5 min —
 * orders churn slowly enough that this staleTime is safe.
 *
 * Mirror of `useEventHasWebPurchases` (`./useEventOrders.ts:205`) but
 * runs server-side (trips don't have a comprehensive useTripOrders hook
 * yet — that ships with ORCH-0875 [Tr4]/Tr3-orders-ledger later).
 *
 * Audit: routes via RPC (not direct table read) so RLS + server-side
 * payment_status filter logic stays canonical.
 */

import { useQuery } from "@tanstack/react-query";

import { supabase } from "../services/supabase";

const HAS_WEB_PURCHASES_STALE_MS = 5 * 60 * 1000;

export const useTripHasWebPurchases = (tripEventId: string | null): boolean => {
  const enabled = tripEventId !== null && tripEventId.length > 0;
  const query = useQuery<boolean, Error>({
    queryKey: enabled
      ? (["trips", "has-web-purchases", tripEventId] as const)
      : (["trips", "has-web-purchases", "__disabled__"] as const),
    enabled,
    staleTime: HAS_WEB_PURCHASES_STALE_MS,
    queryFn: async (): Promise<boolean> => {
      if (!enabled || tripEventId === null) return false;
      const { data, error } = await supabase.rpc("biz_trip_has_web_purchases", {
        p_event_id: tripEventId,
      });
      if (error !== null) throw error;
      return data === true;
    },
  });
  return query.data ?? false;
};
