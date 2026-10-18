/**
 * toward #3697 Wave 7c — brand-scoped Host ad campaigns list.
 */

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../context/AuthContext";
import {
  listHostAdCampaigns,
  type HostAdCampaign,
} from "../../services/hostAdCampaignService";

export const hostAdCampaignKeys = {
  all: ["host-ad-campaigns"] as const,
  byBrand: (brandId: string | null) =>
    [...hostAdCampaignKeys.all, brandId] as const,
};

export function useHostAdCampaigns(brandId: string | null): {
  campaigns: HostAdCampaign[];
  liveCampaigns: HostAdCampaign[];
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
    queryFn: () => listHostAdCampaigns(brandId as string),
  });
  const campaigns = query.data ?? [];
  const liveCampaigns = campaigns.filter(
    (c) => String(c.status).toUpperCase() === "ACTIVE",
  );
  return {
    campaigns,
    liveCampaigns,
    isLoading: query.isLoading,
    isError: query.isError,
    isRefetching: query.isRefetching,
    refetch: query.refetch,
  };
}
