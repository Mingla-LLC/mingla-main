// Issue #3682 — public follower-count queries. Do not auth-gate these hooks:
// signed-out Explorer and public offering pages render the same aggregate.
import { useQuery } from "@tanstack/react-query";

import { brandFollowerCountService } from "../services/brandFollowerCountService";
import { brandFollowKeys } from "./brandFollowKeys";

export function useBrandFollowerCount(brandId: string | null) {
  return useQuery({
    queryKey: brandFollowKeys.followerCount(brandId ?? ""),
    queryFn: () => brandFollowerCountService.getCount(brandId as string),
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
    queryFn: () => brandFollowerCountService.getCounts(normalized),
    enabled: normalized.length > 0,
    staleTime: 60_000,
    retry: 1,
  });
}
