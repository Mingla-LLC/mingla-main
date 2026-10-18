/** Issue #3697 v1.4 — resumable pre-provider Host ad plans. */

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../context/AuthContext";
import {
  type HostAdDraft,
  type HostAdPlanAggregate,
} from "../../services/hostAdPlanService";
import { loadHostAdPlanService } from "../../services/lazyHostAdPlanService";

export function useHostAdPlans(brandId: string | null): {
  plans: HostAdPlanAggregate[];
  drafts: HostAdDraft[];
  isLoading: boolean;
  isError: boolean;
  isRefetching: boolean;
  refetch: () => Promise<unknown>;
} {
  const { isAuthReady } = useAuth();
  const query = useQuery({
    queryKey: ["host-ad-plans", brandId],
    enabled: Boolean(brandId) && isAuthReady,
    queryFn: async () => {
      // Keep the sizeable builder client out of the eager shared web chunk.
      // The Ads list loads it only when the query actually runs; the create
      // route can still use the same cohesive module without Metro hoisting it
      // into every Host visitor's boot payload.
      const { listHostAdWorkspace } = await loadHostAdPlanService();
      return listHostAdWorkspace(brandId as string);
    },
  });
  return {
    plans: query.data?.plans ?? [],
    drafts: query.data?.drafts ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    isRefetching: query.isRefetching,
    refetch: query.refetch,
  };
}
