/**
 * ORCH-0437: Near You Leaderboard — Presence hook
 *
 * Fetches nearby users, subscribes to Realtime updates, enriches
 * with profile data and computed fields (distance, proximity tier).
 */

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { leaderboardService } from '../services/leaderboardService';
import { leaderboardKeys } from './queryKeys';
import { useAppStore } from '../store/appStore';
import type {
  LeaderboardPresenceRow,
  LeaderboardUser,
} from '../types/leaderboard';
import {
  haversineKm,
  getProximityTier,
  parseSwipedCategory,
} from '../types/leaderboard';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseLeaderboardPresenceResult {
  users: LeaderboardUser[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useLeaderboardPresence(
  userLocation: { lat: number; lng: number } | null,
): UseLeaderboardPresenceResult {
  const queryClient = useQueryClient();
  const user = useAppStore((s) => s.user);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const profileCacheRef = useRef<Map<string, { display_name: string; first_name: string | null; avatar_url: string | null }>>(new Map());

  // --- Initial data fetch ---
  const {
    data: rawUsers,
    isLoading,
    error,
    refetch,
  } = useQuery<LeaderboardPresenceRow[], Error>({
    queryKey: leaderboardKeys.presence(),
    queryFn: () => leaderboardService.fetchNearbyUsers(),
    staleTime: 30_000, // 30s — Realtime handles freshness between refetches
    enabled: !!userLocation && !!user?.id,
  });

  // --- Batch-fetch profiles for all users in the result ---
  useEffect(() => {
    if (!rawUsers || rawUsers.length === 0) return;

    const uncachedIds = rawUsers
      .map((u) => u.user_id)
      .filter((id) => !profileCacheRef.current.has(id));

    if (uncachedIds.length === 0) return;

    leaderboardService.fetchProfilesBatch(uncachedIds).then((profiles) => {
      for (const [id, profile] of profiles) {
        profileCacheRef.current.set(id, profile);
      }
      // Force re-render to pick up new profiles
      queryClient.invalidateQueries({ queryKey: leaderboardKeys.presence() });
    }).catch((err) => {
      console.warn('[useLeaderboardPresence] Profile fetch failed:', err);
    });
  }, [rawUsers, queryClient]);

  // --- Realtime subscription ---
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('leaderboard-presence')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'leaderboard_presence',
      }, (payload) => {
        const eventType = payload.eventType;

        queryClient.setQueryData<LeaderboardPresenceRow[]>(
          leaderboardKeys.presence(),
          (old) => {
            if (!old) return old;

            if (eventType === 'INSERT') {
              const newRow = payload.new as LeaderboardPresenceRow;
              // Don't add self
              if (newRow.user_id === user.id) return old;
              // Don't add if already exists
              if (old.some((u) => u.user_id === newRow.user_id)) return old;
              // Fetch profile for new user (async, non-blocking)
              if (!profileCacheRef.current.has(newRow.user_id)) {
                leaderboardService.fetchProfilesBatch([newRow.user_id]).then((profiles) => {
                  for (const [id, profile] of profiles) {
                    profileCacheRef.current.set(id, profile);
                  }
                }).catch(() => {});
              }
              return [...old, newRow];
            }

            if (eventType === 'UPDATE') {
              const updated = payload.new as LeaderboardPresenceRow;
              return old.map((u) => (u.user_id === updated.user_id ? updated : u));
            }

            if (eventType === 'DELETE') {
              const deletedId = (payload.old as { user_id?: string })?.user_id;
              if (!deletedId) return old;
              return old.filter((u) => u.user_id !== deletedId);
            }

            return old;
          },
        );
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id, queryClient]);

  // --- Enrich and sort ---
  const enrichedUsers = useMemo((): LeaderboardUser[] => {
    if (!rawUsers || !userLocation) return [];

    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    return rawUsers
      .filter((row) => {
        // Filter out self
        if (row.user_id === user?.id) return false;
        // Filter out expired (24h)
        if (new Date(row.last_swipe_at).getTime() < twentyFourHoursAgo) return false;
        // Filter out non-discoverable or no seats
        if (!row.is_discoverable || row.available_seats <= 0) return false;
        return true;
      })
      .map((row): LeaderboardUser => {
        const distKm = haversineKm(userLocation.lat, userLocation.lng, row.lat, row.lng);
        const profile = profileCacheRef.current.get(row.user_id);
        const sessionStart = new Date(row.session_started_at).getTime();
        const activeMinutes = Math.max(0, Math.floor((now - sessionStart) / 60000));

        return {
          ...row,
          display_name: profile?.display_name ?? 'User',
          first_name: profile?.first_name ?? null,
          avatar_url: profile?.avatar_url ?? null,
          proximity_tier: getProximityTier(distKm),
          distance_km: distKm,
          active_for_minutes: activeMinutes,
          parsed_swiped_category: parseSwipedCategory(row.last_swiped_category),
        };
      })
      // Sort by level DESC, then distance ASC
      .sort((a, b) => {
        if (b.user_level !== a.user_level) return b.user_level - a.user_level;
        return a.distance_km - b.distance_km;
      });
  }, [rawUsers, userLocation, user?.id]);

  return {
    users: enrichedUsers,
    isLoading,
    error: error ?? null,
    refetch: useCallback(() => { refetch(); }, [refetch]),
  };
}
