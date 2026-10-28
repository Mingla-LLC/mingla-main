/**
 * Issue #2829 W4 — the PUBLIC trip guide read (`pg_public_trip_guide`) the
 * buyer web and Business trip page draw from. Anon-tolerant by design (the
 * buyer-web trip page is anonymous): no auth gate. A failed read hides the
 * guide (the trip page never waits on it) and is logged, never swallowed.
 * Key from the trip key factory (tripKeys.publicGuide).
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "../services/supabase";
import { tripKeys } from "./useTrips";

const GUIDE_STALE_MS = 60 * 1000;

export const fetchPublicTripGuide = async (tripId: string): Promise<unknown> => {
  const { data, error } = await supabase.rpc("pg_public_trip_guide", {
    p_trip_id: tripId,
  });
  if (error !== null) throw error;
  return data ?? null;
};

export const usePublicTripGuide = (
  tripId: string | null,
): UseQueryResult<unknown, Error> =>
  useQuery<unknown, Error>({
    queryKey: tripId !== null ? tripKeys.publicGuide(tripId) : tripKeys.public(),
    queryFn: async () => {
      try {
        return await fetchPublicTripGuide(tripId as string);
      } catch (error) {
        console.warn("[usePublicTripGuide] guide read failed; the guide is hidden", {
          tripId,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    enabled: tripId !== null,
    staleTime: GUIDE_STALE_MS,
    retry: 1,
  });
