import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { realtimeService } from '../services/realtimeService';
import { useAppStore } from '../store/appStore';
import { CollaborationSession, CollaborationInvite } from '../types';

export const useRealtimeSession = () => {
  const { user, currentSession, setCurrentSession, setAvailableSessions, setPendingInvites } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionMessages, setSessionMessages] = useState<any[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);

  // Load user sessions
  const loadUserSessions = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      // Load available sessions where user is a participant
      const { data: sessions, error: sessionsError } = await supabase
        .from('collaboration_sessions')
        .select(`
          *,
          session_participants!inner(
            user_id,
            role,
            joined_at
          )
        `)
        .eq('session_participants.user_id', user.id)
        .eq('status', 'active');

      if (sessionsError) throw sessionsError;

      // Load pending invites
      const { data: invites, error: invitesError } = await supabase
        .from('collaboration_invites')
        .select(`
          *,
          collaboration_sessions(name, status),
          profiles!collaboration_invites_inviter_id_fkey(display_name, email)
        `)
        .eq('invited_user_id', user.id)
        .eq('status', 'pending');

      if (invitesError) throw invitesError;

      setAvailableSessions(sessions || []);
      setPendingInvites(invites || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, setAvailableSessions, setPendingInvites]);

  // Create collaborative session
  const createCollaborativeSession = useCallback(async (
    participantEmails: string[],
    sessionName: string
  ) => {
    if (!user) return { data: null, error: new Error('No user logged in') };

    setLoading(true);
    setError(null);

    try {
      // Create session
      // Status starts as 'pending' until at least 2 members have accepted
      const { data: session, error: sessionError } = await supabase
        .from('collaboration_sessions')
        .insert({
          name: sessionName,
          created_by: user.id,
          status: 'pending',
        })
        .select()
        .single();

      if (sessionError) throw sessionError;

      // Add creator as participant
      const { error: creatorError } = await supabase
        .from('session_participants')
        .insert({
          session_id: session.id,
          user_id: user.id,
          role: 'admin',
        });

      if (creatorError) throw creatorError;

      // Send invites to participants
      for (const email of participantEmails) {
        // Get user by email
        const { data: invitedUser, error: userError } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', email)
          .single();

        if (userError || !invitedUser) {
          console.warn(`User not found for email: ${email}`);
          continue;
        }

        // Create invite
        const { error: inviteError } = await supabase
          .from('collaboration_invites')
          .insert({
            session_id: session.id,
            inviter_id: user.id,
            invited_user_id: invitedUser.id,
            status: 'pending',
          });

        if (inviteError) {
          console.error(`Error creating invite for ${email}:`, inviteError);
        }
      }

      // Reload sessions
      await loadUserSessions();

      return { data: session, error: null };
    } catch (err: any) {
      setError(err.message);
      return { data: null, error: err };
    } finally {
      setLoading(false);
    }
  }, [user, loadUserSessions]);

  // Accept invite
  const acceptInvite = useCallback(async (inviteId: string) => {
    setLoading(true);
    setError(null);

    try {
      // Update invite status
      const { data: invite, error: inviteError } = await supabase
        .from('collaboration_invites')
        .update({ status: 'accepted' })
        .eq('id', inviteId)
        .select()
        .single();

      if (inviteError) throw inviteError;

      // Add user as participant
      const { error: participantError } = await supabase
        .from('session_participants')
        .insert({
          session_id: invite.session_id,
          user_id: user?.id,
          role: 'member',
        });

      if (participantError) throw participantError;

      // Reload sessions
      await loadUserSessions();

      return { data: invite, error: null };
    } catch (err: any) {
      setError(err.message);
      return { data: null, error: err };
    } finally {
      setLoading(false);
    }
  }, [user, loadUserSessions]);

  // Decline invite
  const declineInvite = useCallback(async (inviteId: string) => {
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase
        .from('collaboration_invites')
        .update({ status: 'declined' })
        .eq('id', inviteId);

      if (error) throw error;

      // Reload sessions
      await loadUserSessions();

      return { data: null, error: null };
    } catch (err: any) {
      setError(err.message);
      return { data: null, error: err };
    } finally {
      setLoading(false);
    }
  }, [loadUserSessions]);

  // Switch to collaborative session
  const switchToCollaborative = useCallback(async (sessionId: string) => {
    if (!user) return { data: null, error: new Error('No user logged in') };

    setLoading(true);
    setError(null);

    try {
      // Get session details
      const { data: session, error: sessionError } = await supabase
        .from('collaboration_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (sessionError) throw sessionError;

      // Set as current session
      setCurrentSession(session);

      // Subscribe to real-time updates
      realtimeService.subscribeToSession(sessionId, {
        onParticipantJoined: (participant) => {
          // Reload participants
          loadSessionParticipants(sessionId);
        },
        onParticipantLeft: (participant) => {
          // Reload participants
          loadSessionParticipants(sessionId);
        },
        onSessionUpdated: (updatedSession) => {
          setCurrentSession(updatedSession);
        },
        onMessage: (message) => {
          setSessionMessages(prev => [...prev, message]);
        },
      });

      // Load session participants
      await loadSessionParticipants(sessionId);

      return { data: session, error: null };
    } catch (err: any) {
      setError(err.message);
      return { data: null, error: err };
    } finally {
      setLoading(false);
    }
  }, [user, setCurrentSession]);

  // Switch to solo mode
  const switchToSolo = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Unsubscribe from current session
      if (currentSession) {
        realtimeService.unsubscribe(`session:${currentSession.id}`);
      }

      // Clear current session
      setCurrentSession(null);
      setParticipants([]);
      setSessionMessages([]);

      return { data: null, error: null };
    } catch (err: any) {
      setError(err.message);
      return { data: null, error: err };
    } finally {
      setLoading(false);
    }
  }, [currentSession, setCurrentSession]);

  // Load session participants
  const loadSessionParticipants = useCallback(async (sessionId: string) => {
    try {
      const { data: participants, error } = await supabase
        .from('session_participants')
        .select(`
          *,
          profiles(display_name, email, avatar_url)
        `)
        .eq('session_id', sessionId);

      if (error) throw error;

      setParticipants(participants || []);
    } catch (err) {
      console.error('Error loading participants:', err);
    }
  }, []);

  // Send message to session
  const sendMessage = useCallback(async (message: string) => {
    if (!currentSession) return { error: new Error('No active session') };

    try {
      realtimeService.sendSessionMessage(currentSession.id, {
        type: 'text',
        content: message,
        data: {
          sender: user?.display_name || user?.email,
          senderId: user?.id,
        }
      });

      return { error: null };
    } catch (err: any) {
      return { error: err };
    }
  }, [currentSession, user]);

  // Load initial data
  useEffect(() => {
    loadUserSessions();
  }, [loadUserSessions]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      realtimeService.unsubscribeAll();
    };
  }, []);

  return {
    // State
    loading,
    error,
    sessionMessages,
    participants,
    
    // Actions
    loadUserSessions,
    createCollaborativeSession,
    acceptInvite,
    declineInvite,
    switchToCollaborative,
    switchToSolo,
    sendMessage,
    loadSessionParticipants,
  };
};
