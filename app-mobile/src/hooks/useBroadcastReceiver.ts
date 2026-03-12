import { useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { DirectMessage } from '../services/messagingService';

interface UseBroadcastReceiverOptions {
  conversationId: string | null;
  currentUserId: string | null;
  /** Shared ref from ConnectionsPage — tracks all message IDs seen via broadcast */
  broadcastSeenIds: React.MutableRefObject<Set<string>>;
  /** Called when a new message arrives via broadcast from another user */
  onBroadcastMessage: (message: DirectMessage) => void;
}

/**
 * Subscribes to the broadcast channel for instant message delivery.
 *
 * This hook ONLY handles the RECEIVE path. It does NOT:
 * - Call useMessagingRealtime (avoids subscription hijacking)
 * - Send messages (that's ConnectionsPage's handleSendMessage)
 * - Manage message state (that's ConnectionsPage)
 *
 * The broadcast channel name `chat:{conversationId}` is intentionally
 * different from the postgres_changes channel `conversation:{conversationId}`
 * to avoid any collision.
 */
export function useBroadcastReceiver({
  conversationId,
  currentUserId,
  broadcastSeenIds,
  onBroadcastMessage,
}: UseBroadcastReceiverOptions): void {
  const onBroadcastMessageRef = useRef(onBroadcastMessage);
  onBroadcastMessageRef.current = onBroadcastMessage;

  useEffect(() => {
    if (!conversationId || !currentUserId) return;

    const channelName = `chat:${conversationId}`;
    const channel = supabase
      .channel(channelName)
      .on('broadcast', { event: 'new_message' }, (payload) => {
        const msg = payload.payload as DirectMessage;

        // Skip own messages (already shown as optimistic)
        if (msg.sender_id === currentUserId) return;

        // Skip if already seen (dedup)
        if (broadcastSeenIds.current.has(msg.id)) return;

        // Mark as seen and deliver
        broadcastSeenIds.current.add(msg.id);
        onBroadcastMessageRef.current(msg);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, currentUserId]);
}
