// Issue #679 — consumer isFollowing read + optimistic toggle.
//
// Server-truth status via React Query keyed under the existing "consumerBrand"
// namespace (the consumerBrandKeys factory in useBrandBySlug.ts stays
// untouched — not on the #679 allowlist; the key tuple is defined here).
// Optimistic flip of the status key on mutate, rollback on error (the error
// still rejects the caller's promise), invalidate on settle. Anon: the status
// query is disabled → isFollowing=false; the host gates the tap.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { brandFollowsService } from "../services/brandFollowsService";

export const brandFollowKeys = {
  status: (brandId: string, userId: string) =>
    ["consumerBrand", "follow", brandId, userId] as const,
};

export interface UseBrandFollowResult {
  isFollowing: boolean;
  isPending: boolean;
  /** Resolves with the NEW server-confirmed state; rejects on failure. */
  toggle: () => Promise<boolean>;
}

export function useBrandFollow(
  userId: string | null,
  brandId: string | null,
): UseBrandFollowResult {
  const queryClient = useQueryClient();
  const enabled = !!userId && !!brandId;
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
      // Rollback the optimistic flip; mutateAsync still rejects to the caller.
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
  };
}
