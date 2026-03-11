import { useEffect, useRef } from "react";
import { messagingService, DirectMessage } from "../services/messagingService";

/**
 * Subscribes to realtime message events for an active conversation.
 * Uses the existing messagingService.subscribeToConversation() which
 * already handles INSERT/UPDATE/DELETE on the messages table.
 *
 * Call this in any component that displays a conversation's messages.
 */
export function useMessagingRealtime(
  conversationId: string | null | undefined,
  userId: string | null | undefined,
  callbacks?: {
    onMessage?: (message: DirectMessage) => void;
    onMessageUpdated?: (message: DirectMessage) => void;
    onMessageDeleted?: (messageId: string) => void;
  }
) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!conversationId || !userId) return;

    const channel = messagingService.subscribeToConversation(
      conversationId,
      userId,
      {
        onMessage: (msg) => callbacksRef.current?.onMessage?.(msg),
        onMessageUpdated: (msg) => callbacksRef.current?.onMessageUpdated?.(msg),
        onMessageDeleted: (id) => callbacksRef.current?.onMessageDeleted?.(id),
      }
    );

    return () => {
      messagingService.unsubscribeFromConversation(conversationId);
    };
  }, [conversationId, userId]);
}
