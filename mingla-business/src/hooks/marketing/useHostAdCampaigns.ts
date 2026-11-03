/**
 * toward #3697 Wave 7c — brand-scoped Host ad campaigns list.
 */

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../context/AuthContext";
import {
  listHostAdCampaignPage,
  type HostAdCampaign,
  type HostAdListSummary,
} from "../../services/hostAdCampaignService";

export const hostAdCampaignKeys = {
  all: ["host-ad-campaigns"] as const,
  byBrand: (brandId: string | null) =>
    [...hostAdCampaignKeys.all, brandId] as const,
};

export function useHostAdCampaigns(brandId: string | null): {
  campaigns: HostAdCampaign[];
  liveCampaigns: HostAdCampaign[];
  /** #4238 wave 2: this month's spend, budget and results (null: no ads). */
  summary: HostAdListSummary | null;
  isLoading: boolean;
  isError: boolean;
  isRefetching: boolean;
  refetch: () => Promise<unknown>;
} {
  const { isAuthReady } = useAuth();
  const enabled = Boolean(brandId) && isAuthReady;
  const query = useQuery({
    queryKey: hostAdCampaignKeys.byBrand(brandId),
    enabled,
    queryFn: () => listHostAdCampaignPage(brandId as string),
  });
  const campaigns = query.data?.campaigns ?? [];
  const liveCampaigns = campaigns.filter(
    (c) => String(c.status).toUpperCase() === "ACTIVE",
  );
  return {
    campaigns,
    liveCampaigns,
    summary: query.data?.summary ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    isRefetching: query.isRefetching,
    refetch: query.refetch,
  };
}
