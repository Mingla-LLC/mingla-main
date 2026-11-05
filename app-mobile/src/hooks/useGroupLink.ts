/**
 * Issue #4261 Wave B1 — a group chat's link, its join requests, and adding
 * people. Server state lives in React Query only (`groupLinkKeys`); every
 * mutation toasts on failure and rolls back optimistic state (Constitution #3).
 *
 * Realtime: the plan chat channel (`chat-plans:<id>`, Wave B2) invalidates
 * `groupLinkKeys.joinRequests(id)` on any `group_join_requests` change.
 */
import { useCallback, useState } from "react";
import { Share } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import i18n from "../i18n";
import { chatKeys, chatListKeys, friendShareKeys, groupLinkKeys } from "./queryKeys";
import {
  addGroupMembers,
  decideGroupJoinRequest,
  fetchGroupJoinRequests,
  getGroupLink,
  resetGroupLink,
  setGroupLinkApproval,
  type GroupJoinRequestWithNames,
} from "../services/groupLinkService";
import { getFriendShareLink } from "../services/friendShareLinkService";
import { trackedInvoke } from "../services/supabase";
import { buildGroupInviteOneLink } from "../utils/friendShareLink";
import { useAppStore } from "../store/appStore";
import { toastManager } from "../components/ui/Toast";
import type { AddGroupMembersResult, GroupLinkInfo } from "../types/chatPlans";

const GROUP_LINK_STALE_MS = 5 * 60 * 1000;

function failureCopy(error: Error): string {
  if (error.message === "unavailable") return i18n.t("chat:plan_unavailable");
  if (error.message === "not_found") return i18n.t("chat:group_link_reset_toast");
  return i18n.t("chat:plan_action_failed");
}

export function useGroupLink(conversationId: string | null | undefined, enabled = true) {
  return useQuery<GroupLinkInfo>({
    queryKey: groupLinkKeys.link(conversationId ?? ""),
    queryFn: () => getGroupLink(conversationId as string),
    enabled: Boolean(conversationId) && enabled,
    staleTime: GROUP_LINK_STALE_MS,
  });
}

export function useGroupJoinRequests(conversationId: string | null | undefined) {
  return useQuery<GroupJoinRequestWithNames[]>({
    queryKey: groupLinkKeys.joinRequests(conversationId ?? ""),
    queryFn: () => fetchGroupJoinRequests(conversationId as string),
    enabled: Boolean(conversationId),
    staleTime: 30 * 1000,
  });
}

export function useResetGroupLink(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation<{ token: string }, Error, void>({
    mutationFn: () => resetGroupLink(conversationId),
    onSuccess: ({ token }) => {
      queryClient.setQueryData<GroupLinkInfo>(groupLinkKeys.link(conversationId), (old) =>
        old ? { ...old, token } : old,
      );
      void queryClient.invalidateQueries({ queryKey: groupLinkKeys.link(conversationId) });
    },
    onError: (error) => {
      console.warn("[useResetGroupLink] failed:", error.message);
      toastManager.error(failureCopy(error));
    },
  });
}

/** Optimistic toggle; rolls back and toasts on failure. */
export function useSetGroupLinkApproval(conversationId: string) {
  const queryClient = useQueryClient();
  const key = groupLinkKeys.link(conversationId);
  return useMutation<{ requireApproval: boolean }, Error, boolean, { previous: GroupLinkInfo | undefined }>({
    mutationFn: (requireApproval) => setGroupLinkApproval(conversationId, requireApproval),
    onMutate: async (requireApproval) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<GroupLinkInfo>(key);
      queryClient.setQueryData<GroupLinkInfo>(key, (old) => (old ? { ...old, requireApproval } : old));
      return { previous };
    },
    onError: (error, _value, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      console.warn("[useSetGroupLinkApproval] failed:", error.message);
      toastManager.error(failureCopy(error));
    },
    onSuccess: ({ requireApproval }) => {
      queryClient.setQueryData<GroupLinkInfo>(key, (old) => (old ? { ...old, requireApproval } : old));
    },
  });
}

/**
 * Let someone in or decline. For a session group the approver is the inviter
 * of the collaboration invite the server created, so the approver's app sends
 * the existing collab-invite push to the joiner (spec 4.3).
 */
