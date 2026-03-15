import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../services/supabase";
import { pairingKeys } from "./usePairings";

/**
 * Subscribes to realtime changes on social tables and invalidates
 * the appropriate React Query caches.
 *
 * Tables subscribed (all server-side filtered):
 *   - friend_requests (receiver_id = userId)
 *   - pending_invites (inviter_id = userId)
 *   - messages (receiver_id = userId)
 *   - conversation_participants (user_id = userId)
 *   - friends (user_id = userId)
 *   - calendar_entries (user_id = userId)
 *   - pair_requests (receiver_id = userId)
 *   - pairings (user_a_id = userId OR user_b_id = userId, via 2 listeners)
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
      // messages — filtered to receiver only (sender already has the message)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `receiver_id=eq.${userId}`,
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
      // pairings: two server-side filtered subscriptions instead of
      // one unfiltered subscription with client-side filtering.
      // Supabase realtime supports single-column eq filters per listener.
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pairings",
          filter: `user_a_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: pairingKeys.pills(userId),
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pairings",
          filter: `user_b_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: pairingKeys.pills(userId),
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}
