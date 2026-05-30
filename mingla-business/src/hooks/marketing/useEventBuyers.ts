/**
 * useEventBuyers — React Query hook for the event-level Buyers tab.
 *
 * Wraps `resolveEventBuyers(eventId)` from the audience service into a
 * query-key-factory-disciplined hook (Constitution #4). Same shape as
 * `useBrandCustomers` — the two hooks are intentionally parallel so the
 * shared `BuyerRow` component renders both with no per-surface branching.
 *
 * SPEC reference: SPEC §5.8 (Event Buyers tab data dependency), §11 T-13.
 * Test target: T-02 event-scoped audience query + T-03 marketing-consent filter.
 */

import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../../context/AuthContext";
import {
  resolveEventBuyers,
  type ResolveBuyersResult,
} from "../../services/marketing/marketingAudienceService";

const STALE_TIME_MS = 60 * 1000;

export const eventBuyersKeys = {
  all: ["marketing", "event-buyers"] as const,
  byEvent: (eventId: string): readonly [string, string, string] =>
    ["marketing", "event-buyers", eventId] as const,
};

export interface UseEventBuyersState {
  data: ResolveBuyersResult | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: UseQueryResult<ResolveBuyersResult>["refetch"];
}

export function useEventBuyers(
  eventId: string | null | undefined,
): UseEventBuyersState {
  // ORCH-1004 — event buyers read auth.uid()-scoped buyer rollups; gate on auth.
  const { isAuthReady } = useAuth();
  const enabled =
    isAuthReady && typeof eventId === "string" && eventId.length > 0;

  const query = useQuery<ResolveBuyersResult>({
    queryKey: enabled
      ? eventBuyersKeys.byEvent(eventId)
      : eventBuyersKeys.all,
    queryFn: async () => {
      return resolveEventBuyers(eventId as string);
    },
    enabled,
    staleTime: STALE_TIME_MS,
  });

  return useMemo(
    () => ({
      data: query.data,
      isLoading: query.isLoading,
      isError: query.isError,
      error: query.error,
      refetch: query.refetch,
    }),
    [query.data, query.isLoading, query.isError, query.error, query.refetch],
  );
}
