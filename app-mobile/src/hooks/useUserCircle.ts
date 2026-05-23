import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchUserCircle } from '../services/circleService';
import { circleKeys } from './queryKeys';
import type { CirclePage, CirclePerson } from '../types/circle';

export const USER_CIRCLE_PAGE_SIZE = 60;

export function useUserCircle(viewerUserId: string | undefined | null) {
  const query = useInfiniteQuery<CirclePage, Error>({
    queryKey: circleKeys.forUser(viewerUserId ?? ''),
    queryFn: async ({ pageParam = 0 }) => {
      const offset = Number(pageParam);
      const people = await fetchUserCircle(
        viewerUserId!,
        USER_CIRCLE_PAGE_SIZE,
        offset,
      );
      return {
        people,
        limit: USER_CIRCLE_PAGE_SIZE,
        offset,
        hasMore: people.length === USER_CIRCLE_PAGE_SIZE,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.offset + lastPage.limit : undefined,
    enabled: !!viewerUserId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const people = useMemo<CirclePerson[]>(
    () => query.data?.pages.flatMap((page) => page.people) ?? [],
    [query.data],
  );

  return {
    ...query,
    people,
    isLoadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage === true,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) {
        return query.fetchNextPage();
      }
      return Promise.resolve();
    },
  };
}
