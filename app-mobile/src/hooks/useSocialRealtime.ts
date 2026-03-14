import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../services/supabase";
import { pairingKeys } from "./usePairings";

/**
 * Subscribes to realtime changes on social tables and invalidates
 * the appropriate React Query caches.
 *
 * Tables subscribed:
 *   - friend_requests (receiver_id = userId)
 *   - pending_invites (inviter_id = userId)
 *   - messages (all, filtered in callback)
 *   - conversation_participants (user_id = userId)
 *   - friends (user_id = userId and friend_user_id = userId)
 *   - calendar_entries (user_id = userId)
 *   - pair_requests (receiver_id = userId)
 *   - pairings (all, filtered in callback for user_a_id or user_b_id)
 */
export function useSocialRealtime(
  userId: string | undefined,
  callbacks?: {
    onFriendRequestChange?: () => void;
    onNewMessage?: () => void;
    onFriendListChange?: () => void;
    onPairRequestChange?: () => void;
  }
) {
  const queryClient = useQueryClient();
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`social-realtime-${userId}`)
      // friend_requests: incoming requests
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friend_requests",
          filter: `receiver_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["friends"] });
          callbacksRef.current?.onFriendRequestChange?.();
        }
      )
      // pending_invites
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pending_invites",
          filter: `inviter_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["friends"] });
        }
      )
      // messages
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["messages"] });
          callbacksRef.current?.onNewMessage?.();
        }
      )
      // conversation_participants
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation_participants",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["messages"] });
        }
      )
      // friends
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friends",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["friends"] });
          callbacksRef.current?.onFriendListChange?.();
        }
      )
      // calendar_entries
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calendar_entries",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["calendarEntries"] });
        }
      )
      // pair_requests: incoming pair requests
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pair_requests",
          filter: `receiver_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: pairingKeys.incomingRequests(userId),
          });
          queryClient.invalidateQueries({
            queryKey: pairingKeys.pills(userId),
          });
          callbacksRef.current?.onPairRequestChange?.();
        }
      )
      // pairings: subscribe to all changes, filter in callback
      // (Supabase realtime only supports single filter per subscription)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pairings",
        },
        (payload) => {
          const record = (payload.new as any) || (payload.old as any);
          if (
            record &&
            (record.user_a_id === userId || record.user_b_id === userId)
          ) {
            queryClient.invalidateQueries({
              queryKey: pairingKeys.pills(userId),
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}
