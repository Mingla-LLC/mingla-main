/**
 * useNotifications — Server-synced notification hook with Supabase Realtime.
 *
 * Replaces the old useInAppNotifications hook (AsyncStorage-based).
 * Uses React Query for fetching/caching and Supabase Realtime for live updates.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import * as Haptics from 'expo-haptics';
import { clearNotificationBadge } from '../services/oneSignalService';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ServerNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  actor_id: string | null;
  related_id: string | null;
  related_type: string | null;
  is_read: boolean;
  read_at: string | null;
  push_sent: boolean;
  created_at: string;
  expires_at: string | null;
}

export interface UseNotificationsReturn {
  notifications: ServerNotification[];
  unreadCount: number;
  isLoading: boolean;
  isError: boolean;

  // Mutations
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (notificationId: string) => Promise<void>;
  clearAll: () => Promise<void>;

  // Pagination
  hasMore: boolean;
  loadMore: () => Promise<void>;

  // Refresh
  refresh: () => Promise<void>;

  // Actions (for button handlers in notification cards)
  acceptFriendRequest: (requestId: string, notificationId: string) => Promise<void>;
  declineFriendRequest: (requestId: string, notificationId: string) => Promise<void>;
  acceptPairRequest: (requestId: string, notificationId: string) => Promise<void>;
  declinePairRequest: (requestId: string, notificationId: string) => Promise<void>;
  acceptCollaborationInvite: (inviteId: string, notificationId: string) => Promise<void>;
  declineCollaborationInvite: (inviteId: string, notificationId: string) => Promise<void>;
  acceptLinkRequest: (linkId: string, notificationId: string) => Promise<void>;
  declineLinkRequest: (linkId: string, notificationId: string) => Promise<void>;

  // Action state tracking
  pendingActions: Set<string>;
}

// ── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;
const INITIAL_FETCH_LIMIT = 100;

// ── Query key factory ────────────────────────────────────────────────────────

export const notificationKeys = {
  all: (userId: string) => ['notifications', userId] as const,
  unreadCount: (userId: string) => ['notifications', 'unread', userId] as const,
};

// ── Fetch functions ──────────────────────────────────────────────────────────

async function fetchNotifications(
  userId: string,
  limit: number = INITIAL_FETCH_LIMIT,
  cursor?: string
): Promise<ServerNotification[]> {
  let query = supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (cursor) {
    query = query.lt('created_at', cursor);
  }

  const { data, error } = await query;

  if (error) {
    console.warn('[useNotifications] Fetch error:', error.message);
    throw error;
  }

  return (data ?? []) as ServerNotification[];
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useNotifications(userId: string | undefined): UseNotificationsReturn {
  const queryClient = useQueryClient();
  const [hasMore, setHasMore] = useState(true);
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Main query ──
  const {
    data: notifications = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<ServerNotification[]>({
    queryKey: notificationKeys.all(userId ?? ''),
    queryFn: () => fetchNotifications(userId!),
    enabled: !!userId,
    staleTime: 30_000, // 30 seconds
    refetchOnWindowFocus: false,
  });

  // ── Unread count (derived) ──
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications]
  );

  // ── Realtime subscription ──
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`notifications_realtime_${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newNotification = payload.new as ServerNotification;
          queryClient.setQueryData<ServerNotification[]>(
            notificationKeys.all(userId),
            (old = []) => {
              // Deduplicate
              if (old.some((n) => n.id === newNotification.id)) return old;
              return [newNotification, ...old];
            }
          );
          // Haptic feedback for new notification
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch((e) => console.warn('[useNotifications] Haptic feedback failed:', e));
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as ServerNotification;
          queryClient.setQueryData<ServerNotification[]>(
            notificationKeys.all(userId),
            (old = []) => old.map((n) => (n.id === updated.id ? updated : n))
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const deletedId = (payload.old as { id?: string })?.id;
          if (!deletedId) return;
          queryClient.setQueryData<ServerNotification[]>(
            notificationKeys.all(userId),
            (old = []) => old.filter((n) => n.id !== deletedId)
          );
        }
      )
      .subscribe();

    realtimeChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      realtimeChannelRef.current = null;
    };
  }, [userId, queryClient]);

  // ── Mutations ──

  const markAsRead = useCallback(
    async (notificationId: string) => {
      if (!userId) return;
      // Optimistic update
      queryClient.setQueryData<ServerNotification[]>(
        notificationKeys.all(userId),
        (old = []) =>
          old.map((n) =>
            n.id === notificationId
              ? { ...n, is_read: true, read_at: new Date().toISOString() }
              : n
          )
      );

      // Update iOS badge count to match new unread count
      const cached = queryClient.getQueryData<ServerNotification[]>(notificationKeys.all(userId));
      const unreadCount = cached?.filter(n => !n.is_read).length ?? 0;
      if (unreadCount === 0) {
        clearNotificationBadge();
      }
      // Note: OneSignal RN SDK v5 doesn't expose setBadgeCount for non-zero values.
      // Badge increments via push payload; clearAll resets to 0 when all are read.

      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId);
      if (error) {
        console.warn('[useNotifications] markAsRead error:', error.message);
        queryClient.invalidateQueries({ queryKey: notificationKeys.all(userId) });
      }
    },
    [userId, queryClient]
  );

  const markAllAsRead = useCallback(async () => {
    if (!userId) return;
    // Optimistic update
    queryClient.setQueryData<ServerNotification[]>(
      notificationKeys.all(userId),
      (old = []) =>
        old.map((n) => ({ ...n, is_read: true, read_at: n.read_at ?? new Date().toISOString() }))
    );
    // Reset iOS badge count (Block 3 Pass 2 — hardened 2026-03-21)
    clearNotificationBadge();
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('is_read', false);
    if (error) {
      console.warn('[useNotifications] markAllAsRead error:', error.message);
      queryClient.invalidateQueries({ queryKey: notificationKeys.all(userId) });
    }
  }, [userId, queryClient]);

  const deleteNotification = useCallback(
    async (notificationId: string) => {
      if (!userId) return;
      // Optimistic update
      queryClient.setQueryData<ServerNotification[]>(
        notificationKeys.all(userId),
        (old = []) => old.filter((n) => n.id !== notificationId)
      );
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId);
      if (error) {
        console.warn('[useNotifications] deleteNotification error:', error.message);
        queryClient.invalidateQueries({ queryKey: notificationKeys.all(userId) });
      }
    },
    [userId, queryClient]
  );

  const clearAll = useCallback(async () => {
    if (!userId) return;
    // Optimistic update
    queryClient.setQueryData<ServerNotification[]>(
      notificationKeys.all(userId),
      () => []
    );
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('user_id', userId);
    if (error) {
      console.warn('[useNotifications] clearAll error:', error.message);
      queryClient.invalidateQueries({ queryKey: notificationKeys.all(userId) });
    }
  }, [userId, queryClient]);

  // ── Pagination ──

  const loadMore = useCallback(async () => {
    if (!userId || !hasMore || notifications.length === 0) return;
    const lastItem = notifications[notifications.length - 1];
    try {
      const moreItems = await fetchNotifications(userId, PAGE_SIZE, lastItem.created_at);
      if (moreItems.length < PAGE_SIZE) {
        setHasMore(false);
      }
      if (moreItems.length > 0) {
        queryClient.setQueryData<ServerNotification[]>(
          notificationKeys.all(userId),
          (old = []) => {
            const existingIds = new Set(old.map((n) => n.id));
            const newItems = moreItems.filter((n) => !existingIds.has(n.id));
            return [...old, ...newItems];
          }
        );
      }
    } catch (err) {
      console.warn('[useNotifications] loadMore error:', err);
    }
  }, [userId, hasMore, notifications, queryClient]);

  // ── Refresh ──

  const refresh = useCallback(async () => {
    if (!userId) return;
    setHasMore(true);
    await refetch();
  }, [userId, refetch]);

  // ── Action helpers ──

  const addPendingAction = useCallback((notificationId: string) => {
    setPendingActions((prev) => new Set(prev).add(notificationId));
  }, []);

  const removePendingAction = useCallback((notificationId: string) => {
    setPendingActions((prev) => {
      const next = new Set(prev);
      next.delete(notificationId);
      return next;
    });
  }, []);

  // ── Accept/Decline Friend Request ──

  const acceptFriendRequestAction = useCallback(
    async (requestId: string, notificationId: string) => {
      if (!userId) return;
      addPendingAction(notificationId);
      try {
        // Use atomic RPC — creates bidirectional friends rows, triggers pair visibility, etc.
        const { error } = await supabase.rpc('accept_friend_request_atomic', {
          p_request_id: requestId,
        });
        if (error) throw error;

        // Invalidate friends + pairings cache (RPC may reveal hidden pair requests)
        queryClient.invalidateQueries({ queryKey: ['friends'] });
        queryClient.invalidateQueries({ queryKey: ['pairings'] });
        // Delete the notification
        await deleteNotification(notificationId);
      } catch (err) {
        console.error('[useNotifications] acceptFriendRequest error:', err);
        throw err;
      } finally {
        removePendingAction(notificationId);
      }
    },
    [userId, queryClient, deleteNotification, addPendingAction, removePendingAction]
  );

  const declineFriendRequestAction = useCallback(
    async (requestId: string, notificationId: string) => {
      if (!userId) return;
      addPendingAction(notificationId);
      try {
        const { error } = await supabase
          .from('friend_requests')
          .update({ status: 'declined' })
          .eq('id', requestId);
        if (error) throw error;

        queryClient.invalidateQueries({ queryKey: ['friends'] });
        await deleteNotification(notificationId);
      } catch (err) {
        console.error('[useNotifications] declineFriendRequest error:', err);
        throw err;
      } finally {
        removePendingAction(notificationId);
      }
    },
    [userId, queryClient, deleteNotification, addPendingAction, removePendingAction]
  );

  // ── Accept/Decline Pair Request ──

  const acceptPairRequestAction = useCallback(
    async (requestId: string, notificationId: string) => {
      if (!userId) return;
      addPendingAction(notificationId);
      try {
        // Use the same service function as the existing code
        const { acceptPairRequest: acceptPairSvc } = await import('../services/pairingService');
        const result = await acceptPairSvc(requestId);
        queryClient.invalidateQueries({ queryKey: ['pairings'] });
        // Fire-and-forget notification to the sender
        try {
          const senderId = result?.pairedWithUserId
            || notifications.find(n => n.id === notificationId)?.actor_id;
          if (senderId && userId) {
            const { trackedInvoke } = await import('../services/supabase');
            trackedInvoke('send-pair-accepted-notification', {
              body: { accepterId: userId, senderId, requestId },
            }).catch(err => console.warn('[useNotifications] pair accepted notification failed:', err));
          }
        } catch (notifyErr) {
          console.warn('[useNotifications] pair accepted notification setup failed:', notifyErr);
        }
        await deleteNotification(notificationId);
      } catch (err) {
        console.error('[useNotifications] acceptPairRequest error:', err);
        throw err;
      } finally {
        removePendingAction(notificationId);
      }
    },
    [userId, queryClient, deleteNotification, addPendingAction, removePendingAction, notifications]
  );

  const declinePairRequestAction = useCallback(
    async (requestId: string, notificationId: string) => {
      if (!userId) return;
      addPendingAction(notificationId);
      try {
        const { declinePairRequest: declinePairSvc } = await import('../services/pairingService');
        await declinePairSvc(requestId);
        queryClient.invalidateQueries({ queryKey: ['pairings'] });
        await deleteNotification(notificationId);
      } catch (err) {
        console.error('[useNotifications] declinePairRequest error:', err);
        throw err;
      } finally {
        removePendingAction(notificationId);
      }
    },
    [userId, queryClient, deleteNotification, addPendingAction, removePendingAction]
  );

  // ── Accept/Decline Collaboration Invite ──
  // Uses the shared service that handles the FULL acceptance flow:
  // invite status → participant upsert → session activation → board creation → preferences seed.
  // The old implementation only updated the invite status, which caused the session to vanish
  // from the pill bar (invite no longer 'pending', but user never added as participant).

  const acceptCollaborationInviteAction = useCallback(
    async (inviteId: string, notificationId: string) => {
      if (!userId) return;
      addPendingAction(notificationId);
      try {
        const { acceptCollaborationInvite } = await import('../services/collaborationInviteService');
        const result = await acceptCollaborationInvite({ userId, inviteId });
        if (!result.success) {
          throw new Error(result.error ?? 'Failed to accept invite');
        }

        // Invalidate all session-related caches so the pill bar and board views refresh
        queryClient.invalidateQueries({ queryKey: ['collaboration'] });
        queryClient.invalidateQueries({ queryKey: ['boards'] });
        await deleteNotification(notificationId);
      } catch (err) {
        console.error('[useNotifications] acceptCollaborationInvite error:', err);
        throw err;
      } finally {
        removePendingAction(notificationId);
      }
    },
    [userId, queryClient, deleteNotification, addPendingAction, removePendingAction]
  );

  const declineCollaborationInviteAction = useCallback(
    async (inviteId: string, notificationId: string) => {
      if (!userId) return;
      addPendingAction(notificationId);
      try {
        const { declineCollaborationInvite } = await import('../services/collaborationInviteService');
        const result = await declineCollaborationInvite({ userId, inviteId });
        if (!result.success) {
          throw new Error(result.error ?? 'Failed to decline invite');
        }

        queryClient.invalidateQueries({ queryKey: ['collaboration'] });
        await deleteNotification(notificationId);
      } catch (err) {
        console.error('[useNotifications] declineCollaborationInvite error:', err);
        throw err;
      } finally {
        removePendingAction(notificationId);
      }
    },
    [userId, queryClient, deleteNotification, addPendingAction, removePendingAction]
  );

  // ── Accept/Decline Link Request ──
  // Link requests don't exist in the current codebase, but stub for future use.

  const acceptLinkRequestAction = useCallback(
    async (linkId: string, notificationId: string) => {
      if (!userId) return;
      addPendingAction(notificationId);
      try {
        const { error } = await supabase
          .from('link_requests')
          .update({ status: 'accepted' })
          .eq('id', linkId);
        if (error) throw error;

        queryClient.invalidateQueries({ queryKey: ['links'] });
        await deleteNotification(notificationId);
      } catch (err) {
        console.error('[useNotifications] acceptLinkRequest error:', err);
        throw err;
      } finally {
        removePendingAction(notificationId);
      }
    },
    [userId, queryClient, deleteNotification, addPendingAction, removePendingAction]
  );

  const declineLinkRequestAction = useCallback(
    async (linkId: string, notificationId: string) => {
      if (!userId) return;
      addPendingAction(notificationId);
      try {
        const { error } = await supabase
          .from('link_requests')
          .update({ status: 'declined' })
          .eq('id', linkId);
        if (error) throw error;

        queryClient.invalidateQueries({ queryKey: ['links'] });
        await deleteNotification(notificationId);
      } catch (err) {
        console.error('[useNotifications] declineLinkRequest error:', err);
        throw err;
      } finally {
        removePendingAction(notificationId);
      }
    },
    [userId, queryClient, deleteNotification, addPendingAction, removePendingAction]
  );

  return {
    notifications,
    unreadCount,
    isLoading,
    isError,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
    hasMore,
    loadMore,
    refresh,
    acceptFriendRequest: acceptFriendRequestAction,
    declineFriendRequest: declineFriendRequestAction,
    acceptPairRequest: acceptPairRequestAction,
    declinePairRequest: declinePairRequestAction,
    acceptCollaborationInvite: acceptCollaborationInviteAction,
    declineCollaborationInvite: declineCollaborationInviteAction,
    acceptLinkRequest: acceptLinkRequestAction,
    declineLinkRequest: declineLinkRequestAction,
    pendingActions,
  };
}
