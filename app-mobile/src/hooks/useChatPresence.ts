import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '../services/supabase';
import {
  upsertPresence,
  markAllConversationsOffline,
  getConversationPresence,
  broadcastTyping,
  ConversationPresenceRecord,
} from '../services/chatPresenceService';

interface ParticipantPresence {
  isOnline: boolean;
  lastSeenAt: string | null;
}

interface UseChatPresenceOptions {
  conversationId: string | null;
  currentUserId: string | null;
}

interface UseChatPresenceReturn {
  /** Map of userId → presence state (excludes self) */
  participants: Record<string, ParticipantPresence>;
  /** Array of userIds currently typing (excludes self) */
  typingUsers: string[];
  /** Call when user starts typing */
  startTyping: () => void;
  /** Call when user stops typing (or sends message) */
  stopTyping: () => void;
}

/** Shape of the postgres_changes payload for conversation_presence rows */
interface PresenceChangePayload {
  user_id: string;
  conversation_id: string;
  is_online: boolean;
  last_seen_at: string;
  updated_at: string;
}

const TYPING_TIMEOUT_MS = 3000;
const TYPING_EXPIRY_MS = 4000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const STALE_THRESHOLD_MS = 60_000;

export function useChatPresence({
  conversationId,
  currentUserId,
}: UseChatPresenceOptions): UseChatPresenceReturn {
  const [participants, setParticipants] = useState<Record<string, ParticipantPresence>>({});
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingExpiryTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const isTypingRef = useRef(false);

  // --- Fetch initial presence and subscribe to changes ---
  useEffect(() => {
    if (!conversationId || !currentUserId) return;

    let isMounted = true;

    // 1. Fetch initial presence for other participants
    (async () => {
      const records = await getConversationPresence(conversationId);
      if (!isMounted) return;

      const presenceMap: Record<string, ParticipantPresence> = {};
      for (const r of records) {
        if (r.user_id === currentUserId) continue;

        // Client-side stale detection (Amendment 5c)
        const isActuallyOnline =
          r.is_online &&
          Date.now() - new Date(r.updated_at).getTime() < STALE_THRESHOLD_MS;

        presenceMap[r.user_id] = {
          isOnline: isActuallyOnline,
          lastSeenAt: r.last_seen_at,
        };
      }
      setParticipants(presenceMap);
    })();

    // 2. Upsert own presence as online
    upsertPresence(conversationId, currentUserId, true);

    // 3. Subscribe to presence channel for typing + presence updates
    const channelName = `presence:${conversationId}`;
    const channel = supabase
      .channel(channelName)
      .on('broadcast', { event: 'typing_start' }, (payload) => {
        const { userId } = payload.payload || {};
        if (!userId || userId === currentUserId || !isMounted) return;

        setTypingUsers((prev) => {
          if (prev.includes(userId)) return prev;
          return [...prev, userId];
        });

        // Auto-expire typing after TYPING_EXPIRY_MS
        const existingTimer = typingExpiryTimers.current.get(userId);
        if (existingTimer) clearTimeout(existingTimer);
        typingExpiryTimers.current.set(
          userId,
          setTimeout(() => {
            if (!isMounted) return;
            setTypingUsers((prev) => prev.filter((id) => id !== userId));
            typingExpiryTimers.current.delete(userId);
          }, TYPING_EXPIRY_MS)
        );
      })
      .on('broadcast', { event: 'typing_stop' }, (payload) => {
        const { userId } = payload.payload || {};
        if (!userId || userId === currentUserId || !isMounted) return;

        setTypingUsers((prev) => prev.filter((id) => id !== userId));
        const existingTimer = typingExpiryTimers.current.get(userId);
        if (existingTimer) {
          clearTimeout(existingTimer);
          typingExpiryTimers.current.delete(userId);
        }
      })
      // Listen to postgres_changes on conversation_presence for persistent state updates
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversation_presence',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const record = payload.new as PresenceChangePayload | undefined;
          if (!record?.user_id || record.user_id === currentUserId || !isMounted) return;

          const isActuallyOnline =
            record.is_online &&
            Date.now() - new Date(record.updated_at).getTime() < STALE_THRESHOLD_MS;

          setParticipants((prev) => ({
            ...prev,
            [record.user_id]: {
              isOnline: isActuallyOnline,
              lastSeenAt: record.last_seen_at,
            },
          }));
        }
      )
      .subscribe();

    // 4. AppState listener — mark offline on background, online on foreground
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (!conversationId || !currentUserId) return;

      if (nextState === 'active') {
        upsertPresence(conversationId, currentUserId, true);
      } else if (nextState === 'background' || nextState === 'inactive') {
        // Mark all conversations offline (not just this one)
        markAllConversationsOffline(currentUserId);
      }
    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    // 5. Cleanup
    return () => {
      isMounted = false;

      // Mark offline for this conversation
      upsertPresence(conversationId, currentUserId, false);

      // Unsubscribe from channel
      supabase.removeChannel(channel);

      // Clean up app state listener
      appStateSubscription.remove();

      // Clear typing expiry timers
      typingExpiryTimers.current.forEach((timer) => clearTimeout(timer));
      typingExpiryTimers.current.clear();

      // Clear own typing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [conversationId, currentUserId]);

  // --- Heartbeat (Amendment 5a) ---
  useEffect(() => {
    if (!conversationId || !currentUserId) return;

    const heartbeatInterval = setInterval(() => {
      upsertPresence(conversationId, currentUserId, true);
    }, HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(heartbeatInterval);
  }, [conversationId, currentUserId]);

  // --- Typing controls ---
  const startTyping = useCallback(() => {
    if (!conversationId || !currentUserId) return;

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      broadcastTyping(conversationId, currentUserId, true);
    }

    // Reset the auto-stop timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      stopTyping();
    }, TYPING_TIMEOUT_MS);
  }, [conversationId, currentUserId]);

  const stopTyping = useCallback(() => {
    if (!conversationId || !currentUserId) return;

    if (isTypingRef.current) {
      isTypingRef.current = false;
      broadcastTyping(conversationId, currentUserId, false);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  }, [conversationId, currentUserId]);

  return { participants, typingUsers, startTyping, stopTyping };
}
