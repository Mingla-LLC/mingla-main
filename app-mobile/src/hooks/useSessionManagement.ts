import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { useAppStore } from '../store/appStore';
import { CollaborationSession, CollaborationInvite, SessionParticipant } from '../types';

export const useSessionManagement = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const {
    user,
    currentSession,
    availableSessions,
    pendingInvites,
    isInSolo,
    setCurrentSession,
    setAvailableSessions,
    setPendingInvites,
    setIsInSolo,
  } = useAppStore();

  // Load user's sessions and invites
  const loadUserSessions = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    try {
      // Load sessions where user is a participant
      const { data: sessions, error: sessionsError } = await supabase
        .from('collaboration_sessions')
        .select(`
          *,
          session_participants!inner (
            *,
            profiles (*)
          )
        `)
        .eq('session_participants.user_id', user.id)
        .eq('session_participants.has_accepted', true);

      if (sessionsError) throw sessionsError;

      // Load pending invites
      const { data: invites, error: invitesError } = await supabase
        .from('collaboration_invites')
        .select(`
          *,
          collaboration_sessions (*),
          profiles!collaboration_invites_invited_by_fkey (*)
        `)
        .eq('invited_user_id', user.id)
        .eq('status', 'pending');

      if (invitesError) throw invitesError;

      setAvailableSessions(sessions || []);
      setPendingInvites(invites || []);
    } catch (err: any) {
      setError(err.message);
      console.error('Error loading sessions:', err);
    } finally {
      setLoading(false);
    }
  }, [user, setAvailableSessions, setPendingInvites]);

  // Create new collaborative session
  const createCollaborativeSession = useCallback(async (participants: string[], sessionName: string) => {
    if (!user) {
      throw new Error('User not authenticated');
    }

    setLoading(true);
    try {
      // Create the session
      const { data: sessionData, error: sessionError } = await supabase
        .from('collaboration_sessions')
        .insert({
          name: sessionName || `Collaboration Session ${new Date().toLocaleDateString()}`,
          created_by: user.id,
          status: 'pending',
          board_id: null,
        })
        .select()
        .single();

      if (sessionError) throw sessionError;

      // Add creator as participant (auto-accepted)
      const { error: creatorParticipantError } = await supabase
        .from('session_participants')
        .insert({
          session_id: sessionData.id,
          user_id: user.id,
          has_accepted: true,
          joined_at: new Date().toISOString(),
        });

      if (creatorParticipantError) throw creatorParticipantError;

      // Process participants
      const participantPromises = participants.map(async (participantId) => {
        // Create invite
        const { error: inviteError } = await supabase
          .from('collaboration_invites')
          .insert({
            session_id: sessionData.id,
            invited_by: user.id,
            invited_user_id: participantId,
            status: 'pending',
          });

        if (inviteError) {
          console.error('Error creating invite:', inviteError);
        }
      });

      await Promise.all(participantPromises);

      // Reload sessions
      await loadUserSessions();

      return { data: sessionData, error: null };
    } catch (err: any) {
      setError(err.message);
      return { data: null, error: err };
    } finally {
      setLoading(false);
    }
  }, [user, loadUserSessions]);

  // Accept collaboration invite
  const acceptInvite = useCallback(async (inviteId: string) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

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
          user_id: user.id,
          has_accepted: true,
          joined_at: new Date().toISOString(),
        });

      if (participantError) throw participantError;

      // Reload sessions and invites
      await loadUserSessions();

      return { error: null };
    } catch (err: any) {
      setError(err.message);
      return { error: err };
    } finally {
      setLoading(false);
    }
  }, [loadUserSessions]);

  // Decline collaboration invite
  const declineInvite = useCallback(async (inviteId: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('collaboration_invites')
        .update({ status: 'declined' })
        .eq('id', inviteId);

      if (error) throw error;

      // Reload invites
      await loadUserSessions();

      return { error: null };
    } catch (err: any) {
      setError(err.message);
      return { error: err };
    } finally {
      setLoading(false);
    }
  }, [loadUserSessions]);

  // Switch to collaborative session
  const switchToCollaborative = useCallback(async (sessionId: string) => {
    try {
      const session = availableSessions.find(s => s.id === sessionId);
      if (!session) throw new Error('Session not found');

      setCurrentSession(session);
      setIsInSolo(false);

      // Store in localStorage for persistence
      localStorage.setItem('collaboration_session_state', JSON.stringify({
        currentSession: session,
        isInSolo: false,
      }));

      return { error: null };
    } catch (err: any) {
      setError(err.message);
      return { error: err };
    }
  }, [availableSessions, setCurrentSession, setIsInSolo]);

  // Switch to solo mode
  const switchToSolo = useCallback(async () => {
    try {
      setCurrentSession(null);
      setIsInSolo(true);

      // Store in localStorage for persistence
      localStorage.setItem('collaboration_session_state', JSON.stringify({
        currentSession: null,
        isInSolo: true,
      }));

      return { error: null };
    } catch (err: any) {
      setError(err.message);
      return { error: err };
    }
  }, [setCurrentSession, setIsInSolo]);

  // Cancel session
  const cancelSession = useCallback(async (sessionId: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('collaboration_sessions')
        .update({ status: 'dormant' })
        .eq('id', sessionId);

      if (error) throw error;

      // If this was the current session, switch to solo
      if (currentSession?.id === sessionId) {
        await switchToSolo();
      }

      // Reload sessions
      await loadUserSessions();

      return { error: null };
    } catch (err: any) {
      setError(err.message);
      return { error: err };
    } finally {
      setLoading(false);
    }
  }, [currentSession, switchToSolo, loadUserSessions]);

  // Set up real-time subscriptions
  useEffect(() => {
    if (!user) return;

    // Subscribe to session changes
    const sessionChannel = supabase
      .channel('session_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collaboration_sessions',
        },
        () => {
          loadUserSessions();
        }
      )
      .subscribe();

    // Subscribe to invite changes
    const inviteChannel = supabase
      .channel('invite_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collaboration_invites',
          filter: `invited_user_id=eq.${user.id}`,
        },
        () => {
          loadUserSessions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sessionChannel);
      supabase.removeChannel(inviteChannel);
    };
  }, [user, loadUserSessions]);

  // Load sessions on mount
  useEffect(() => {
    loadUserSessions();
  }, [loadUserSessions]);

  return {
    currentSession,
    availableSessions,
    pendingInvites,
    isInSolo,
    loading,
    error,
    createCollaborativeSession,
    acceptInvite,
    declineInvite,
    switchToCollaborative,
    switchToSolo,
    cancelSession,
    loadUserSessions,
  };
};
