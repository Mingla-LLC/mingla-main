/**
 * ORCH-0437: Near You Leaderboard — Tag-Along Requests hook
 *
 * Manages sending, receiving, accepting, and declining tag-along
 * interest requests. Subscribes to Realtime for live updates.
 */

import { useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { leaderboardService } from '../services/leaderboardService';
import { leaderboardKeys } from './queryKeys';
import { toastManager } from '../components/ui/Toast';
import i18n from '../i18n';
import type {
  TagAlongRequest,
  TagAlongRequestWithSender,
  SendTagAlongResponse,
  AcceptTagAlongResponse,
} from '../types/leaderboard';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface UseTagAlongRequestsResult {
  // Data
  incomingRequests: TagAlongRequestWithSender[];
  outgoingRequestIds: Set<string>; // receiver_ids with pending outgoing requests
  isLoading: boolean;

  // Mutations
  sendInterest: (receiverId: string) => Promise<SendTagAlongResponse>;
  acceptRequest: (requestId: string) => Promise<AcceptTagAlongResponse>;
  declineRequest: (requestId: string) => Promise<void>;

  // Mutation states
  isSending: boolean;
  isAccepting: boolean;
  isDeclining: boolean;
}

export function useTagAlongRequests(userId: string | undefined): UseTagAlongRequestsResult {
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const senderProfileCacheRef = useRef<Map<string, {
    display_name: string;
    avatar_url: string | null;
    level: number;
    status: string | null;
  }>>(new Map());

  // --- Incoming requests query ---
  const {
    data: rawIncoming,
    isLoading: incomingLoading,
  } = useQuery<TagAlongRequest[], Error>({
    queryKey: leaderboardKeys.incomingRequests(userId ?? ''),
    queryFn: () => leaderboardService.fetchIncomingRequests(userId!),
    staleTime: 10_000,
    enabled: !!userId,
  });

  // --- Outgoing requests query ---
  const {
    data: rawOutgoing,
    isLoading: outgoingLoading,
  } = useQuery<TagAlongRequest[], Error>({
    queryKey: leaderboardKeys.tagAlongRequests(userId ?? ''),
    queryFn: () => leaderboardService.fetchOutgoingRequests(userId!),
    staleTime: 10_000,
    enabled: !!userId,
  });

  // Outgoing as a Set of receiver_ids for fast lookup
  const outgoingRequestIds = useMemo((): Set<string> => {
    if (!rawOutgoing) return new Set();
    return new Set(rawOutgoing.map((r) => r.receiver_id));
  }, [rawOutgoing]);

  // --- Enrich incoming with sender profiles ---
  useEffect(() => {
    if (!rawIncoming || rawIncoming.length === 0) return;

    const uncachedIds = rawIncoming
      .map((r) => r.sender_id)
      .filter((id) => !senderProfileCacheRef.current.has(id));

    if (uncachedIds.length === 0) return;

    // Batch fetch profiles + levels
    Promise.all([
      leaderboardService.fetchProfilesBatch(uncachedIds),
      // Fetch levels for each sender
      supabase
        .from('user_levels')
        .select('user_id, level')
        .in('user_id', uncachedIds),
      // Fetch presence for status
      supabase
        .from('leaderboard_presence')
        .select('user_id, activity_status')
        .in('user_id', uncachedIds),
    ]).then(([profiles, levelsResult, presenceResult]) => {
      const levels = new Map<string, number>();
      for (const row of levelsResult.data ?? []) {
        levels.set(row.user_id, row.level);
      }

      const statuses = new Map<string, string | null>();
      for (const row of presenceResult.data ?? []) {
        statuses.set(row.user_id, row.activity_status);
      }

      for (const id of uncachedIds) {
        const profile = profiles.get(id);
        senderProfileCacheRef.current.set(id, {
          display_name: profile?.display_name ?? 'User',
          avatar_url: profile?.avatar_url ?? null,
          level: levels.get(id) ?? 1,
          status: statuses.get(id) ?? null,
        });
      }

      // Trigger re-render
      queryClient.invalidateQueries({ queryKey: leaderboardKeys.incomingRequests(userId ?? '') });
    }).catch((err) => {
      console.warn('[useTagAlongRequests] Profile enrichment failed:', err);
    });
  }, [rawIncoming, userId, queryClient]);

  // Enriched incoming requests
  const incomingRequests = useMemo((): TagAlongRequestWithSender[] => {
    if (!rawIncoming) return [];
    return rawIncoming.map((req) => {
      const cached = senderProfileCacheRef.current.get(req.sender_id);
      return {
        ...req,
        sender_display_name: cached?.display_name ?? 'User',
        sender_avatar_url: cached?.avatar_url ?? null,
        sender_level: cached?.level ?? 1,
        sender_status: cached?.status ?? null,
      };
    });
  }, [rawIncoming]);

  // --- Realtime subscription ---
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`tag-along-${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'tag_along_requests',
        filter: `receiver_id=eq.${userId}`,
      }, () => {
        // New incoming request — refetch
        queryClient.invalidateQueries({ queryKey: leaderboardKeys.incomingRequests(userId) });
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'tag_along_requests',
        filter: `sender_id=eq.${userId}`,
      }, () => {
        // Outgoing request status changed — refetch
        queryClient.invalidateQueries({ queryKey: leaderboardKeys.tagAlongRequests(userId) });
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [userId, queryClient]);

  // --- Send interest mutation ---
  const sendMutation = useMutation<SendTagAlongResponse, Error, string>({
    mutationFn: (receiverId: string) => leaderboardService.sendTagAlong(receiverId),
    onSuccess: (_data, receiverId) => {
      // Optimistically add to outgoing set
      queryClient.setQueryData<TagAlongRequest[]>(
        leaderboardKeys.tagAlongRequests(userId ?? ''),
        (old) => {
          if (!old) return old;
          return [...old, {
            id: _data.request_id,
            sender_id: userId!,
            receiver_id: receiverId,
            status: 'pending' as const,
            collab_session_id: null,
            created_at: new Date().toISOString(),
            responded_at: null,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          }];
        },
      );
    },
    onError: (err) => {
      const msg = err.message;
      if (msg.includes('pending_request_exists')) {
        toastManager.info('You already sent interest to this person', 3000);
      } else if (msg.includes('cooldown_active')) {
        toastManager.info('Please wait before sending again', 3000);
      } else if (msg.includes('user_not_discoverable')) {
        toastManager.info('This person is no longer available', 3000);
      } else {
        toastManager.error('Couldn\'t send interest. Try again.', 3000);
      }
    },
  });

  // --- Accept request mutation ---
  const acceptMutation = useMutation<AcceptTagAlongResponse, Error, string>({
    mutationFn: (requestId: string) => leaderboardService.acceptTagAlong(requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leaderboardKeys.incomingRequests(userId ?? '') });
      queryClient.invalidateQueries({ queryKey: leaderboardKeys.presence() });
    },
    onError: (err) => {
      const msg = err.message;
      if (msg.includes('request_expired')) {
        toastManager.info('This request has expired', 3000);
      } else if (msg.includes('no_seats_available')) {
        toastManager.info('No seats available', 3000);
      } else {
        toastManager.error('Couldn\'t accept request. Try again.', 3000);
      }
      // Refetch to clear stale request from UI
      queryClient.invalidateQueries({ queryKey: leaderboardKeys.incomingRequests(userId ?? '') });
    },
  });

  // --- Decline request mutation ---
  const declineMutation = useMutation<void, Error, string>({
    mutationFn: async (requestId: string) => {
      await leaderboardService.declineTagAlong(requestId);
    },
    onMutate: async (requestId) => {
      // Optimistic: remove from incoming
      await queryClient.cancelQueries({ queryKey: leaderboardKeys.incomingRequests(userId ?? '') });
      queryClient.setQueryData<TagAlongRequest[]>(
        leaderboardKeys.incomingRequests(userId ?? ''),
        (old) => old?.filter((r) => r.id !== requestId) ?? [],
      );
    },
    onError: () => {
      toastManager.error('Couldn\'t decline request. Try again.', 3000);
      queryClient.invalidateQueries({ queryKey: leaderboardKeys.incomingRequests(userId ?? '') });
    },
  });

  return {
    incomingRequests,
    outgoingRequestIds,
    isLoading: incomingLoading || outgoingLoading,

    sendInterest: useCallback(
      (receiverId: string) => sendMutation.mutateAsync(receiverId),
      [sendMutation],
    ),
    acceptRequest: useCallback(
      (requestId: string) => acceptMutation.mutateAsync(requestId),
      [acceptMutation],
    ),
    declineRequest: useCallback(
      (requestId: string) => declineMutation.mutateAsync(requestId),
      [declineMutation],
    ),

    isSending: sendMutation.isPending,
    isAccepting: acceptMutation.isPending,
    isDeclining: declineMutation.isPending,
  };
}
