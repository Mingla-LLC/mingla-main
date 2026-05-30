/**
 * useDiscoverTrips — React Query infinite feed for Discover > Trips.
 *
 * ORCH-1016. Anon-tolerant (no auth gate). React Query is the ONLY cache
 * (I-PROPOSED-DISCOVER-NO-MOBILE-CACHE). One query-key per filter set so any
 * filter/sort change refetches into a distinct cache entry.
 */

import { useInfiniteQuery } from "@tanstack/react-query";

import {
  fetchPublishedTrips,
  type DiscoverTripFilters,
  type DiscoverTripRow,
  type FetchPublishedTripsPage,
} from "../services/tripsDiscoveryService";

const PAGE_SIZE = 20;
const STALE_TIME_MS = 60_000; // trips change rarely; 60s staleness band.

/** Query-key factory — one key per entity (Constitution rule 4). */
export const discoverTripsKeys = {
  all: ["discoverTrips"] as const,
  list: (filters: DiscoverTripFilters) =>
    [...discoverTripsKeys.all, "list", filters] as const,
};

export interface UseDiscoverTripsResult {
  trips: DiscoverTripRow[];
  totalCount: number;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  refetch: () => void;
}

export function useDiscoverTrips(
  filters: DiscoverTripFilters,
): UseDiscoverTripsResult {
  const query = useInfiniteQuery<FetchPublishedTripsPage, Error>({
    queryKey: discoverTripsKeys.list(filters),
    queryFn: ({ pageParam }) =>
      fetchPublishedTrips(filters, {
        limit: PAGE_SIZE,
        offset: (pageParam as number) ?? 0,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.rows.length, 0);
      return loaded < lastPage.totalCount ? loaded : undefined;
    },
    staleTime: STALE_TIME_MS,
    enabled: true,
  });

  const trips = (query.data?.pages ?? []).flatMap((p) => p.rows);
  const totalCount = query.data?.pages[0]?.totalCount ?? 0;

  return {
    trips,
    totalCount,
    isLoading: query.isLoading,
    isError: query.isError,
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
