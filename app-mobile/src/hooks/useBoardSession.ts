import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { useAppStore } from '../store/appStore';
import { realtimeService } from '../services/realtimeService';
import { BoardInviteService } from '../services/boardInviteService';

export interface BoardSession {
  id: string;
  name: string;
  session_type: 'board' | 'collaboration';
  board_id?: string;
  invite_code?: string;
  invite_link?: string;
  max_participants?: number;
  is_active: boolean;
  created_by: string;
  created_at: string;
  last_activity_at?: string;
  participants?: any[];
}

export interface BoardSessionPreferences {
  session_id: string;
  categories?: string[];
  budget_min?: number;
  budget_max?: number;
  group_size?: number;
  experience_types?: string[];
}

export const useBoardSession = (sessionId?: string) => {
  const [session, setSession] = useState<BoardSession | null>(null);
  const [preferences, setPreferences] = useState<BoardSessionPreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAppStore();

  // Load session data
  const loadSession = useCallback(async (id: string) => {
    if (!id || !user) return;

    setLoading(true);
    setError(null);

    try {
      // Load session
      const { data: sessionData, error: sessionError } = await supabase
        .from('collaboration_sessions')
        .select('*')
        .eq('id', id)
        .single();

      if (sessionError) throw sessionError;

      // Load preferences for the current user
      const { data: prefsData, error: prefsError } = await supabase
        .from('board_session_preferences')
        .select('*')
        .eq('session_id', id)
        .eq('user_id', user?.id || '')
        .single();

      if (prefsError && prefsError.code !== 'PGRST116') {
        console.error('Error loading preferences:', prefsError);
      }

      // Load participants
      const { data: participantsData, error: participantsError } = await supabase
        .from('session_participants')
        .select(`
          *,
          profiles (
            id,
            username,
            display_name,
            first_name,
            last_name,
            avatar_url
          )
        `)
        .eq('session_id', id);

      if (participantsError) {
        console.error('Error loading participants:', participantsError);
      }

      setSession({
        ...sessionData,
        participants: participantsData || [],
      } as BoardSession);

      if (prefsData) {
        setPreferences(prefsData as BoardSessionPreferences);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load session');
      console.error('Error loading session:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Update preferences
  const updatePreferences = useCallback(async (newPreferences: Partial<BoardSessionPreferences>) => {
    if (!sessionId || !user) return;

    try {
      const { error } = await supabase
        .from('board_session_preferences')
        .upsert({
          session_id: sessionId,
          user_id: user.id,
          ...newPreferences,
        }, {
          onConflict: 'session_id,user_id',
        });

      if (error) throw error;

      setPreferences(prev => ({
        ...prev,
        ...newPreferences,
        session_id: sessionId,
      } as BoardSessionPreferences));
    } catch (err: any) {
      setError(err.message || 'Failed to update preferences');
      throw err;
    }
  }, [sessionId, user]);

  // Get invite link
  const getInviteLink = useCallback(async () => {
    if (!sessionId) return null;

    const linkData = await BoardInviteService.generateInviteLink(sessionId);
    return linkData;
  }, [sessionId]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!sessionId) return;

    const channel = realtimeService.subscribeToBoardSession(sessionId, {
      onSessionUpdated: (updatedSession) => {
        setSession(prev => prev ? { ...prev, ...updatedSession } : null);
      },
      onParticipantJoined: (participant) => {
        setSession(prev => {
          if (!prev) return null;
          const existing = prev.participants || [];
          if (existing.find(p => p.user_id === participant.user_id)) {
            return prev;
          }
          return {
            ...prev,
            participants: [...existing, participant],
          };
        });
      },
      onParticipantLeft: (participant) => {
        setSession(prev => {
          if (!prev) return null;
          return {
            ...prev,
            participants: (prev.participants || []).filter(
              p => p.user_id !== participant.user_id
            ),
          };
        });
      },
    });

    return () => {
      realtimeService.unsubscribe(`board_session:${sessionId}`);
    };
  }, [sessionId]);

  // Load session on mount or when sessionId or user changes
  useEffect(() => {
    if (sessionId && user) {
      loadSession(sessionId);
    }
  }, [sessionId, user?.id, loadSession]);

  return {
    session,
    preferences,
    loading,
    error,
    loadSession,
    updatePreferences,
    getInviteLink,
  };
};

