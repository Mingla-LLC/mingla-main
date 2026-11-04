// #3682 wave 3 (#1782) — Friends of followers controls: server state in
// React Query under the brand-follow key factory (cleared on logout with the
// rest of the cache). Mutations write through the RPCs and refresh the read;
// errors are returned to the caller, which shows them.
import { Platform } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  friendsReachService,
  type FriendsReachPlatform,
  type FriendsReachState,
} from "../services/friendsReachService";
import { brandFollowKeys } from "./brandFollowKeys";

export function friendsReachPlatform(
  os: string = Platform.OS,
): FriendsReachPlatform {
  if (os === "ios") return "ios";
  if (os === "android") return "android";
  return "web";
}

export interface UseFriendsReachResult {
  state: FriendsReachState | null;
  /** True only once the server says this build's controls are live. */
  controlsLive: boolean;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  setEnabled: (enabled: boolean) => Promise<void>;
  setBrandStopped: (
    brandId: string,
    stopped: boolean,
    unfollow?: boolean,
  ) => Promise<void>;
  isSaving: boolean;
}

export function useFriendsReach(
  userId: string | null,
  enabled = true,
): UseFriendsReachResult {
  const queryClient = useQueryClient();
  const platform = friendsReachPlatform();
  const key = brandFollowKeys.friendsReach(userId ?? "");

  const query = useQuery({
    queryKey: key,
    queryFn: () => friendsReachService.get(platform),
    enabled: enabled && !!userId,
    staleTime: 60_000,
  });

  const toggle = useMutation({
    mutationFn: (next: boolean) => friendsReachService.setEnabled(platform, next),
    onMutate: async (next: boolean) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<FriendsReachState>(key);
      if (previous) {
        queryClient.setQueryData<FriendsReachState>(key, {
          ...previous,
          extendedEnabled: next,
        });
      }
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: (fresh) => {
      queryClient.setQueryData(key, fresh);
    },
  });

  const stop = useMutation({
    mutationFn: (input: { brandId: string; stopped: boolean; unfollow: boolean }) =>
      friendsReachService.setBrandStopped(input.brandId, input.stopped, input.unfollow),
    onSettled: (_data, _error, input) => {
      void queryClient.invalidateQueries({ queryKey: key });
      if (userId && input) {
        void queryClient.invalidateQueries({ queryKey: brandFollowKeys.list(userId) });
        void queryClient.invalidateQueries({
          queryKey: brandFollowKeys.status(input.brandId, userId),
        });
        void queryClient.invalidateQueries({
          queryKey: brandFollowKeys.followerCount(input.brandId),
        });
        void queryClient.invalidateQueries({ queryKey: brandFollowKeys.followerCountsAll });
      }
    },
  });

  return {
    state: query.data ?? null,
    controlsLive: query.data?.controlsLive === true,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
    setEnabled: async (next) => {
      await toggle.mutateAsync(next);
    },
    setBrandStopped: async (brandId, stopped, unfollow = false) => {
      await stop.mutateAsync({ brandId, stopped, unfollow });
    },
    isSaving: toggle.isPending || stop.isPending,
  };
}
