import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../services/supabase";
import { pairingKeys } from "./usePairings";
import { chatListKeys } from "./queryKeys";
import { DeviceCalendarService } from "../services/deviceCalendarService";
import { CalendarService } from "../services/calendarService";

let nextSocialRealtimeOwner = 0;

/**
 * Subscribes to realtime changes on social tables and invalidates
 * the appropriate React Query caches.
 *
 * Tables subscribed (all in the production supabase_realtime publication):
 *   - conversation_participant_lifecycle (user_id = userId, UPDATE: a removed
 *     chat coming back), on its own channel (see below)
 *   - conversations (UPDATE, no filter: RLS delivers only my chats), on its
 *     own chat-list channel (Issue #4456, see below)
 *   - conversation_participants (user_id = userId)
 *   - friends (user_id = userId)
 *   - calendar_entries (user_id = userId)
 *   - pair_requests (receiver_id = userId — incoming requests)
 *   - pair_requests (sender_id = userId, UPDATE only — outgoing status changes)
 *   - pairings (user_a_id = userId OR user_b_id = userId, via 2 listeners)
 *
 * Issue #4435 / #4275: friend_requests, pending_invites and message_reads are
 * NOT in the publication, and one binding the server cannot serve makes the
 * whole channel deliver nothing. Those three bindings never delivered an event
 * in production and are not bound. Do not add a binding here for a table that
 * is not in supabase_realtime (check pg_publication_tables first); it would
 * silence every listener on this channel.
 */
export const SOCIAL_REALTIME_TABLES: readonly string[] = [
  "conversation_participants",
  "friends",
  "calendar_entries",
  "pair_requests",
  "pairings",
];
export const CHAT_LIFECYCLE_REALTIME_TABLES: readonly string[] = ["conversation_participant_lifecycle"];
/** Issue #4456: the open Chats list's live channel. */
export const CHAT_LIST_LIVE_TABLES: readonly string[] = ["conversations"];
/** Issue #4456: a burst of chat updates refetches the Chats list once. */
export const CHAT_LIST_LIVE_DEBOUNCE_MS = 750;
export function useSocialRealtime(
  userId: string | undefined,
  callbacks?: {
    onFriendListChange?: () => void;
    onPairRequestChange?: () => void;
  }
) {
  const queryClient = useQueryClient();
  const callbacksRef = useRef(callbacks);
  const ownerRef = useRef<number | null>(null);
  const epochRef = useRef(0);
  if (ownerRef.current === null) ownerRef.current = ++nextSocialRealtimeOwner;
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!userId) return;
    const channelEpoch = ++epochRef.current;
    // Issue #4456: one debounced Chats-list refetch shared by every listener
    // below (membership rows change on every read receipt; a burst of sends
    // or reads refetches once).
    let chatListTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshChatListSoon = () => {
      if (chatListTimer) clearTimeout(chatListTimer);
      chatListTimer = setTimeout(() => {
        chatListTimer = null;
        void queryClient.invalidateQueries({ queryKey: chatListKeys.all });
      }, CHAT_LIST_LIVE_DEBOUNCE_MS);
    };

    const channel = supabase
      .channel(`social-realtime-${userId}:${ownerRef.current}:${channelEpoch}`)
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
          // Issue #4456: the Chats list (the old ["messages"] key had no
          // query), debounced: last_read_at changes on every read receipt.
          refreshChatListSoon();
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
      .subscribe();

    // Issue #4435: my own chat-list state, on its OWN channel. When a removed
    // chat comes back (anyone writes in it) the server clears hidden_at on my
    // row; the Chats list refetches so the row returns live. Owner-only RLS
    // limits this to my rows. Kept on its own channel so a fault in any other
    // binding can never silence it again (QA F-1 on #4435: a channel with a
    // binding the server cannot serve delivers no events at all).
    const lifecycleChannel = supabase
      .channel(`chat-lifecycle-${userId}:${ownerRef.current}:${channelEpoch}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_participant_lifecycle",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: chatListKeys.all });
        }
      )
      .subscribe();

    // Issue #4456: the Chats list updates live. Every new message bumps its
    // conversation (last_message_at), and an unsend bumps updated_at, so one
    // UPDATE binding on conversations covers a new chat's first message, a new
    // message in an existing chat, the preview, the order and the unread dot.
    // No filter: RLS delivers only conversations I am in. Debounced so a burst
    // refetches once. On its own channel (the #4435 trap above).
    const chatListChannel = supabase
      .channel(`chat-list-live-${userId}:${ownerRef.current}:${channelEpoch}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
        },
        () => {
          refreshChatListSoon();
        }
      )
      .subscribe();

    return () => {
      if (chatListTimer) clearTimeout(chatListTimer);
      void supabase.removeChannel(channel);
      void supabase.removeChannel(lifecycleChannel);
      void supabase.removeChannel(chatListChannel);
    };
  }, [userId, queryClient]);
}
