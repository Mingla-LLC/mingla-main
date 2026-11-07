/**
 * useCampaignGroupView — #4273 polish. Every method of one campaign for the
 * campaign screen. Same 30s stale time as useCampaignReport; refreshed by
 * every invalidation of marketingKeys.campaigns.all (the key nests under it).
 */

import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  CampaignNotFoundError,
  getCampaignGroupView,
  type CampaignGroupView,
} from "../../services/marketing/marketingCampaignGroupViewService";
import { marketingKeys } from "./marketingKeys";
import { useAuth } from "../../context/AuthContext";

const STALE_TIME_MS = 30 * 1000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UseCampaignGroupViewState {
  data: CampaignGroupView | undefined;
  isLoading: boolean;
  isError: boolean;
  /** The campaign is missing or not the caller's (one answer for both). */
  notFound: boolean;
  /** False while disabled or before the first fetch (I-DISABLED-QUERY-IS-LOADING). */
  hasResolved: boolean;
  refetch: UseQueryResult<CampaignGroupView>["refetch"];
}

export function useCampaignGroupView(
  campaignId: string | null | undefined,
): UseCampaignGroupViewState {
  const { isAuthReady } = useAuth();
  const enabled =
    isAuthReady && typeof campaignId === "string" && UUID_RE.test(campaignId);
  const query = useQuery<CampaignGroupView>({
    queryKey: enabled
      ? marketingKeys.campaigns.group(campaignId as string)
      : marketingKeys.campaigns.all,
    queryFn: async () => getCampaignGroupView(campaignId as string),
    enabled,
    staleTime: STALE_TIME_MS,
  });
  return useMemo(
    () => ({
      data: query.data,
      isLoading: query.isLoading,
      isError: query.isError,
      notFound: query.error instanceof CampaignNotFoundError,
      hasResolved: query.isFetched,
      refetch: query.refetch,
    }),
    [query.data, query.isLoading, query.isError, query.error, query.isFetched, query.refetch],
  );
}
