/**
 * useCampaigns — paginated campaign list with optional status filter.
 * Constitution #4 (query key factory) + #5 (server state via React Query).
 */

import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { listCampaigns } from "../../services/marketing/marketingCampaignService";
import { marketingKeys } from "./marketingKeys";
import type { CampaignStatus, MarketingCampaignRow } from "../../types/marketing";

const STALE_TIME_MS = 30 * 1000;

export interface UseCampaignsState {
  data: MarketingCampaignRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: UseQueryResult<MarketingCampaignRow[]>["refetch"];
}

export function useCampaigns(input: {
  account_id: string | null | undefined;
  status?: CampaignStatus;
}): UseCampaignsState {
  const enabled =
    typeof input.account_id === "string" && input.account_id.length > 0;
  const query = useQuery<MarketingCampaignRow[]>({
    queryKey: enabled
      ? marketingKeys.campaigns.list(input.account_id as string, input.status)
      : marketingKeys.campaigns.all,
    queryFn: async () =>
      listCampaigns({
        account_id: input.account_id as string,
        status: input.status,
      }),
    enabled,
    staleTime: STALE_TIME_MS,
  });

  return useMemo(
    () => ({
      data: query.data,
      isLoading: query.isLoading,
      isError: query.isError,
      refetch: query.refetch,
    }),
    [query.data, query.isLoading, query.isError, query.refetch],
  );
}
