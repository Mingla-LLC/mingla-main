import { useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import {
  fetchSessionMessages,
  sendMessage,
  toggleReaction,
  markMessagesAsRead,
  uploadMessageImage,
  BoardMessage,
} from '../services/boardDiscussionService';
import { useChatPresence } from './useChatPresence';

// --- Query Keys ---
export const discussionKeys = {
  all: ['board-discussion'] as const,
  session: (sessionId: string) => [...discussionKeys.all, sessionId] as const,
  messages: (sessionId: string) => [...discussionKeys.session(sessionId), 'messages'] as const,
};

// --- Hook ---
export function useSessionDiscussion(sessionId: string | null, currentUserId: string | null) {
  const queryClient = useQueryClient();

  // 1. Fetch messages with infinite scroll
  const messagesQuery = useInfiniteQuery({
    queryKey: discussionKeys.messages(sessionId ?? ''),
    queryFn: ({ pageParam }) => fetchSessionMessages(sessionId!, pageParam),
    getNextPageParam: (lastPage) => {
      if (lastPage.length < 30) return undefined;
      return lastPage[lastPage.length - 1]?.created_at;
    },
    initialPageParam: undefined as string | undefined,
    enabled: !!sessionId,
    staleTime: 2 * 60 * 1000,
  });

  const messages: BoardMessage[] = messagesQuery.data?.pages.flat() ?? [];

  // 2. Realtime subscription
  useEffect(() => {
    if (!sessionId) return;

    const channel = supabase
      .channel(`discussion:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'board_messages',
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: discussionKeys.messages(sessionId) });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'board_message_reactions',
        },
        () => {
          queryClient.invalidateQueries({ queryKey: discussionKeys.messages(sessionId) });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'board_message_reads',
        },
        () => {
          queryClient.invalidateQueries({ queryKey: discussionKeys.messages(sessionId) });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, queryClient]);

  // 3. Typing indicators
  const {
    typingUsers,
    startTyping,
    stopTyping,
  } = useChatPresence({
    conversationId: sessionId ? `session:${sessionId}` : null,
    currentUserId,
  });

  // 4. Auto-mark messages as read
  const lastReadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentUserId || messages.length === 0) return;

    const unreadMessageIds = messages
      .filter(
        (m) =>
          m.user_id !== currentUserId &&
          !m.read_by?.some((r) => r.user_id === currentUserId)
      )
      .map((m) => m.id);

    if (unreadMessageIds.length === 0) return;

    const key = unreadMessageIds.join(',');
    if (key === lastReadRef.current) return;
    lastReadRef.current = key;

    markMessagesAsRead(unreadMessageIds, currentUserId);
  }, [messages, currentUserId]);

  // 5. Send message mutation
  const sendMutation = useMutation({
    mutationFn: async (params: {
      content: string;
      imageUri?: string;
      imageMimeType?: string;
      mentions?: string[];
      replyToId?: string;
    }) => {
      let imageUrl: string | undefined;

      if (params.imageUri) {
        const tempId = `temp-${Date.now()}`;
        imageUrl = await uploadMessageImage(
          sessionId!,
          tempId,
          params.imageUri,
          params.imageMimeType
        );
      }

      return sendMessage({
        sessionId: sessionId!,
        userId: currentUserId!,
        content: params.content,
        imageUrl,
        mentions: params.mentions,
        replyToId: params.replyToId,
      });
    },
    onSuccess: () => {
      stopTyping();
      queryClient.invalidateQueries({ queryKey: discussionKeys.messages(sessionId!) });
    },
  });

  // 6. Toggle reaction mutation
  const reactionMutation = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) =>
      toggleReaction(messageId, currentUserId!, emoji),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: discussionKeys.messages(sessionId!) });
    },
  });

  return {
    messages,
    isLoading: messagesQuery.isLoading,
    isError: messagesQuery.isError,
    error: messagesQuery.error,
    hasNextPage: messagesQuery.hasNextPage,
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
