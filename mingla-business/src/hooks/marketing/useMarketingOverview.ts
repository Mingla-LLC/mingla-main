/**
 * useMarketingOverview — React Query hook for the Marketing → Overview tab
 * (ORCH-0863). 30s stale window — funnel counters don't change frequently
 * enough to warrant tighter polling.
 */

import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { getMarketingOverview } from "../../services/marketing/marketingOverviewService";
import type { MarketingOverviewSnapshot } from "../../types/marketing";
import { marketingKeys } from "./marketingKeys";

const STALE_TIME_MS = 30 * 1000;

export interface UseMarketingOverviewState {
  data: MarketingOverviewSnapshot | undefined;
  isLoading: boolean;
  isError: boolean;
  /**
   * True once the query has resolved at least one fetch (success OR error).
   * `false` while `enabled: false` (auth bootstrap) AND while the first
   * fetch is in flight. Consumers must treat
   * `!hasResolved && !isError` as a loading state — see
   * I-DISABLED-QUERY-IS-LOADING (ORCH-0889).
   */
  hasResolved: boolean;
  refetch: UseQueryResult<MarketingOverviewSnapshot>["refetch"];
}

export function useMarketingOverview(
  accountId: string | null | undefined,
): UseMarketingOverviewState {
  const enabled = typeof accountId === "string" && accountId.length > 0;
  const query = useQuery<MarketingOverviewSnapshot>({
    queryKey: enabled
      ? marketingKeys.overview.byAccount(accountId as string)
      : marketingKeys.overview.all,
    queryFn: async () => getMarketingOverview({ account_id: accountId as string }),
    enabled,
    staleTime: STALE_TIME_MS,
  });
  return useMemo(
    () => ({
      data: query.data,
      isLoading: query.isLoading,
      isError: query.isError,
      hasResolved: query.isFetched,
      refetch: query.refetch,
    }),
    [query.data, query.isLoading, query.isError, query.isFetched, query.refetch],
  );
}
