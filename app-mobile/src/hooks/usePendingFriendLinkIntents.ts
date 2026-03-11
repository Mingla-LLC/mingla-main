import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getPendingFriendLinkIntents,
  cancelFriendLinkIntent,
} from "../services/pendingFriendLinkIntentService";
import { friendLinkKeys } from "./useFriendLinks";

export const friendLinkIntentKeys = {
  all: ["friend-link-intents"] as const,
  pending: (userId: string) =>
    [...friendLinkIntentKeys.all, "pending", userId] as const,
};

export function usePendingFriendLinkIntents(userId: string | undefined) {
  return useQuery({
    queryKey: friendLinkIntentKeys.pending(userId!),
    queryFn: () => getPendingFriendLinkIntents(userId!),
    enabled: !!userId,
    staleTime: 30_000,
  });
}

export function useCancelFriendLinkIntent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelFriendLinkIntent,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: friendLinkIntentKeys.all,
      });
      queryClient.invalidateQueries({ queryKey: friendLinkKeys.all });
    },
  });
}
