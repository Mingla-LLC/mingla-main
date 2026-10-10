// Issue #679 / #3682 — consumer isFollowing read + optimistic toggle + mute.
//
// Server-truth status via React Query keyed under the existing "consumerBrand"
// namespace. Optimistic flip of the status key on mutate, rollback on error.
// Anon: the status query is disabled → isFollowing=false; the host gates the tap.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  brandFollowIsMuted,
  brandFollowsService,
  type MuteDuration,
} from "../services/brandFollowsService";

export type BrandFollowStatus = {
  following: boolean;
  mutedUntil: string | null;
};

export const brandFollowKeys = {
  status: (brandId: string, userId: string) =>
    ["consumerBrand", "follow", brandId, userId] as const,
  list: (userId: string) => ["consumerBrand", "followList", userId] as const,
};

export interface UseBrandFollowResult {
  isFollowing: boolean;
  isMuted: boolean;
  mutedUntil: string | null;
  isPending: boolean;
  /** Resolves with the NEW server-confirmed state; rejects on failure. */
  toggle: () => Promise<boolean>;
  /** Follow only (idempotent). */
  follow: () => Promise<void>;
  /** Unfollow only (idempotent). */
  unfollow: () => Promise<void>;
  mute: (duration: MuteDuration) => Promise<void>;
  unmute: () => Promise<void>;
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
      brandFollowsService.getFollowStatus(userId as string, brandId as string),
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
      const previous = queryClient.getQueryData<BrandFollowStatus>(statusKey);
      queryClient.setQueryData<BrandFollowStatus>(statusKey, {
        following: nextFollowing,
        mutedUntil: nextFollowing ? (previous?.mutedUntil ?? null) : null,
      });
      return { previous };
    },
    onError: (_error, _nextFollowing, context) => {
      queryClient.setQueryData<BrandFollowStatus>(
        statusKey,
        context?.previous ?? { following: false, mutedUntil: null },
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: statusKey });
      if (userId) {
        void queryClient.invalidateQueries({
          queryKey: brandFollowKeys.list(userId),
        });
      }
    },
  });

  const muteMutation = useMutation({
    mutationFn: async (duration: MuteDuration) => {
      if (!userId || !brandId) throw new Error("mute requires signed-in user");
      return brandFollowsService.muteBrand(userId, brandId, duration);
    },
    onMutate: async (duration) => {
      await queryClient.cancelQueries({ queryKey: statusKey });
      const previous = queryClient.getQueryData<BrandFollowStatus>(statusKey);
      const until =
        duration === "indefinite"
          ? "infinity"
          : new Date(
              Date.now() +
                (duration === "week" ? 7 : 30) * 24 * 60 * 60 * 1000,
            ).toISOString();
      queryClient.setQueryData<BrandFollowStatus>(statusKey, {
        following: true,
        mutedUntil: until,
      });
      return { previous };
    },
    onError: (_e, _d, context) => {
      if (context?.previous) {
        queryClient.setQueryData(statusKey, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: statusKey });
      if (userId) {
        void queryClient.invalidateQueries({
          queryKey: brandFollowKeys.list(userId),
        });
      }
    },
  });

  const unmuteMutation = useMutation({
    mutationFn: async () => {
      if (!userId || !brandId) throw new Error("unmute requires signed-in user");
      await brandFollowsService.unmuteBrand(userId, brandId);
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: statusKey });
      const previous = queryClient.getQueryData<BrandFollowStatus>(statusKey);
      queryClient.setQueryData<BrandFollowStatus>(statusKey, {
        following: true,
        mutedUntil: null,
      });
      return { previous };
    },
    onError: (_e, _v, context) => {
      if (context?.previous) {
        queryClient.setQueryData(statusKey, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: statusKey });
      if (userId) {
        void queryClient.invalidateQueries({
          queryKey: brandFollowKeys.list(userId),
        });
      }
    },
  });

  const status = statusQuery.data;
  const isFollowing = status?.following === true;
  const mutedUntil = status?.mutedUntil ?? null;
  const isMuted = isFollowing && brandFollowIsMuted(mutedUntil);

  return {
    isFollowing,
    isMuted,
    mutedUntil,
    isPending:
      mutation.isPending || muteMutation.isPending || unmuteMutation.isPending,
    toggle: () => mutation.mutateAsync(!isFollowing),
    follow: async () => {
      if (isFollowing) return;
      await mutation.mutateAsync(true);
    },
    unfollow: async () => {
      if (!isFollowing) return;
      await mutation.mutateAsync(false);
    },
    mute: async (duration) => {
      await muteMutation.mutateAsync(duration);
    },
    unmute: async () => {
      await unmuteMutation.mutateAsync();
    },
  };
}
