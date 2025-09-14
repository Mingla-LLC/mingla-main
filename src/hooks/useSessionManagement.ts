import { useState, useEffect, useCallback } from 'react';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';

export interface CollaborationSession {
  id: string;
  name: string;
  participants: Array<{
    id: string;
    name: string;
    username: string;
    avatar: string;
    hasAccepted: boolean;
  }>;
  createdAt: string;
  isActive: boolean;
  boardId?: string;
  status: 'pending' | 'active' | 'dormant';
  invitedBy: string;
}

export interface SessionInvite {
  id: string;
  sessionId: string;
  sessionName: string;
  invitedBy: {
    id: string;
    name: string;
    username: string;
    avatar?: string;
  };
  message?: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  createdAt: string;
}

export interface SessionState {
  currentSession: CollaborationSession | null;
  availableSessions: CollaborationSession[];
  pendingInvites: SessionInvite[];
  isInSolo: boolean;
  loading: boolean;
}

export const useSessionManagement = () => {
  const [sessionState, setSessionState] = useState<SessionState>({
    currentSession: null,
    availableSessions: [],
    pendingInvites: [],
    isInSolo: true,
    loading: false
  });
  
  const { user } = useAppStore();

  // Load user's sessions and invites
  const loadUserSessions = useCallback(async () => {
    if (!user) return;
    
    console.log('LoadUserSessions called for user:', user.id);
    setSessionState(prev => ({ ...prev, loading: true }));
    
    try {
      // Load pending invites for user first
      const { data: invitesData, error: invitesError } = await supabase
        .from('collaboration_invites')
        .select(`
          id, session_id, message, status, created_at, invited_by
        `)
        .eq('invited_user_id', user.id)
        .eq('status', 'pending');

      console.log('Raw invites data:', invitesData);
      console.log('Invites error:', invitesError);

      // Load sessions where user is creator or participant
      const { data: sessionsData, error: sessionsError } = await supabase
        .from('collaboration_sessions')
        .select(`
          id, name, created_by, board_id, status, created_at, updated_at
        `)
        .or(`created_by.eq.${user.id},id.in.(select session_id from session_participants where user_id = '${user.id}')`);

      if (sessionsError) throw sessionsError;

      // Load session participants separately
      const sessionIds = (sessionsData || []).map(s => s.id);
      let participantsData: any[] = [];
      
      if (sessionIds.length > 0) {
        const { data: pData } = await supabase
          .from('session_participants')
          .select(`
            session_id, user_id, has_accepted, joined_at,
            profiles!session_participants_user_id_fkey (id, username, first_name, last_name, avatar_url)
          `)
          .in('session_id', sessionIds);
        
        participantsData = pData || [];
      }

      // Load session names and invited by profiles for invites
      const inviteSessionIds = (invitesData || []).map(i => i.session_id);
      let sessionNamesData: any[] = [];
      let invitedByIds: string[] = [];

      if (inviteSessionIds.length > 0) {
        const { data: sData } = await supabase
          .from('collaboration_sessions')
          .select('id, name, created_by')
          .in('id', inviteSessionIds);
        
        sessionNamesData = sData || [];
        invitedByIds = sessionNamesData.map(s => s.created_by);
      }

      let invitedByProfiles: any[] = [];
      if (invitedByIds.length > 0) {
        const { data: pData } = await supabase
          .from('profiles')
          .select('id, username, first_name, last_name, avatar_url')
          .in('id', invitedByIds);
        
        invitedByProfiles = pData || [];
      }

      // Format sessions
      const formattedSessions: CollaborationSession[] = (sessionsData || []).map(session => {
        const sessionParticipants = participantsData.filter(p => p.session_id === session.id);
        const participants = sessionParticipants.map(p => ({
          id: p.profiles?.id || p.user_id,
          name: p.profiles?.first_name && p.profiles?.last_name 
            ? `${p.profiles.first_name} ${p.profiles.last_name}` 
            : p.profiles?.username || 'Unknown User',
          username: p.profiles?.username || 'unknown',
          avatar: p.profiles?.avatar_url || '',
          hasAccepted: p.has_accepted
        }));

        const allAccepted = participants.length > 0 && participants.every(p => p.hasAccepted);
        
        return {
          id: session.id,
          name: session.name,
          participants,
          createdAt: session.created_at,
          isActive: allAccepted && session.status === 'active',
          boardId: session.board_id,
          status: allAccepted ? 'active' : session.status as 'pending' | 'active' | 'dormant',
          invitedBy: session.created_by
        };
      });

      // Format invites
      const formattedInvites: SessionInvite[] = (invitesData || []).map(invite => {
        const sessionInfo = sessionNamesData.find(s => s.id === invite.session_id);
        const invitedByProfile = invitedByProfiles.find(p => p.id === invite.invited_by);
        
        return {
          id: invite.id,
          sessionId: invite.session_id,
          sessionName: sessionInfo?.name || 'Collaboration Session',
          invitedBy: {
            id: invitedByProfile?.id || invite.invited_by || '',
            name: invitedByProfile?.first_name && invitedByProfile?.last_name
              ? `${invitedByProfile.first_name} ${invitedByProfile.last_name}`
              : invitedByProfile?.username || 'Unknown User',
            username: invitedByProfile?.username || 'unknown',
            avatar: invitedByProfile?.avatar_url
          },
          message: invite.message,
          status: invite.status as 'pending',
          createdAt: invite.created_at
        };
      });

      setSessionState(prev => ({
        ...prev,
        availableSessions: formattedSessions,
        pendingInvites: formattedInvites,
        loading: false
      }));
    } catch (error) {
      console.error('Error loading sessions:', error);
      setSessionState(prev => ({ ...prev, loading: false }));
    }
  }, [user]);

  // Load sessions on mount and when user changes
  useEffect(() => {
    loadUserSessions();
  }, [loadUserSessions]);

  // Switch to solo session
  const switchToSolo = useCallback(() => {
    if (sessionState.currentSession) {
      toast({
        title: "Left collaboration session",
        description: `You've left "${sessionState.currentSession.name}"`,
      });
    }
    
    setSessionState(prev => ({
      ...prev,
      currentSession: null,
      isInSolo: true
    }));
  }, [sessionState.currentSession]);

  // Switch to collaborative session
  const switchToCollaborative = useCallback(async (sessionId: string) => {
    const session = sessionState.availableSessions.find(s => s.id === sessionId);
    if (!session) return;

    setSessionState(prev => ({
      ...prev,
      currentSession: session,
      isInSolo: false
    }));

    toast({
      title: session.boardId ? "Rejoined collaboration" : "Collaboration started!",
      description: session.boardId 
        ? `Welcome back to "${session.name}"` 
        : `A board will be created for "${session.name}" when all participants join.`,
    });
  }, [sessionState.availableSessions]);

  // Create new collaborative session
  const createCollaborativeSession = useCallback(async (participants: string[], sessionName: string) => {
    if (!user) return null;

    try {
      // Create the session
      const { data: sessionData, error: sessionError } = await supabase
        .from('collaboration_sessions')
        .insert({
          name: sessionName || `Collaboration Session ${new Date().toLocaleDateString()}`,
          created_by: user.id,
          status: 'pending'
        })
        .select()
        .single();

      if (sessionError) throw sessionError;

      // Add creator as participant (auto-accepted)
      const { error: participantError } = await supabase
        .from('session_participants')
        .insert({
          session_id: sessionData.id,
          user_id: user.id,
          has_accepted: true,
          joined_at: new Date().toISOString()
        });

      if (participantError) throw participantError;

      // Send invites to participants
      for (const username of participants) {
        // Find user by username
        const { data: invitedUser } = await supabase
          .from('profiles')
          .select('id')
          .eq('username', username)
          .single();

        if (invitedUser) {
          // Create participant record
          await supabase
            .from('session_participants')
            .insert({
              session_id: sessionData.id,
              user_id: invitedUser.id,
              has_accepted: false
            });

          // Send invite
          await supabase
            .from('collaboration_invites')
            .insert({
              session_id: sessionData.id,
              invited_by: user.id,
              invited_user_id: invitedUser.id,
              status: 'pending'
            });
        }
      }

      await loadUserSessions();
      
      toast({
        title: "Session created!",
        description: `Invites sent to ${participants.length} user(s). They'll be notified to join "${sessionName}".`,
      });

      return sessionData;
    } catch (error) {
      console.error('Error creating session:', error);
      toast({
        title: "Error",
        description: "Failed to create collaboration session",
        variant: "destructive"
      });
      return null;
    }
  }, [user, loadUserSessions]);

  // Accept session invitation
  const acceptSessionInvitation = useCallback(async (inviteId: string) => {
    if (!user) return;

    try {
      // Update invite status
      const { error: inviteError } = await supabase
        .from('collaboration_invites')
        .update({ status: 'accepted' })
        .eq('id', inviteId);

      if (inviteError) throw inviteError;

      // Update participant status
      const invite = sessionState.pendingInvites.find(i => i.id === inviteId);
      if (invite) {
        const { error: participantError } = await supabase
          .from('session_participants')
          .update({ 
            has_accepted: true, 
            joined_at: new Date().toISOString() 
          })
          .eq('session_id', invite.sessionId)
          .eq('user_id', user.id);

        if (participantError) throw participantError;

        // Check if all participants have accepted
        const { data: allParticipants } = await supabase
          .from('session_participants')
          .select('has_accepted')
          .eq('session_id', invite.sessionId);

        const allAccepted = allParticipants?.every(p => p.has_accepted) || false;

        if (allAccepted) {
          // Create board for the session
          const { data: boardData, error: boardError } = await supabase
            .from('boards')
            .insert({
              name: invite.sessionName,
              created_by: invite.invitedBy.id,
              session_id: invite.sessionId,
              description: `Collaborative board for ${invite.sessionName}`
            })
            .select()
            .single();

          if (!boardError && boardData) {
            // Update session with board_id
            await supabase
              .from('collaboration_sessions')
              .update({ 
                board_id: boardData.id, 
                status: 'active' 
              })
              .eq('id', invite.sessionId);
          }

          // Update session status
          await supabase
            .from('collaboration_sessions')
            .update({ status: 'active' })
            .eq('id', invite.sessionId);
        }

        await loadUserSessions();
        
        toast({
          title: "Invitation accepted!",
          description: allAccepted 
            ? `All participants have joined! A board has been created for "${invite.sessionName}".`
            : "You've joined the collaboration session. Waiting for other participants.",
        });
      }
    } catch (error) {
      console.error('Error accepting invitation:', error);
      toast({
        title: "Error",
        description: "Failed to accept invitation",
        variant: "destructive"
      });
    }
  }, [user, sessionState.pendingInvites, loadUserSessions]);

  // Decline session invitation
  const declineSessionInvitation = useCallback(async (inviteId: string) => {
    try {
      const { error } = await supabase
        .from('collaboration_invites')
        .update({ status: 'declined' })
        .eq('id', inviteId);

      if (error) throw error;

      await loadUserSessions();
      
      toast({
        title: "Invitation declined",
        description: "You've declined the collaboration invitation.",
      });
    } catch (error) {
      console.error('Error declining invitation:', error);
      toast({
        title: "Error",
        description: "Failed to decline invitation",
        variant: "destructive"
      });
    }
  }, [loadUserSessions]);

  // Cancel sent invitation
  const cancelSessionInvitation = useCallback(async (sessionId: string, userId: string) => {
    try {
      const { error } = await supabase
        .from('collaboration_invites')
        .update({ status: 'cancelled' })
        .eq('session_id', sessionId)
        .eq('invited_user_id', userId);

      if (error) throw error;

      // Remove participant
      await supabase
        .from('session_participants')
        .delete()
        .eq('session_id', sessionId)
        .eq('user_id', userId);

      await loadUserSessions();
      
      toast({
        title: "Invitation cancelled",
        description: "The collaboration invitation has been cancelled.",
      });
    } catch (error) {
      console.error('Error cancelling invitation:', error);
      toast({
        title: "Error",
        description: "Failed to cancel invitation",
        variant: "destructive"
      });
    }
  }, [loadUserSessions]);

  // Cancel entire session (for session creator)
  const cancelEntireSession = useCallback(async (sessionId: string) => {
    try {
      // Cancel all pending invites for this session
      const { error: invitesError } = await supabase
        .from('collaboration_invites')
        .update({ status: 'cancelled' })
        .eq('session_id', sessionId)
        .eq('status', 'pending');

      if (invitesError) throw invitesError;

      // Delete the session
      const { error: sessionError } = await supabase
        .from('collaboration_sessions')
        .delete()
        .eq('id', sessionId);

      if (sessionError) throw sessionError;

      // Remove all participants
      await supabase
        .from('session_participants')
        .delete()
        .eq('session_id', sessionId);

      await loadUserSessions();
      
      toast({
        title: "Session cancelled",
        description: "The collaboration session has been cancelled.",
      });
    } catch (error) {
      console.error('Error cancelling session:', error);
      toast({
        title: "Error",
        description: "Failed to cancel session",
        variant: "destructive"
      });
    }
  }, [loadUserSessions]);

  // Get friends for session creation
  const getFriendsAndCollaborators = useCallback(async () => {
    if (!user) return { friends: [], recentCollaborators: [] };

    try {
      // Get friends
      const { data: friendsData } = await supabase
        .from('friends')
        .select('friend_user_id')
        .eq('user_id', user.id)
        .eq('status', 'accepted');

      let friends: any[] = [];
      if (friendsData && friendsData.length > 0) {
        const friendUserIds = friendsData.map(f => f.friend_user_id);
        const { data: friendProfiles } = await supabase
          .from('profiles')
          .select('id, username, first_name, last_name, avatar_url')
          .in('id', friendUserIds);

        friends = (friendProfiles || []).map(f => ({
          id: f.id,
          name: f.first_name && f.last_name 
            ? `${f.first_name} ${f.last_name}` 
            : f.username || 'Unknown',
          username: f.username || 'unknown',
          avatar: f.avatar_url || ''
        }));
      }

      // Get user's session IDs first
      const { data: userSessionsData } = await supabase
        .from('session_participants')
        .select('session_id')
        .eq('user_id', user.id);

      const userSessionIds = (userSessionsData || []).map(s => s.session_id);

      // Get recent collaborators
      let recentCollaborators: any[] = [];
      if (userSessionIds.length > 0) {
        const { data: collaboratorsData } = await supabase
          .from('session_participants')
          .select('user_id')
          .in('session_id', userSessionIds)
          .neq('user_id', user.id)
          .limit(10);

        if (collaboratorsData && collaboratorsData.length > 0) {
          const collaboratorUserIds = [...new Set(collaboratorsData.map(c => c.user_id))];
          const { data: collaboratorProfiles } = await supabase
            .from('profiles')
            .select('id, username, first_name, last_name, avatar_url')
            .in('id', collaboratorUserIds);

          recentCollaborators = (collaboratorProfiles || []).map(c => ({
            id: c.id,
            name: c.first_name && c.last_name 
              ? `${c.first_name} ${c.last_name}` 
              : c.username || 'Unknown',
            username: c.username || 'unknown',
            avatar: c.avatar_url || ''
          }));
        }
      }

      return { friends, recentCollaborators };
    } catch (error) {
      console.error('Error loading friends and collaborators:', error);
      return { friends: [], recentCollaborators: [] };
    }
  }, [user]);

  // Get session context for swipe actions
  const getSwipeContext = useCallback(() => {
    if (sessionState.isInSolo) {
      return {
        type: 'solo' as const,
        sessionId: null,
        boardId: null
      };
    } else {
      return {
        type: 'collaborative' as const,
        sessionId: sessionState.currentSession?.id || null,
        boardId: sessionState.currentSession?.boardId || null
      };
    }
  }, [sessionState]);

  // Check if user can switch to solo
  const canSwitchToSolo = useCallback(() => {
    return sessionState.isInSolo || !sessionState.currentSession;
  }, [sessionState]);

  return {
    sessionState,
    switchToSolo,
    switchToCollaborative,
    createCollaborativeSession,
    acceptSessionInvitation,
    declineSessionInvitation,
    cancelSessionInvitation,
    cancelEntireSession,
    getFriendsAndCollaborators,
    getSwipeContext,
    canSwitchToSolo,
    loadUserSessions,
    isInSolo: sessionState.isInSolo,
    currentSession: sessionState.currentSession,
    availableSessions: sessionState.availableSessions,
    pendingInvites: sessionState.pendingInvites,
    loading: sessionState.loading
  };
};