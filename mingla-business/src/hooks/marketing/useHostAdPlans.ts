/** Issue #3697 v1.4 — resumable pre-provider Host ad plans. */

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../../context/AuthContext";
import {
  listHostAdPlans,
  type HostAdPlanAggregate,
} from "../../services/hostAdPlanService";

export function useHostAdPlans(brandId: string | null): {
  plans: HostAdPlanAggregate[];
  isLoading: boolean;
  isError: boolean;
  isRefetching: boolean;
  refetch: () => Promise<unknown>;
} {
  const { isAuthReady } = useAuth();
  const query = useQuery({
    queryKey: ["host-ad-plans", brandId],
    enabled: Boolean(brandId) && isAuthReady,
    queryFn: () => listHostAdPlans(brandId as string),
  });
  return {
    plans: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    isRefetching: query.isRefetching,
    refetch: query.refetch,
  };
}
