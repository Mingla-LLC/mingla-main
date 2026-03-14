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

// Safety-net polling interval. Primary freshness comes from Supabase Realtime
// events + refetchOnWindowFocus (via focusManager wired to AppState). If both
// mechanisms are unavailable, this ensures data refreshes within 5 minutes.
const FALLBACK_REFETCH_INTERVAL = 5 * 60 * 1000; // 5 minutes

// 30 seconds — short enough that refetchOnWindowFocus triggers a refetch after
// brief idle periods; long enough that rapid re-renders within a session don't
// cause unnecessary refetches. Lowered from Infinity to enable automatic
// freshness on resume via focusManager + useForegroundRefresh invalidation.
const FRIENDS_STALE_TIME = 30_000;

/**
 * Cached friend list. Freshness via Realtime + focusManager + resume invalidation.
 */
export function useFriendsList(userId: string | undefined) {
  return useQuery({
    queryKey: friendsKeys.list(userId ?? ""),
    queryFn: () => friendsService.fetchFriends(userId!),
    enabled: !!userId,
    staleTime: FRIENDS_STALE_TIME,
    refetchInterval: FALLBACK_REFETCH_INTERVAL,
  });
}

/**
 * Cached friend requests (incoming + outgoing). Same freshness strategy.
 */
export function useFriendRequests(userId: string | undefined) {
  return useQuery({
    queryKey: friendsKeys.requests(userId ?? ""),
    queryFn: () => friendsService.fetchFriendRequests(userId!),
    enabled: !!userId,
    staleTime: FRIENDS_STALE_TIME,
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
    staleTime: FRIENDS_STALE_TIME,
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
