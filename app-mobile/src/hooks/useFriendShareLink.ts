/**
 * Issue #4261 Wave B1 — my personal invite link (React Query owns it).
 *
 * `friendShareKeys.link(userId)`; 10-minute staleTime (the token only changes
 * on reset, which invalidates it). Reset toasts on failure (Constitution #3).
 */
import { useCallback, useState } from "react";
import { Share } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import i18n from "../i18n";
import { buildFriendShareOneLink } from "../utils/friendShareLink";
import { withTimeout } from "../utils/withTimeout";
import { friendShareKeys } from "./queryKeys";
import { getFriendShareLink, resetFriendShareLink } from "../services/friendShareLinkService";
import { useAppStore } from "../store/appStore";
import { toastManager } from "../components/ui/Toast";
import type { FriendShareLinkInfo, FriendShareLinkReset } from "../types/chatPlans";

const FRIEND_SHARE_STALE_MS = 10 * 60 * 1000;
/** Spec 5.2: the row waits for the link at most this long, then says it failed. */
const SHARE_WAIT_MS = 3000;

export function useFriendShareLink() {
  const userId = useAppStore((s) => s.user?.id);
  return useQuery<FriendShareLinkInfo>({
    queryKey: friendShareKeys.link(userId ?? ""),
    queryFn: getFriendShareLink,
    enabled: Boolean(userId),
    staleTime: FRIEND_SHARE_STALE_MS,
  });
}

export function useResetFriendShareLink() {
  const queryClient = useQueryClient();
  const userId = useAppStore((s) => s.user?.id);
  return useMutation<FriendShareLinkReset, Error, void>({
    mutationFn: () => resetFriendShareLink(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: friendShareKeys.link(userId ?? "") });
    },
    onError: (error) => {
      console.warn("[useResetFriendShareLink] reset failed:", error.message);
      toastManager.error(i18n.t("chat:plan_action_failed"));
    },
  });
}

/**
 * "Share an invite": my personal link, never the bare install link. A tap
 * before the link has loaded waits for it (the row shows a spinner, at most
 * 3 s); if it cannot load, a toast says so and nothing is shared.
 */
export function useSharePersonalInvite() {
  const queryClient = useQueryClient();
  const userId = useAppStore((s) => s.user?.id);
  const [busy, setBusy] = useState(false);
  const share = useCallback(async (): Promise<void> => {
    if (busy) return;
    if (!userId) {
      toastManager.error(i18n.t("connections:af_share_link_failed"));
      return;
    }
    setBusy(true);
    let link: string | null = null;
    try {
      const info = await withTimeout(
        queryClient.fetchQuery({
          queryKey: friendShareKeys.link(userId),
          queryFn: getFriendShareLink,
          staleTime: FRIEND_SHARE_STALE_MS,
        }),
        SHARE_WAIT_MS,
        "friend share link",
      );
      link = buildFriendShareOneLink({ token: info.token, referralCode: info.referralCode });
    } catch (error) {
      console.warn("[useSharePersonalInvite] link failed:", error);
    }
    setBusy(false);
    if (!link) {
      toastManager.error(i18n.t("connections:af_share_link_failed"));
      return;
    }
    try {
      // SHARE-NON-CONTENT:invite
      await Share.share({ message: i18n.t("connections:af_share_message", { link }) });
    } catch (error) {
      // The share sheet being dismissed is not an error; anything else is logged.
      console.warn("[useSharePersonalInvite] share sheet failed:", error);
    }
  }, [busy, queryClient, userId]);
  return { share, busy };
}
