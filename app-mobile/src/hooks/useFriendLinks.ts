import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as friendLinkService from "../services/friendLinkService";
import { getPendingInvites, cancelPendingInvite } from "../services/phoneLookupService";
import { savedPeopleKeys } from "./useSavedPeople";
import { personalizedCardKeys } from "./usePersonalizedCards";
import { friendLinkKeys, friendLinkIntentKeys, linkConsentKeys } from "./socialQueryKeys";
import { supabase } from "../services/supabase";

// Re-export from shared module so existing imports don't break
export { friendLinkKeys } from "./socialQueryKeys";

export function usePendingLinkRequests(userId: string) {
  return useQuery({
    queryKey: friendLinkKeys.pending(userId),
    queryFn: () => friendLinkService.getPendingLinkRequests(userId),
    enabled: !!userId,
    staleTime: 30 * 1000,
  });
}

export function useSentLinkRequests(userId: string) {
  return useQuery({
    queryKey: friendLinkKeys.sent(userId),
    queryFn: () => friendLinkService.getSentLinkRequests(userId),
    enabled: !!userId,
    staleTime: 30 * 1000,
  });
}

export function useUserSearch(query: string) {
  return useQuery({
    queryKey: friendLinkKeys.search(query),
    queryFn: () => friendLinkService.searchUsers(query),
    enabled: query.length >= 2,
    staleTime: 60 * 1000,
  });
}

export function useSendFriendLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ targetUserId, personId }: { targetUserId: string; personId?: string }) =>
      friendLinkService.sendFriendLink(targetUserId, personId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: friendLinkKeys.all });
      queryClient.invalidateQueries({ queryKey: linkConsentKeys.all });
      queryClient.invalidateQueries({ queryKey: savedPeopleKeys.all });
      queryClient.invalidateQueries({ queryKey: friendLinkIntentKeys.all });
    },
    onError: (error: Error) => {
      console.error('[SendFriendLink] Error:', error.message);
    },
  });
}

export function useRespondToFriendLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      linkId,
      action,
    }: {
      linkId: string;
      action: "accept" | "decline";
    }) => friendLinkService.respondToFriendLink(linkId, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: friendLinkKeys.all });
      queryClient.invalidateQueries({ queryKey: savedPeopleKeys.all });
      queryClient.invalidateQueries({ queryKey: personalizedCardKeys.all });
    },
    onError: (error: Error) => {
      console.error('[RespondToFriendLink] Error:', error.message);
    },
  });
}

export function useUnlinkFriend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: friendLinkService.unlinkFriend,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: friendLinkKeys.all });
      queryClient.invalidateQueries({ queryKey: savedPeopleKeys.all });
    },
    onError: (error: Error) => {
      console.error('[UnlinkFriend] Error:', error.message);
    },
  });
}

export function useCancelLinkRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: friendLinkService.cancelLinkRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: friendLinkKeys.all });
    },
    onError: (error: Error) => {
      console.error('[CancelLinkRequest] Error:', error.message);
    },
  });
}

export function usePendingPhoneInvites(userId: string) {
  return useQuery({
    queryKey: friendLinkKeys.phoneInvites(userId),
    queryFn: () => getPendingInvites(userId),
    enabled: !!userId,
    staleTime: 30 * 1000,
  });
}

export function useCancelPhoneInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelPendingInvite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: friendLinkKeys.all });
    },
    onError: (error: Error) => {
      console.error('[CancelPhoneInvite] Error:', error.message);
    },
  });
}

export function useSendFriendLinkToPhone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      phone_e164,
      personId,
    }: {
      phone_e164: string;
      personId?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke(
        "send-friend-link",
        {
          body: { phone_e164, personId },
        }
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: friendLinkKeys.all });
      queryClient.invalidateQueries({ queryKey: friendLinkIntentKeys.all });
    },
  });
}
