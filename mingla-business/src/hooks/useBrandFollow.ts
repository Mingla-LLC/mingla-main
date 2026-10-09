// #3682 Wave 2.3 — buyer-web / Host follow status + optimistic toggle.
// Same contract as app-mobile/src/hooks/useBrandFollow.ts (C7: follow-only
// tap; Following opens a host menu).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { brandFollowsService } from "../services/brandFollowsService";

export const brandFollowKeys = {
  status: (brandId: string, userId: string) =>
    ["buyerBrand", "follow", brandId, userId] as const,
};

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
      await queryClient.cancelQueries({ queryKey: statusKey });
      const previous = queryClient.getQueryData<boolean>(statusKey);
      queryClient.setQueryData<boolean>(statusKey, nextFollowing);
      return { previous };
    },
    onError: (_error, _nextFollowing, context) => {
      queryClient.setQueryData<boolean>(statusKey, context?.previous ?? false);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: statusKey });
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
