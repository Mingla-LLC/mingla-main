// #3682 Wave 2.3 — buyer-web / Host follow status + optimistic toggle.
// Same contract as app-mobile/src/hooks/useBrandFollow.ts (C7: follow-only
// tap; Following opens a host menu).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { brandFollowsService } from "../services/brandFollowsService";
import { brandFollowKeys } from "./brandFollowKeys";

export { brandFollowKeys } from "./brandFollowKeys";

export interface UseBrandFollowResult {
  isFollowing: boolean;
  isPending: boolean;
  toggle: () => Promise<boolean>;
  follow: () => Promise<void>;
  unfollow: () => Promise<void>;
}

export function useBrandFollow(
  userId: string | null,
  brandId: string | null,
): UseBrandFollowResult {
  const queryClient = useQueryClient();
  // brand_follows is auth.uid()-scoped; wait for a ready session so a cold
  // web load cannot cache an RLS-empty miss as "not following" (ORCH-1004).
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && !!userId && !!brandId;
  const statusKey = brandFollowKeys.status(brandId ?? "", userId ?? "");
  const followerCountKey = brandFollowKeys.followerCount(brandId ?? "");

  const statusQuery = useQuery({
    queryKey: statusKey,
    queryFn: () =>
      brandFollowsService.isFollowing(userId as string, brandId as string),
    enabled,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: async (nextFollowing: boolean): Promise<boolean> => {
      if (!userId || !brandId) {
        throw new Error("brand follow toggle requires a signed-in user");
      }
      if (nextFollowing) {
        await brandFollowsService.followBrand(userId, brandId);
      } else {
        await brandFollowsService.unfollowBrand(userId, brandId);
      }
      return nextFollowing;
    },
    onMutate: async (nextFollowing: boolean) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: statusKey }),
        queryClient.cancelQueries({ queryKey: followerCountKey }),
      ]);
      const previous = queryClient.getQueryData<boolean>(statusKey);
      const previousCount = queryClient.getQueryData<number | null>(
        followerCountKey,
      );
      const previousFollowing = previous ?? statusQuery.data === true;
      const changed = previousFollowing !== nextFollowing;
      queryClient.setQueryData<boolean>(statusKey, nextFollowing);
      if (
        changed &&
        typeof previousCount === "number" &&
        Number.isSafeInteger(previousCount) &&
        previousCount >= 0
      ) {
        queryClient.setQueryData<number>(
          followerCountKey,
          Math.max(0, previousCount + (nextFollowing ? 1 : -1)),
        );
      }
      return { previous, previousCount };
    },
    onError: (_error, _nextFollowing, context) => {
      queryClient.setQueryData<boolean>(statusKey, context?.previous ?? false);
      queryClient.setQueryData(followerCountKey, context?.previousCount);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: statusKey });
      void queryClient.invalidateQueries({ queryKey: followerCountKey });
      void queryClient.invalidateQueries({
        queryKey: brandFollowKeys.followerCountsAll,
      });
    },
  });

  const isFollowing = statusQuery.data === true;

  return {
    isFollowing,
    isPending: mutation.isPending,
    toggle: () => mutation.mutateAsync(!isFollowing),
    follow: async () => {
      if (isFollowing) return;
      await mutation.mutateAsync(true);
    },
    unfollow: async () => {
      if (!isFollowing) return;
      await mutation.mutateAsync(false);
    },
  };
}
