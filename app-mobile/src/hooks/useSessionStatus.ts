import { useState, useCallback, useEffect } from 'react';
import { Alert } from 'react-native';
import { supabase } from '../services/supabase';
import { realtimeService } from '../services/realtimeService';

export type SessionStatus =
  | 'pending'
  | 'active'
  | 'voting'
  | 'locked'
  | 'completed'
  | 'archived'
  | 'dormant';

export interface UseSessionStatusReturn {
  status: SessionStatus | null;
  isStatusLoaded: boolean;
  canGenerateCards: boolean;
  canVote: boolean;
  canRSVP: boolean;
  isLocked: boolean;
  isCompleted: boolean;
  advanceToVoting: () => Promise<void>;
  markCompleted: () => Promise<void>;
  isCreator: boolean;
}

export function useSessionStatus(
  sessionId: string | null,
  creatorId: string | undefined,
  userId: string | undefined,
): UseSessionStatusReturn {
  // C3 FIX: Default to null (unknown) instead of 'active'.
  // This prevents the UI from showing action buttons before the real status loads.
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [isStatusLoaded, setIsStatusLoaded] = useState(false);

  const isCreator = Boolean(userId && creatorId && userId === creatorId);

  // Load initial status
  useEffect(() => {
    if (!sessionId) {
      setStatus(null);
      setIsStatusLoaded(false);
      return;
    }

    setIsStatusLoaded(false);

    const loadStatus = async () => {
      const { data, error } = await supabase
        .from('collaboration_sessions')
        .select('status')
        .eq('id', sessionId)
        .single();

      if (!error && data?.status) {
        setStatus(data.status as SessionStatus);
      } else {
        // If we can't load status, default to pending (safest — no action buttons)
        setStatus('pending');
      }
      setIsStatusLoaded(true);
    };

    loadStatus();
  }, [sessionId]);

  // Listen for realtime status updates
  useEffect(() => {
    if (!sessionId) return;

    const callbacks = {
      onSessionUpdated: (session: Record<string, unknown>) => {
        if (session?.status) {
          setStatus(session.status as SessionStatus);
        }
      },
    };

    realtimeService.subscribeToBoardSession(sessionId, callbacks);

    return () => {
      realtimeService.unregisterBoardCallbacks(sessionId, callbacks);
    };
  }, [sessionId]);

  // Creator-only: advance to voting
  const advanceToVoting = useCallback(async () => {
    if (!sessionId || !isCreator) return;

    if (status !== 'active') {
      Alert.alert('Cannot Start Voting', 'Voting can only be started when the session is active.');
      return;
    }

    try {
      const { error } = await supabase
        .from('collaboration_sessions')
        .update({ status: 'voting', updated_at: new Date().toISOString() })
        .eq('id', sessionId);

      if (error) throw error;

      setStatus('voting');
    } catch (err: unknown) {
      console.error('[useSessionStatus] Error advancing to voting:', err);
      Alert.alert('Error', 'Failed to start voting phase');
    }
  }, [sessionId, isCreator, status]);

  // Creator-only: mark completed
  const markCompleted = useCallback(async () => {
    if (!sessionId || !isCreator) return;

    if (status !== 'locked') {
      Alert.alert('Cannot Complete', 'The session can only be marked complete after a card is locked in.');
      return;
    }

    try {
      const { error } = await supabase
        .from('collaboration_sessions')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', sessionId);

      if (error) throw error;

      setStatus('completed');
    } catch (err: unknown) {
      console.error('[useSessionStatus] Error marking completed:', err);
      Alert.alert('Error', 'Failed to mark session as completed');
    }
  }, [sessionId, isCreator, status]);

  // C3 FIX: All boolean flags are false until status is loaded.
  // This prevents premature UI rendering of action buttons.
  return {
    status,
    isStatusLoaded,
    canGenerateCards: isStatusLoaded && status === 'active',
    canVote: isStatusLoaded && (status === 'active' || status === 'voting'),
    canRSVP: isStatusLoaded && (status === 'active' || status === 'voting'),
    isLocked: isStatusLoaded && status === 'locked',
    isCompleted: isStatusLoaded && status === 'completed',
    advanceToVoting,
    markCompleted,
    isCreator,
  };
}
