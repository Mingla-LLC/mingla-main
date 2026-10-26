import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { dmCollabKeys } from './queryKeys';
import { fetchDmCollabSession } from '../services/dmCollabService';
import type { DmCollabSession } from '../components/chat/dmCollabModel';

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
