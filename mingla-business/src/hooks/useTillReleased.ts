/**
 * #4490 spec 08 O1 — the Till's release switch (server flag VENUE_TILL).
 * Fails closed: a stale, offline or signed-out client never offers the Till.
 *
 * Kept apart from useVenueTill so the Features panel does not pull the Till's
 * code, and written without `useQuery` (the flag service is loaded on use and
 * the read is skipped when no query client is mounted) so the panel's render
 * lanes need no extra providers or mocks.
 */

import { useContext, useEffect, useState } from "react";
import { QueryClientContext } from "@tanstack/react-query";

export const TILL_RELEASED_KEY = ["venueTill", "released"] as const;

export function useTillReleased(): boolean {
  const client = useContext(QueryClientContext);
  const [released, setReleased] = useState<boolean>(() => client?.getQueryData(TILL_RELEASED_KEY) === true);
  useEffect(() => {
    if (client === undefined) return undefined;
    let live = true;
    client
      .fetchQuery({
        queryKey: TILL_RELEASED_KEY,
        staleTime: 5 * 60_000,
        queryFn: async () => (await import("../services/featureFlagService")).getFeatureFlag("VENUE_TILL"),
      })
      .then((value) => {
        if (live) setReleased(value === true);
      })
      .catch(() => {
        if (live) setReleased(false);
      });
    return () => {
      live = false;
    };
  }, [client]);
  return released;
}
