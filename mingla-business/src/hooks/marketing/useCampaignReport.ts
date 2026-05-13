/**
 * useCampaignReport — single hook for the campaign report screen.
 * 30s stale time so taps between recipient list rows stay snappy.
 */

import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  getCampaignReport,
  type CampaignReport,
} from "../../services/marketing/marketingReportService";
import { marketingKeys } from "./marketingKeys";

const STALE_TIME_MS = 30 * 1000;

export interface UseCampaignReportState {
  data: CampaignReport | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: UseQueryResult<CampaignReport>["refetch"];
}

export function useCampaignReport(
  campaignId: string | null | undefined,
): UseCampaignReportState {
  const enabled = typeof campaignId === "string" && campaignId.length > 0;
  const query = useQuery<CampaignReport>({
    queryKey: enabled
      ? marketingKeys.campaigns.byId(campaignId as string)
      : marketingKeys.campaigns.all,
    queryFn: async () => getCampaignReport(campaignId as string),
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
