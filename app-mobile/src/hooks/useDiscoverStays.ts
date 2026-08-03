/** React Query infinite feed for Discover > Stays. Issue #1423. */

import { useInfiniteQuery } from "@tanstack/react-query";

import {
  fetchPublishedStays,
  type DiscoverStayFilters,
  type DiscoverStayRow,
  type FetchPublishedStaysPage,
} from "../services/staysDiscoveryService";

const PAGE_SIZE = 20;
const STALE_TIME_MS = 60_000;

export const discoverStaysKeys = {
  all: ["discoverStays"] as const,
  list: (filters: DiscoverStayFilters) =>
    [...discoverStaysKeys.all, "list", filters] as const,
};

export interface UseDiscoverStaysResult {
  stays: DiscoverStayRow[];
  totalCount: number;
  isFlagEnabled: boolean | null;
  isLoading: boolean;
  isError: boolean;
  isRefetchError: boolean;
  isFetching: boolean;
  error: Error | null;
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  refetch: () => void;
}

export function useDiscoverStays(
  filters: DiscoverStayFilters,
): UseDiscoverStaysResult {
  const query = useInfiniteQuery<FetchPublishedStaysPage, Error>({
    queryKey: discoverStaysKeys.list(filters),
    queryFn: ({ pageParam }) =>
      fetchPublishedStays(filters, {
        limit: PAGE_SIZE,
        offset: (pageParam as number) ?? 0,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.enabled) return undefined;
      const loaded = allPages.reduce((sum, page) => sum + page.rows.length, 0);
      return loaded < lastPage.totalCount ? loaded : undefined;
    },
    staleTime: STALE_TIME_MS,
  });

  const stays = (query.data?.pages ?? []).flatMap((page) => page.rows);
  return {
    stays,
    totalCount: query.data?.pages[0]?.totalCount ?? 0,
    isFlagEnabled: query.data?.pages[0]?.enabled ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    isRefetchError: query.isRefetchError,
    isFetching: query.isFetching,
    error: query.error ?? null,
    fetchNextPage: () => {
      void query.fetchNextPage();
    },
    hasNextPage: query.hasNextPage ?? false,
    isFetchingNextPage: query.isFetchingNextPage,
    refetch: () => {
      void query.refetch();
    },
  };
}
