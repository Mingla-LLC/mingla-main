import { useQuery } from '@tanstack/react-query';
import { fetchSessionDeck, SessionDeckResponse } from '../services/sessionDeckService';

export function useSessionDeck(
  sessionId: string | undefined,
  batchSeed: number,
  enabled: boolean,
  excludeCardIds: string[] = [],
  location?: { lat: number; lng: number } | null,
) {
  return useQuery<SessionDeckResponse>({
    queryKey: ['session-deck', sessionId, batchSeed],
    queryFn: () => fetchSessionDeck(sessionId!, batchSeed, excludeCardIds, location ?? undefined),
    staleTime: 30 * 60 * 1000,  // 30 min
    gcTime: 2 * 60 * 60 * 1000, // 2 hours
    enabled: enabled && !!sessionId,
    retry: 2,
    placeholderData: (prev) => prev,
  });
}
