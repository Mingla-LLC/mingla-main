// Issue #3682 — public follower-count queries. Do not auth-gate these hooks:
// signed-out Explorer and public offering pages render the same aggregate.
import { queryOptions, useQuery } from "@tanstack/react-query";

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

/**
 * The one definition of the batched follower-count query. #4265: shared with the
 * Profile follow list, which starts it as soon as it knows the brand ids.
 */
export function brandFollowerCountsQueryOptions(
  brandIds: readonly string[],
  options?: { staleTime?: number },
) {
  const normalized = [
    ...new Set(brandIds.filter((id) => id.length > 0)),
  ].sort();
  return queryOptions({
    queryKey: brandFollowKeys.followerCounts(normalized),
    queryFn: () => brandFollowerCountService.getCounts(normalized),
    enabled: normalized.length > 0,
    staleTime: options?.staleTime ?? 60_000,
    retry: 1,
  });
}

export function useBrandFollowerCounts(
  brandIds: readonly string[],
  options?: { staleTime?: number },
) {
  return useQuery(brandFollowerCountsQueryOptions(brandIds, options));
}
