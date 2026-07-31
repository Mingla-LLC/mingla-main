import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { getFeatureFlag } from "../services/featureFlagService";

export const featureFlagKeys = {
  all: ["feature-flags"] as const,
  detail: (flagKey: string) => [...featureFlagKeys.all, flagKey] as const,
};

export function useFeatureFlag(flagKey: string): UseQueryResult<boolean> {
  const { isAuthReady, user } = useAuth();
  return useQuery({
    queryKey: featureFlagKeys.detail(flagKey),
    enabled: isAuthReady && user !== null,
    staleTime: 30_000,
    queryFn: () => getFeatureFlag(flagKey),
  });
}
