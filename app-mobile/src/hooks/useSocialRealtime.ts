import { useEffect, useRef, useCallback } from "react";
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
    onNewMessage?: () => void;
    onFriendListChange?: () => void;
  }
) {
  const queryClient = useQueryClient();

  // Use refs for callbacks to avoid re-subscribing on every render
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Cache of conversation IDs this user participates in.
  // Used to filter realtime message events — only trigger callback for
  // conversations the user is actually in, instead of every message globally.
  const conversationIdsRef = useRef<Set<string>>(new Set());

  const refreshConversationIds = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from("conversation_participants")
      .select("conversation_id")
      .eq("user_id", userId);
    if (!error && data) {
      conversationIdsRef.current = new Set(data.map((r) => r.conversation_id));
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    // Seed the conversation cache before subscribing
    refreshConversationIds();

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
          table: "friend_links",
          filter: `requester_id=eq.${userId}`,
        },
        () => {
          // Covers: target deletes account → sent request row is deleted,
          // or target accepts/declines → status changes,
          // or target responds to link consent → link_status changes.
          queryClient.invalidateQueries({ queryKey: friendLinkKeys.all });
          queryClient.invalidateQueries({ queryKey: linkConsentKeys.all });
          queryClient.invalidateQueries({ queryKey: savedPeopleKeys.all });
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
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          // Only fire callback if this message belongs to a conversation
          // the current user participates in. This prevents every user from
          // refetching on every message sent anywhere in the app.
          const conversationId = (payload.new as any)?.conversation_id;
          if (conversationId && conversationIdsRef.current.has(conversationId)) {
            callbacksRef.current?.onNewMessage?.();
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation_participants",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          // User joined or left a conversation — refresh the local cache
          refreshConversationIds();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friends",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          callbacksRef.current?.onFriendListChange?.();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calendar_entries",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["calendarEntries", userId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}
