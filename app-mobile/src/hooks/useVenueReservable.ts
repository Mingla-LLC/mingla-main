import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "../services/supabase";

/**
 * useVenueReservable — META-ORCH-1148 sub-ORCH 2.2b (OQ-1).
 * ---------------------------------------------------------------------------
 * Resolves whether a consumer deck place card is a RESERVABLE venue, and (if
 * so) the brand_id + display currency needed to call the availability engine +
 * venue-reservation-create. `placePoolId` is the deck card's `id` (== a
 * place_pool.id uuid). Mirrors useVenueExperiences exactly: disabled (no fetch)
 * when the id is null or not a uuid — Ticketmaster / curated / stroll / picnic
 * cards carry non-uuid ids and must never hit the RPC.
 *
 * The RPC is anon-safe (SECURITY DEFINER, returns ONLY {reservable, brand_id,
 * currency}; brand_id+currency are NULL unless the verified-claimed brand has
 * reservations_enabled). A non-reservable / unclaimed place → reservable:false,
 * brand_id:null → the caller renders NO Reserve affordance (NO dead tap).
 */

export interface VenueReservableRow {
  reservable: boolean;
  brand_id: string | null;
  currency: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const venueReservableKeys = {
  all: ["venueReservable"] as const,
  byPlace: (placePoolId: string) =>
    [...venueReservableKeys.all, placePoolId] as const,
};

async function fetchVenueReservable(
  placePoolId: string,
): Promise<VenueReservableRow> {
  const { data, error } = await supabase.rpc("pg_venue_reservable_for_place", {
    p_place_pool_id: placePoolId,
  });
  if (error !== null) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as
    | VenueReservableRow
    | undefined;
  return (
    row ?? { reservable: false, brand_id: null, currency: null }
  );
}

export function useVenueReservable(
  placePoolId: string | null | undefined,
): UseQueryResult<VenueReservableRow> {
  const enabled =
    typeof placePoolId === "string" && UUID_RE.test(placePoolId);
  return useQuery({
    queryKey: venueReservableKeys.byPlace(placePoolId ?? "none"),
    queryFn: () => fetchVenueReservable(placePoolId as string),
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
