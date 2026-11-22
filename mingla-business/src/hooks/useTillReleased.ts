/**
 * #4490 spec 08 O1 — the Till's release switch (server flag VENUE_TILL).
 * Fails closed: a stale or offline client never offers the Till. Kept apart
 * from useVenueTill so the Features panel does not pull the Till's code.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { getFeatureFlag } from "../services/featureFlagService";

export const TILL_RELEASED_KEY = ["venueTill", "released"] as const;

export function useTillReleased(): UseQueryResult<boolean> {
  const { isAuthReady } = useAuth();
  return useQuery<boolean>({
    queryKey: TILL_RELEASED_KEY,
    enabled: isAuthReady,
    staleTime: 5 * 60_000,
    queryFn: () => getFeatureFlag("VENUE_TILL"),
  });
}
