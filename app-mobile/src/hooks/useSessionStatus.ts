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
  status: SessionStatus;
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
  const [status, setStatus] = useState<SessionStatus>('active');

  const isCreator = Boolean(userId && creatorId && userId === creatorId);

  // Load initial status
  useEffect(() => {
    if (!sessionId) return;

    const loadStatus = async () => {
      const { data, error } = await supabase
        .from('collaboration_sessions')
        .select('status')
        .eq('id', sessionId)
        .single();

      if (!error && data) {
        setStatus((data.status as SessionStatus) || 'active');
      }
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
    } catch (err: any) {
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
    } catch (err: any) {
      console.error('[useSessionStatus] Error marking completed:', err);
      Alert.alert('Error', 'Failed to mark session as completed');
    }
  }, [sessionId, isCreator, status]);

  return {
    status,
    canGenerateCards: status === 'active',
    canVote: status === 'active' || status === 'voting',
    canRSVP: status === 'active' || status === 'voting',
    isLocked: status === 'locked',
    isCompleted: status === 'completed',
    advanceToVoting,
    markCompleted,
    isCreator,
  };
}
