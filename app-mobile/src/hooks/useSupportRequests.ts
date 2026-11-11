/**
 * #4382 Wave 5 — Help & Support hooks (server state in React Query, keys from
 * `supportKeys`). Replaces useBetaFeedback. The is_beta_tester flag is no
 * longer read here: Help & Support is for everyone.
 */
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supportKeys } from './queryKeys';
import { useAppStore } from '../store/appStore';
import { supabase } from '../services/supabase';
import {
  createExplorerSupportTicket,
  getSupportThread,
  listMySupportTickets,
  sendSupportReply,
  type SupportThreadData,
  type SupportTicketRow,
} from '../services/supportTicketService';
import type { ExplorerCreateTicketInput } from '../utils/supportRequestModel';

const LIST_STALE_MS = 30 * 1000;

export function useMySupportTickets() {
  const userId = useAppStore((s) => s.user?.id ?? null);
  return useQuery<SupportTicketRow[]>({
    queryKey: supportKeys.list(userId ?? 'signed-out'),
    queryFn: () => listMySupportTickets(userId as string),
    enabled: userId !== null,
    staleTime: LIST_STALE_MS,
  });
}

/** One request's thread, kept live by realtime on its messages and status. */
export function useSupportThread(ticketId: string) {
  const userId = useAppStore((s) => s.user?.id ?? null);
  const queryClient = useQueryClient();
  const query = useQuery<SupportThreadData>({
    queryKey: supportKeys.thread(userId ?? 'signed-out', ticketId),
    queryFn: () => getSupportThread(userId as string, ticketId),
    enabled: userId !== null && ticketId.length > 0,
    staleTime: 15 * 1000,
  });

  const conversationId = query.data?.ticket?.conversation_id ?? null;
  useEffect(() => {
    if (userId === null || conversationId === null) return;
    const refresh = (): void => {
      void queryClient.invalidateQueries({ queryKey: supportKeys.thread(userId, ticketId) });
      void queryClient.invalidateQueries({ queryKey: supportKeys.list(userId) });
    };
    const channel = supabase
      .channel(`support:${ticketId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        refresh,
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'support_tickets', filter: `conversation_id=eq.${conversationId}` },
        refresh,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, conversationId, ticketId, queryClient]);

  return query;
}

export function useCreateSupportRequest() {
  const userId = useAppStore((s) => s.user?.id ?? null);
  const queryClient = useQueryClient();
  return useMutation<string, Error, ExplorerCreateTicketInput>({
    mutationKey: ['support', 'create'],
    mutationFn: (input) => createExplorerSupportTicket(input),
    onSuccess: () => {
      if (userId !== null) void queryClient.invalidateQueries({ queryKey: supportKeys.list(userId) });
    },
    onError: (error) => {
      console.error('[useSupportRequests] create failed:', error.message);
    },
  });
}

export function useSendSupportReply(ticketId: string) {
  const userId = useAppStore((s) => s.user?.id ?? null);
  const queryClient = useQueryClient();
  return useMutation<
    { status: string | null; reopened: boolean },
    Error,
    { content: string; attachmentIds: string[] }
  >({
    mutationKey: ['support', 'reply', ticketId],
    mutationFn: ({ content, attachmentIds }) => sendSupportReply(ticketId, content, attachmentIds),
    onSettled: () => {
      if (userId === null) return;
      void queryClient.invalidateQueries({ queryKey: supportKeys.thread(userId, ticketId) });
      void queryClient.invalidateQueries({ queryKey: supportKeys.list(userId) });
    },
    onError: (error) => {
      console.error('[useSupportRequests] reply failed:', error.message);
    },
  });
}
