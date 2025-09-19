import { useState, useEffect, useCallback } from 'react';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { 
  getUserSessions,
  createSession as apiCreateSession,
  deleteSession as apiDeleteSession,
  CreateSessionPayload
} from '@/api/sessions';
import { 
  acceptInvite as apiAcceptInvite, 
  declineInvite as apiDeclineInvite, 
  revokeInvite as apiRevokeInvite,
  getPendingInvites
} from '@/api/invites';

export interface CollaborationSession {
  id: string;
  name: string;
  status: 'pending' | 'active' | 'ended';
  boardId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  members: Array<{
    userId: string;
    role: 'owner' | 'participant';
    joinedAt: string;
    profile: {
      id: string;
      username: string;
      firstName?: string;
      lastName?: string;
      avatarUrl?: string;
    };
  }>;
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
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
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
  const [sessionState, setSessionState] = useState<SessionState>(() => {
    // Try to restore session state from localStorage
    const saved = localStorage.getItem('collaboration_session_state');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          currentSession: parsed.currentSession || null,
          availableSessions: [],
          pendingInvites: [],
          isInSolo: !parsed.currentSession,
          loading: false
        };
      } catch {
        // If parsing fails, use default state
      }
    }
    return {
      currentSession: null,
      availableSessions: [],
      pendingInvites: [],
      isInSolo: true,
      loading: false
    };
  });
  
  const { user } = useAppStore();

  // Load user's sessions and invites using new API
  const loadUserSessions = useCallback(async () => {
    if (!user) return;
    
    console.log('🔄 Loading user sessions for user:', user.id);
    setSessionState(prev => ({ ...prev, loading: true }));
    
    try {
      // Load user's sessions (where they are members)
      const sessionsResponse = await getUserSessions();
      const sessions: CollaborationSession[] = sessionsResponse.sessions.map(session => ({
        id: session.id,
        name: session.name,
        status: session.status,
        boardId: session.board_id,
        createdBy: session.created_by,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        members: session.members.map(member => ({
          userId: member.user_id,
          role: member.role,
          joinedAt: member.joined_at,
          profile: {
            id: member.profile.id,
            username: member.profile.username,
            firstName: member.profile.first_name,
            lastName: member.profile.last_name,
            avatarUrl: member.profile.avatar_url
          }
        }))
      }));

      // Load pending invites
      const invites = await getPendingInvites();
      const pendingInvites: SessionInvite[] = invites.map(invite => ({
        id: invite.id,
        sessionId: invite.sessionId,
        sessionName: invite.sessionName,
        invitedBy: invite.invitedBy,
        message: invite.message,
        status: invite.status as 'pending',
        createdAt: invite.createdAt
      }));

      // Find current active session
      const activeSession = sessions.find(s => s.status === 'active') || null;

      setSessionState(prev => ({
        ...prev,
        availableSessions: sessions,
        pendingInvites,
        currentSession: activeSession,
        isInSolo: !activeSession,
        loading: false
      }));

      // Update localStorage
      localStorage.setItem('collaboration_session_state', JSON.stringify({
        currentSession: activeSession
      }));

    } catch (error) {
      console.error('❌ Error loading sessions:', error);
      setSessionState(prev => ({ ...prev, loading: false }));
      toast({
        title: "Error Loading Sessions",
        description: error instanceof Error ? error.message : 'Failed to load sessions',
        variant: "destructive",
      });
    }
  }, [user]);

  // Load data on mount and set up subscriptions
  useEffect(() => {
    if (!user) return;

    loadUserSessions();

    // Set up real-time subscriptions
    const invitesChannel = supabase
      .channel('collaboration_invites_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collaboration_invites',
          filter: `invited_user_id=eq.${user.id}`
        },
        () => {
          console.log('🔔 Invites changed, reloading...');
          loadUserSessions();
        }
      )
      .subscribe();

    const membersChannel = supabase
      .channel('session_members_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_members',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          console.log('🔔 Session membership changed, reloading...');
          loadUserSessions();
        }
      )
      .subscribe();

    const sessionsChannel = supabase
      .channel('collaboration_sessions_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collaboration_sessions'
        },
        () => {
          console.log('🔔 Sessions changed, reloading...');
          loadUserSessions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(invitesChannel);
      supabase.removeChannel(membersChannel);
      supabase.removeChannel(sessionsChannel);
    };
  }, [user, loadUserSessions]);

  // Switch to solo mode
  const switchToSolo = useCallback(() => {
    setSessionState(prev => ({
      ...prev,
      currentSession: null,
      isInSolo: true
    }));
    
    localStorage.setItem('collaboration_session_state', JSON.stringify({
      currentSession: null
    }));
    
    toast({
      title: "Switched to Solo Mode",
      description: "You're now exploring on your own",
    });
  }, []);

  // Switch to collaborative session
  const switchToCollaborative = useCallback(async (sessionId: string) => {
    const session = sessionState.availableSessions.find(s => s.id === sessionId);
    if (!session) {
      toast({
        title: "Session Not Found",
        description: "The requested session could not be found",
        variant: "destructive",
      });
      return;
    }

    setSessionState(prev => ({
      ...prev,
      currentSession: session,
      isInSolo: false
    }));

    localStorage.setItem('collaboration_session_state', JSON.stringify({
      currentSession: session
    }));

    toast({
      title: "Joined Collaboration",
      description: `Switched to "${session.name}"`,
    });
  }, [sessionState.availableSessions]);

  // Create a new collaborative session
  const createCollaborativeSession = useCallback(async (participants: string[], sessionName: string) => {
    if (!user) {
      throw new Error('User not authenticated');
    }

    try {
      const payload: CreateSessionPayload = {
        name: sessionName,
        participants
      };

      const response = await apiCreateSession(payload);
      
      // Reload sessions to get the updated list
      await loadUserSessions();
      
      toast({
        title: "Session Created",
        description: `"${sessionName}" has been created and invites sent`,
      });

      return response.id;
    } catch (error) {
      console.error('❌ Error creating session:', error);
      toast({
        title: "Failed to Create Session",
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: "destructive",
      });
      throw error;
    }
  }, [user, loadUserSessions]);

  // Delete/cancel a session
  const cancelSession = useCallback(async (sessionId: string) => {
    try {
      await apiDeleteSession(sessionId);
      
      // If we deleted the current session, switch to solo
      if (sessionState.currentSession?.id === sessionId) {
        switchToSolo();
      }
      
      // Reload sessions
      await loadUserSessions();
      
      toast({
        title: "Session Deleted",
        description: "The collaboration session has been deleted",
      });
    } catch (error) {
      console.error('❌ Error deleting session:', error);
      toast({
        title: "Failed to Delete Session",
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: "destructive",
      });
      throw error;
    }
  }, [sessionState.currentSession, switchToSolo, loadUserSessions]);

  // Accept an invite
  const acceptInvite = useCallback(async (inviteId: string) => {
    try {
      const response = await apiAcceptInvite(inviteId);
      
      // Reload sessions to get updated data
      await loadUserSessions();
      
      toast({
        title: "Invite Accepted",
        description: "You've joined the collaboration session",
      });

      return response;
    } catch (error) {
      console.error('❌ Error accepting invite:', error);
      toast({
        title: "Failed to Accept Invite",
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: "destructive",
      });
      throw error;
    }
  }, [loadUserSessions]);

  // Decline an invite
  const declineInvite = useCallback(async (inviteId: string) => {
    try {
      await apiDeclineInvite(inviteId);
      
      // Reload sessions
      await loadUserSessions();
      
      toast({
        title: "Invite Declined",
        description: "The invitation has been declined",
      });
    } catch (error) {
      console.error('❌ Error declining invite:', error);
      toast({
        title: "Failed to Decline Invite",
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: "destructive",
      });
      throw error;
    }
  }, [loadUserSessions]);

  // Revoke an invite
  const revokeInvite = useCallback(async (inviteId: string) => {
    try {
      await apiRevokeInvite(inviteId);
      
      // Reload sessions
      await loadUserSessions();
      
      toast({
        title: "Invite Revoked",
        description: "The invitation has been revoked",
      });
    } catch (error) {
      console.error('❌ Error revoking invite:', error);
      toast({
        title: "Failed to Revoke Invite",
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: "destructive",
      });
      throw error;
    }
  }, [loadUserSessions]);

  return {
    sessionState,
    switchToSolo,
    switchToCollaborative,
    createCollaborativeSession,
    cancelSession,
    acceptInvite,
    declineInvite,
    revokeInvite
  };
};