// Issue #3682 — public aggregate reads. These must remain available to anon
// buyer-web pages, so this hook intentionally does not wait for auth readiness.
import { useQuery } from "@tanstack/react-query";

import { brandFollowKeys } from "./brandFollowKeys";

export function useBrandFollowerCount(brandId: string | null) {
  return useQuery({
    queryKey: brandFollowKeys.followerCount(brandId ?? ""),
    queryFn: async () =>
      (
        await import("../services/brandFollowerCountService")
      ).brandFollowerCountService.getCount(brandId as string),
    enabled: !!brandId,
    staleTime: 60_000,
    retry: 1,
  });
}

export function useBrandFollowerCounts(brandIds: readonly string[]) {
  const normalized = [
    ...new Set(brandIds.filter((id) => id.length > 0)),
  ].sort();
  return useQuery({
    queryKey: brandFollowKeys.followerCounts(normalized),
    queryFn: async () =>
      (
        await import("../services/brandFollowerCountService")
      ).brandFollowerCountService.getCounts(normalized),
    enabled: normalized.length > 0,
    staleTime: 60_000,
    retry: 1,
  });
}