export function useDecideJoinRequest(conversationId: string, groupName: string) {
  const queryClient = useQueryClient();
  const myId = useAppStore((s) => s.user?.id);
  return useMutation<
    { status: string },
    Error,
    { requestId: string; approve: boolean; joinerId: string }
  >({
    mutationFn: async ({ requestId, approve, joinerId }) => {
      const result = await decideGroupJoinRequest(requestId, approve);
      if (approve && result.status === "approved" && result.sessionId && result.inviteId && myId) {
        trackedInvoke("send-collaboration-invite", {
          body: {
            inviterId: myId,
            invitedUserId: joinerId,
            sessionId: result.sessionId,
            sessionName: groupName,
            inviteId: result.inviteId,
          },
        }).catch((err: unknown) => console.warn("[useDecideJoinRequest] invite push failed:", err));
      }
      return result;
    },
    onSuccess: (_result, { approve }) => {
      // The decision posts a join line (approve) or drops the pending row: the
      // Chats list preview follows (#4265 useChatList; factory key only).
      void queryClient.invalidateQueries({ queryKey: chatListKeys.all });
      // Amendment 1 B-4: the header count follows the live member list.
      if (approve) void queryClient.invalidateQueries({ queryKey: chatKeys.participants(conversationId) });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: groupLinkKeys.joinRequests(conversationId) });
    },
    onError: (error) => {
      console.warn("[useDecideJoinRequest] failed:", error.message);
      toastManager.error(
        error.message === "conflict_group_full" ? i18n.t("chat:group_link_full") : failureCopy(error),
      );
    },
  });
}

export function useAddGroupMembers(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation<AddGroupMembersResult, Error, string[]>({
    mutationFn: (userIds) => addGroupMembers(conversationId, userIds),
    onSuccess: (result) => {
      if (result.skipped.length > 0) {
        toastManager.warning(i18n.t("chat:group_add_skipped", { count: result.skipped.length }));
      }
      void queryClient.invalidateQueries({ queryKey: groupLinkKeys.link(conversationId) });
      // Amendment 1 B-4: the header count follows the live member list.
      void queryClient.invalidateQueries({ queryKey: chatKeys.participants(conversationId) });
      // "added X" posts a chat line: the Chats list preview follows.
      void queryClient.invalidateQueries({ queryKey: chatListKeys.all });
    },
    onError: (error) => {
      console.warn("[useAddGroupMembers] failed:", error.message);
      toastManager.error(failureCopy(error));
    },
  });
}

/**
 * Share the group link with MY share token on it (joiners connect to me).
 * Waits for whichever link is not loaded yet; on failure toasts and shares
 * nothing (never a half-formed link).
 */
export function useShareGroupLink(conversationId: string | null | undefined, groupName: string) {
  const queryClient = useQueryClient();
  const userId = useAppStore((s) => s.user?.id);
  const [busy, setBusy] = useState(false);
  const share = useCallback(async (): Promise<void> => {
    if (!conversationId || busy) return;
    setBusy(true);
    let link: string | null = null;
    try {
      const group = await queryClient.fetchQuery({
        queryKey: groupLinkKeys.link(conversationId),
        queryFn: () => getGroupLink(conversationId),
        staleTime: GROUP_LINK_STALE_MS,
      });
      // My share token is optional on the link: if it cannot load, the group
      // link still works (the joiner is just not connected to me).
      const mine = userId
        ? await queryClient
            .fetchQuery({
              queryKey: friendShareKeys.link(userId),
              queryFn: getFriendShareLink,
              staleTime: 10 * 60 * 1000,
            })
            .catch((err: unknown) => {
              console.warn("[useShareGroupLink] personal link failed:", err);
              return null;
            })
        : null;
      link = buildGroupInviteOneLink({
        groupToken: group.token,
        shareToken: mine?.token ?? null,
        referralCode: mine?.referralCode ?? null,
      });
    } catch (error) {
      console.warn("[useShareGroupLink] group link failed:", error);
    }
    setBusy(false);
    if (!link) {
      toastManager.error(i18n.t("chat:plan_action_failed"));
      return;
    }
    try {
      // SHARE-NON-CONTENT:invite
      await Share.share({ message: i18n.t("chat:group_link_share_message", { name: groupName, link }) });
    } catch (error) {
      console.warn("[useShareGroupLink] share sheet failed:", error);
    }
  }, [busy, conversationId, groupName, queryClient, userId]);
  return { share, busy };
}
