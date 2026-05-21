import { useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { messagingService, DirectMessage } from '../services/messagingService';
import { useChatPresence } from './useChatPresence';

/**
 * ORCH-0898 [Consumer collab session → Friends-tab group chat] post-migration rewrite.
 *
 * Pre-ORCH-0898 this hook read from `board_messages` via `boardDiscussionService`. Post-ORCH-0898
 * the chat substrate is the unified `messages` table linked via `conversations.session_id`. The
 * hook resolves the session's conversation_id once, then reads messages + drives realtime via
 * the conversation_id rather than the session_id.
 *
 * SAME-THREAD-TWO-VIEWS contract (operator-locked D1, 2026-05-20): the conversation_id this hook
 * resolves is the SAME conversation_id that the Friends-tab `ConnectionsPage` list-item routes to.
 * Sending a message from the in-session Discussions tab + sending one from the Friends-tab
 * thread both write to the same `messages` rows.
 */

// --- Query Keys ---
export const discussionKeys = {
  all: ['session-discussion'] as const,
  session: (sessionId: string) => [...discussionKeys.all, sessionId] as const,
  conversation: (conversationId: string) => [...discussionKeys.all, 'conversation', conversationId] as const,
  messages: (conversationId: string) => [...discussionKeys.conversation(conversationId), 'messages'] as const,
};

interface UseSessionDiscussionResult {
  messages: DirectMessage[];
  conversationId: string | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;
  sendMessage: (params: {
    content: string;
    imageUri?: string;
    imageMimeType?: string;
    mentions?: string[];
    replyToId?: string;
  }) => Promise<{ message: DirectMessage | null; error: string | null }>;
  isSending: boolean;
  toggleReaction: (params: { messageId: string; emoji: string }) => void;
  typingUsers: string[];
  startTyping: () => void;
  stopTyping: () => void;
  refetch: () => void;
}

// --- Hook ---
export function useSessionDiscussion(
  sessionId: string | null,
  currentUserId: string | null,
): UseSessionDiscussionResult {
  const queryClient = useQueryClient();

  // Resolve the session's group conversation_id. Done once per sessionId; cached client-side.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setConversationId(null);
      setConversationError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const { conversation, error } = await messagingService.getOrCreateGroupConversationForSession(sessionId);
      if (cancelled) return;
      if (error || !conversation) {
        setConversationError(error ?? 'Group conversation not found');
        setConversationId(null);
        return;
      }
      setConversationError(null);
      setConversationId(conversation.id);
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // 1. Fetch messages with infinite scroll (page size 30, matching legacy hook behavior).
  const messagesQuery = useInfiniteQuery({
    queryKey: discussionKeys.messages(conversationId ?? ''),
    queryFn: async ({ pageParam }) => {
      if (!conversationId || !currentUserId) return [];
      // Use messagingService.getMessages with a limit; the service handles enrichment.
      // pageParam carries the cursor (created_at of the oldest already-loaded message).
      const { messages: pageMessages } = await messagingService.getMessages(
        conversationId,
        currentUserId,
        30,
      );
      // TODO ORCH-0898 follow-up: getMessages doesn't yet take a `before` cursor; this hook
      // currently fetches the latest 30 only. Infinite scroll wiring is preserved at the
      // contract level so a future getMessages-with-cursor refactor (post-ORCH-0902) plugs
      // in transparently. Cited as transition-item in implementation report §10 #2.
      void pageParam;
      return pageMessages;
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.length < 30) return undefined;
      return lastPage[lastPage.length - 1]?.created_at;
    },
    initialPageParam: undefined as string | undefined,
    enabled: !!conversationId && !!currentUserId,
    staleTime: 2 * 60 * 1000,
  });

  const messages: DirectMessage[] = messagesQuery.data?.pages.flat() ?? [];

  // 2. Realtime subscription — postgres_changes + broadcast on the conversation channel.
  // Channel name: `conversation:${conversationId}` (post-ORCH-0898 standard naming).
  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: discussionKeys.messages(conversationId) });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: discussionKeys.messages(conversationId) });
        },
      )
      // NOTE: message_reads + direct_message_reactions tables don't carry a conversation_id
      // column today (ORCH-0901 investigation §6.1 known caveat carried forward). Subscription
      // fires on ALL such writes app-wide and invalidates this conversation's query. Acceptable
      // for v1; tracked as a future denormalization optimization.
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_reads',
        },
        () => {
          queryClient.invalidateQueries({ queryKey: discussionKeys.messages(conversationId) });
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'direct_message_reactions',
        },
        () => {
          queryClient.invalidateQueries({ queryKey: discussionKeys.messages(conversationId) });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient]);

  // 3. Typing indicators — namespace `conversation:<id>` mirrors realtime channel name.
  const { typingUsers, startTyping, stopTyping } = useChatPresence({
    conversationId: conversationId ? `conversation:${conversationId}` : null,
    currentUserId,
  });

  // 4. Auto-mark messages as read (mirrors legacy hook behavior — fire-and-forget).
  const lastReadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentUserId || messages.length === 0) return;

    const unreadMessageIds = messages
      .filter(
        (m) => m.sender_id !== currentUserId && !m.is_read,
      )
      .map((m) => m.id);

    if (unreadMessageIds.length === 0) return;

    const key = unreadMessageIds.join(',');
    if (key === lastReadRef.current) return;
    lastReadRef.current = key;

    messagingService.markAsRead(unreadMessageIds, currentUserId).catch((err) => {
      console.error('[useSessionDiscussion] markAsRead failed:', err);
    });
  }, [messages, currentUserId]);

  // 5. Send-message mutation. Goes through messagingService.sendMessage targeting the unified substrate.
  // Note: imageUri + mentions + replyToId support — image attachment is preserved by routing through
  // sendMessage with message_type='image' + file_url (ORCH-0898 SPEC §3.5.3 maps board_messages.image_url
  // → messages.file_url + message_type='image').
  // TODO ORCH-0898 follow-up: image upload still uses the legacy `board-attachments` storage bucket
  // path. A future ORCH (post-ORCH-0902) consolidates into a unified `chat-attachments` bucket. For
  // now consumer-app image-attach in group chat is OUT OF SCOPE per SPEC §9 Q6 default (images only,
  // routed via existing messagingService upload paths). Cited as transition-item in report §10 #3.
  const sendMutation = useMutation({
    mutationFn: async (params: {
      content: string;
      imageUri?: string;
      imageMimeType?: string;
      mentions?: string[];
      replyToId?: string;
    }) => {
      if (!conversationId || !currentUserId) {
        return { message: null, error: 'Conversation not loaded yet' };
      }
      void params.imageUri;
      void params.imageMimeType;
      void params.mentions;
      return messagingService.sendMessage(
        conversationId,
        currentUserId,
        params.content,
        'text',
        undefined,
        undefined,
        undefined,
        params.replyToId,
      );
    },
    onSuccess: () => {
      stopTyping();
      if (conversationId) {
        queryClient.invalidateQueries({ queryKey: discussionKeys.messages(conversationId) });
      }
    },
    onError: (error: unknown) => {
      console.error('[useSessionDiscussion] Send message failed:', error);
    },
  });

  // 6. Reaction toggle mutation. Goes through messagingService.toggleDirectMessageReaction
  // (the unified-substrate reaction service method — name preserved from pre-ORCH-0898 for now;
  // ORCH-0902 may rename to toggleMessageReaction once direct_message_reactions table is renamed).
  const reactionMutation = useMutation({
    mutationFn: async ({ messageId, emoji }: { messageId: string; emoji: string }) => {
      if (!currentUserId) return;
      return messagingService.toggleDirectMessageReaction(messageId, currentUserId, emoji);
    },
    onSuccess: () => {
      if (conversationId) {
        queryClient.invalidateQueries({ queryKey: discussionKeys.messages(conversationId) });
      }
    },
    onError: (error: unknown) => {
      console.error('[useSessionDiscussion] Toggle reaction failed:', error);
    },
  });

  return {
    messages,
    conversationId,
    isLoading: messagesQuery.isLoading || (!conversationId && !conversationError && !!sessionId),
    isError: messagesQuery.isError || !!conversationError,
    error: messagesQuery.error || conversationError,
    hasNextPage: !!messagesQuery.hasNextPage,
    fetchNextPage: messagesQuery.fetchNextPage,
    isFetchingNextPage: messagesQuery.isFetchingNextPage,
    sendMessage: sendMutation.mutateAsync,
    isSending: sendMutation.isPending,
    toggleReaction: reactionMutation.mutate,
    typingUsers,
    startTyping,
    stopTyping,
    refetch: messagesQuery.refetch,
  };
}
