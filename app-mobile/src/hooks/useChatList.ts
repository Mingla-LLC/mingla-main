import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { chatListKeys } from './queryKeys';
import {
  CHAT_LIST_STALE_TIME_MS,
  isChatListTimeout,
  loadChatList,
  type ChatEventPublicCard,
  type ChatListData,
  type ChatListLoadDeps,
} from '../components/connections/chatListLoad';
import { serializeTeamBrandCache, teamBrandCacheKey } from '../components/connections/teamBrandCache';

/**
 * Issue #4265 — the Chats tab list as ONE React Query entry.
 *
 * Key: chatListKeys.list(userId). It carries the user id, so logout and an
 * account switch remove it (authCleanup → shouldRemoveForAuthChange) and the
 * persister never writes it for anyone else; it is persisted like every other
 * query, so the first visit after a relaunch renders the last list too.
 *
 * Fresh for CHAT_LIST_STALE_TIME_MS: a revisit inside that window renders from
 * cache with no request; after it, the cached list renders at once and React
 * Query refreshes it in the background (refetchOnMount).
 *
 * Other features that change the list (joining a plan, a new chat…) refresh it
 * with `queryClient.invalidateQueries({ queryKey: chatListKeys.all })`.
 */
export function useChatList<TCard extends ChatEventPublicCard>(
  userId: string | null,
  deps: ChatListLoadDeps<TCard>,
): UseQueryResult<ChatListData> {
  const queryClient = useQueryClient();
  const queryKey = chatListKeys.list(userId ?? 'none');
  return useQuery<ChatListData>({
    queryKey,
    enabled: Boolean(userId),
    staleTime: CHAT_LIST_STALE_TIME_MS,
    // A timeout already waited 10 s; the next visit or pull-to-refresh retries.
    retry: (failureCount, error) => !isChatListTimeout(error) && failureCount < 1,
    queryFn: async () => {
      if (!userId) return { conversations: [], teamBrandIds: null };
      const data = await loadChatList(userId, deps);
      if (data.teamBrandIds === null) {
        // The team read failed: keep the last known set.
        const previous = queryClient.getQueryData<ChatListData>(queryKey);
        return { ...data, teamBrandIds: previous?.teamBrandIds ?? null };
      }
      AsyncStorage.setItem(teamBrandCacheKey(userId), serializeTeamBrandCache(new Set(data.teamBrandIds)))
        .catch((error: unknown) => console.warn('[ConnectionsPage] team brand cache write failed', error));
      return data;
    },
  });
}
