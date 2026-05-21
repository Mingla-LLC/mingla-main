import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../services/supabase";
import { pairingKeys } from "./usePairings";
import { DeviceCalendarService } from "../services/deviceCalendarService";
import { CalendarService } from "../services/calendarService";

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
 *   - pair_requests (receiver_id = userId — incoming requests)
 *   - pair_requests (sender_id = userId, UPDATE only — outgoing status changes)
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
        async (payload: any) => {
          queryClient.invalidateQueries({ queryKey: ["calendarEntries"] });

          // ORCH-0908 rework (2026-05-21): auto-add collab entries to device
          // calendar when they receive a real scheduled_at via the
          // rpc_admin_lock_and_schedule_card path. Best-effort — silently
          // skips when permissions are denied; the chat card message's
          // "Add to Calendar" button is the manual fallback.
          //
          // Guards:
          //   - source='collaboration' (avoid auto-adding solo entries,
          //     which already have their own explicit schedule flow)
          //   - scheduled_at set (skip the trigger-inserted placeholder
          //     pending rows where scheduled_at IS NULL)
          //   - device_calendar_event_id NULL (idempotent — never re-add)
          //   - event INSERT or UPDATE (handles both initial insert from
          //     the trigger AND the schedule RPC's overwrite that flips
          //     status pending→confirmed with the real scheduled_at)
          const row = payload?.new;
          if (
            row &&
            row.source === "collaboration" &&
            row.scheduled_at &&
            !row.device_calendar_event_id
          ) {
            try {
              const event = DeviceCalendarService.createEventFromCard(
                row.card_data || {},
                new Date(row.scheduled_at),
                row.duration_minutes || 120,
              );
              const deviceEventId =
                await DeviceCalendarService.addEventToDeviceCalendar(event);
              if (deviceEventId) {
                await CalendarService.updateEntry(row.id, userId, {
                  device_calendar_event_id: deviceEventId,
                });
              }
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(
                "[ORCH-0908] auto-add to device calendar failed:",
                msg,
              );
            }
          }
        }
      )
      // pair_requests: incoming pair requests (receiver sees new/changed requests)
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
      // pair_requests: outgoing pair requests (sender sees accept/decline/visibility changes)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "pair_requests",
          filter: `sender_id=eq.${userId}`,
        },
        () => {
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
      // message_reads: DM unread count updates when a message is marked as read
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reads",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['conversations'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}
