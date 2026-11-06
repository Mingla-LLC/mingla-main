import { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { DirectMessage } from '../services/messagingService';
import { chatChannelBus } from '../utils/chatChannelRecovery';

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
  // Issue #4275: bumped by the recovery controller when the server closed this
  // channel for good (the library does not rejoin after that).
  const [rebuildNonce, setRebuildNonce] = useState(0);

  useEffect(() => {
    if (!conversationId) return undefined;
    return chatChannelBus.subscribe((event) => {
      if (event.kind === 'rebuild' && event.source === 'broadcast' && event.conversationId === conversationId) {
        setRebuildNonce((nonce) => nonce + 1);
      }
    });
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || !currentUserId) return;

    // Issue #4275: removeChannel fires CLOSED synchronously, so a deliberate
    // release must be marked first or it reads as a failure.
    let released = false;
    const channelName = `chat:${conversationId}`;
    const channel = supabase
      .channel(channelName)
      .on('broadcast', { event: 'new_message' }, (payload) => {
        const msg = payload.payload as DirectMessage;

        // Skip own messages (already shown as optimistic).
        if (msg.sender_id === currentUserId) return;

        // ORCH-0664 (I-DEDUP-AFTER-DELIVERY): defensive double-fire dedup ONLY.
        // The seen-set's authoritative population happens INSIDE the delegate
        // (ConnectionsPage's addIncomingMessageToUI), AFTER the message is added
        // to UI state. This invariant prevents the postgres_changes backup path
        // from being silently skipped when the broadcast delegate is a no-op.
        // The CI gate in scripts/ci-check-invariants.sh forbids any seen-set
        // mutation calls inside this file — population is the delegate's job.
        if (broadcastSeenIds.current.has(msg.id)) return;

        // Deliver — delegate is responsible for both UI state mutation AND
        // seen-set add as a coupled operation.
        onBroadcastMessageRef.current(msg);
      })
      .subscribe((status) => {
        if (released) return;
        chatChannelBus.emit({ kind: 'status', source: 'broadcast', conversationId, status });
      });

    return () => {
      released = true;
      supabase.removeChannel(channel);
    };
  }, [conversationId, currentUserId, rebuildNonce]);
}
