import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { dmCollabKeys } from './queryKeys';
import { fetchDmCollabSession } from '../services/dmCollabService';
import { supabase } from '../services/supabase';
import { dmCollabSessionToWatch, type DmCollabSession } from '../components/chat/dmCollabModel';

/**
 * Issue #4114 Wave 5: the live collab inside a 1:1 chat ("this conversation has
 * a live session"), looked up by conversation_id, newest first. The chat
 * refetches it when a dm_collab system row lands (started / joined / ended),
 * so both phones follow the collab through the chat's own realtime feed.
 */
export function useDmCollabSession(conversationId: string | null | undefined): {
  session: DmCollabSession | null;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  invalidate: () => Promise<void>;
} {
  const queryClient = useQueryClient();
  const key = dmCollabKeys.session(conversationId ?? null);
  const query = useQuery<DmCollabSession | null>({
    queryKey: key,
    enabled: Boolean(conversationId),
    staleTime: 15_000,
    queryFn: () => (conversationId ? fetchDmCollabSession(conversationId) : Promise.resolve(null)),
  });
  const { refetch } = query;

  // Issue #4114 QA: while the collab is pending, watch its status, so the
  // starter's header turns "Collaborating" (Swipe) the moment the friend's
  // join activates it — the "joined" row alone can arrive while it is still
  // pending. The channel closes once the session is no longer pending.
  const watchedSessionId = dmCollabSessionToWatch(query.data);
  useEffect(() => {
    if (!watchedSessionId || !conversationId) return undefined;
    const channel = supabase
      .channel(`dm_collab_session:${watchedSessionId}`)
      .on(
        'postgres_changes',
        // Keyed on the chat (conversation_id), never the primary key: realtime
        // drops id=eq.* bindings on RLS tables (I-PROPOSED-ORCH-0931).
        { event: 'UPDATE', schema: 'public', table: 'collaboration_sessions', filter: `conversation_id=eq.${conversationId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: dmCollabKeys.session(conversationId ?? null) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient, watchedSessionId]);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: dmCollabKeys.session(conversationId ?? null) }),
    [conversationId, queryClient],
  );
  return {
    session: query.data ?? null,
    isLoading: Boolean(conversationId) && query.isLoading,
    isError: query.isError,
    refetch: useCallback(() => {
      void refetch();
    }, [refetch]),
    invalidate,
  };
}
