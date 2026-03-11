import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../services/supabase";
import { friendLinkKeys, friendLinkIntentKeys, linkConsentKeys } from "./socialQueryKeys";
import { savedPeopleKeys } from "./useSavedPeople";

/**
 * Subscribes to realtime changes on friend_links and friend_requests
 * for the given user, invalidating React Query caches on any change.
 *
 * Call once per screen that displays social data (ConnectionsPage,
 * DiscoverScreen). The onboarding flow has its own subscription in
 * OnboardingFriendsStep and does NOT need this hook.
 */
export function useSocialRealtime(
  userId: string | undefined,
  callbacks?: {
    onFriendRequestChange?: () => void;
    onFriendLinkChange?: () => void;
  }
) {
  const queryClient = useQueryClient();

  // Use refs for callbacks to avoid re-subscribing on every render
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!userId) return;

    const channel: RealtimeChannel = supabase
      .channel(`social-realtime:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friend_links",
          filter: `target_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: friendLinkKeys.all });
          queryClient.invalidateQueries({ queryKey: linkConsentKeys.all });
          callbacksRef.current?.onFriendLinkChange?.();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friend_requests",
          filter: `receiver_id=eq.${userId}`,
        },
        () => {
          callbacksRef.current?.onFriendRequestChange?.();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pending_invites",
          filter: `inviter_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: friendLinkKeys.phoneInvites(userId),
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "saved_people",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: savedPeopleKeys.all });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pending_friend_link_intents",
          filter: `inviter_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: friendLinkIntentKeys.all,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}
