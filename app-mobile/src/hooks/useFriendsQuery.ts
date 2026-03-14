import { useQuery } from "@tanstack/react-query";
import * as friendsService from "../services/friendsService";
import { muteService } from "../services/muteService";

// ─── Query Keys ──────────────────────────────────────────

export const friendsKeys = {
  all: ["friends"] as const,
  list: (userId: string) => [...friendsKeys.all, "list", userId] as const,
  requests: (userId: string) => [...friendsKeys.all, "requests", userId] as const,
  blocked: (userId: string) => [...friendsKeys.all, "blocked", userId] as const,
  muted: (userId: string) => [...friendsKeys.all, "muted", userId] as const,
};

// ─── Query Hooks ─────────────────────────────────────────

// Safety-net polling interval for Infinity-staleTime queries.
// Primary freshness comes from Supabase Realtime events. If the Realtime channel
// silently dies (network glitch, long background, Supabase maintenance), this
// ensures data refreshes within 5 minutes even without a Realtime event.
const FALLBACK_REFETCH_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Cached friend list. staleTime = Infinity — data is never "stale" on its own.
 * Invalidation happens via Supabase Realtime events + 5-minute fallback poll.
 */
export function useFriendsList(userId: string | undefined) {
  return useQuery({
    queryKey: friendsKeys.list(userId ?? ""),
    queryFn: () => friendsService.fetchFriends(userId!),
    enabled: !!userId,
    staleTime: Infinity,
    refetchInterval: FALLBACK_REFETCH_INTERVAL,
  });
}

/**
 * Cached friend requests (incoming + outgoing). Same invalidation strategy.
 */
export function useFriendRequests(userId: string | undefined) {
  return useQuery({
    queryKey: friendsKeys.requests(userId ?? ""),
    queryFn: () => friendsService.fetchFriendRequests(userId!),
    enabled: !!userId,
    staleTime: Infinity,
    refetchInterval: FALLBACK_REFETCH_INTERVAL,
  });
}

/**
 * Cached blocked users list.
 */
export function useBlockedUsers(userId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: friendsKeys.blocked(userId ?? ""),
    queryFn: () => friendsService.fetchBlockedUsers(),
    enabled: !!userId && enabled,
    staleTime: Infinity,
    refetchInterval: FALLBACK_REFETCH_INTERVAL,
  });
}

/**
 * Cached muted user IDs.
 */
export function useMutedUserIds(userId: string | undefined) {
  return useQuery({
    queryKey: friendsKeys.muted(userId ?? ""),
    queryFn: async () => {
      const { data } = await muteService.getMutedUserIds();
      return (data || []) as string[];
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000, // 5 min — mute list changes rarely
    select: (data) => new Set<string>(data),
  });
}
