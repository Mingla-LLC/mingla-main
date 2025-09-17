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
  inviterProfile?: {
    id: string;
    name: string;
    username: string;
    avatar?: string;
  };
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
      // Load pending invites received by user
      const { data: receivedInvitesData, error: receivedInvitesError } = await supabase
        .from('collaboration_invites')
        .select(`
          id, session_id, message, status, created_at, invited_by,
          inviter_profile:profiles!collaboration_invites_invited_by_fkey (id, username, first_name, last_name, avatar_url)
        `)
        .eq('invited_user_id', user.id)
        .eq('status', 'pending');

      if (receivedInvitesError) {
        console.error('Received invites error:', receivedInvitesError);
      }

      // Load pending invites sent by user  
      const { data: sentInvitesData, error: sentInvitesError } = await supabase
        .from('collaboration_invites')
        .select(`
          id, session_id, message, status, created_at, invited_user_id
        `)
        .eq('invited_by', user.id)
        .eq('status', 'pending');

      if (sentInvitesError) {
        console.error('Sent invites error:', sentInvitesError);
      }

      // Load sessions where user is participant (accepted)
      const { data: participantSessionIds, error: participantError } = await supabase
        .from('session_participants')
        .select('session_id, has_accepted')
        .eq('user_id', user.id)
        .eq('has_accepted', true);

      if (participantError) {
        console.error('Participant error:', participantError);
      }

      // Get all session IDs we need to load
      const allSessionIds = [
        ...new Set([
          ...(receivedInvitesData || []).map(i => i.session_id),
          ...(sentInvitesData || []).map(i => i.session_id),
          ...(participantSessionIds || []).map(p => p.session_id)
        ])
      ];

      let allSessionsData: any[] = [];
      if (allSessionIds.length > 0) {
        const { data: sessions, error: sessionsError } = await supabase
          .from('collaboration_sessions')
          .select(`
            id, name, created_by, board_id, status, created_at, updated_at
          `)
          .in('id', allSessionIds);

        if (sessionsError) {
          console.error('Sessions error:', sessionsError);
        } else {
          allSessionsData = sessions || [];
        }
      }

      // Load participants for all sessions
      let allParticipants: any[] = [];
      if (allSessionIds.length > 0) {
        const { data: participantsData } = await supabase
          .from('session_participants')
          .select(`
            session_id, user_id, has_accepted, joined_at,
            profiles!session_participants_user_id_fkey (id, username, first_name, last_name, avatar_url)
          `)
          .in('session_id', allSessionIds);
        
        allParticipants = participantsData || [];
      }

      console.log('=== SESSION LOADING DEBUG ===');
      console.log('User ID:', user.id);
      console.log('Received invites data:', receivedInvitesData);
      console.log('Sent invites data:', sentInvitesData);
      console.log('All session IDs:', allSessionIds);
      console.log('All sessions data:', allSessionsData);

      // Format received invites as sessions
      const receivedInviteSessions: CollaborationSession[] = (receivedInvitesData || []).map(invite => {
        const session = allSessionsData.find(s => s.id === invite.session_id);
        if (!session) {
          console.warn('Session not found for invite:', invite.session_id);
          return null;
        }

        console.log('Processing received invite:', invite);
        console.log('Found session:', session);

        const sessionParticipants = allParticipants.filter(p => p.session_id === session.id);
        const participants = sessionParticipants.map(p => ({
          id: p.profiles?.id || p.user_id,
          name: p.profiles?.first_name && p.profiles?.last_name 
            ? `${p.profiles.first_name} ${p.profiles.last_name}` 
            : p.profiles?.username || 'Unknown User',
          username: p.profiles?.username || 'unknown',
          avatar: p.profiles?.avatar_url || '',
          hasAccepted: p.has_accepted
        }));

        const sessionData = {
          id: session.id,
          name: session.name,
          participants,
          createdAt: session.created_at,
          isActive: false,
          boardId: session.board_id,
          status: 'pending' as const,
          invitedBy: session.created_by,
          inviterProfile: invite.inviter_profile ? {
            id: invite.inviter_profile.id,
            name: invite.inviter_profile.first_name && invite.inviter_profile.last_name
              ? `${invite.inviter_profile.first_name} ${invite.inviter_profile.last_name}`
              : invite.inviter_profile.username || 'Unknown User',
            username: invite.inviter_profile.username || 'unknown',
            avatar: invite.inviter_profile.avatar_url
          } : undefined
        };

        console.log('Created received session:', sessionData);
        return sessionData;
      }).filter(Boolean) as CollaborationSession[];

      console.log('Received invite sessions:', receivedInviteSessions);

      // Format sent invites as sessions  
      const sentInviteSessions: CollaborationSession[] = (sentInvitesData || []).map(invite => {
        const session = allSessionsData.find(s => s.id === invite.session_id);
        if (!session) return null;

        const sessionParticipants = allParticipants.filter(p => p.session_id === session.id);
        const participants = sessionParticipants.map(p => ({
          id: p.profiles?.id || p.user_id,
          name: p.profiles?.first_name && p.profiles?.last_name 
            ? `${p.profiles.first_name} ${p.profiles.last_name}` 
            : p.profiles?.username || 'Unknown User',
          username: p.profiles?.username || 'unknown',
          avatar: p.profiles?.avatar_url || '',
          hasAccepted: p.has_accepted
        }));

        return {
          id: session.id,
          name: session.name,
          participants,
          createdAt: session.created_at,
          isActive: false,
          boardId: session.board_id,
          status: 'pending' as const,
          invitedBy: session.created_by,
          inviterProfile: undefined
        };
      }).filter(Boolean) as CollaborationSession[];

      // Format accepted sessions (exclude sessions that are already in received/sent invites)
      const acceptedSessionIds = (participantSessionIds || []).map(p => p.session_id);
      const receivedInviteSessionIds = receivedInviteSessions.map(s => s.id);
      const sentInviteSessionIds = sentInviteSessions.map(s => s.id);
      const pendingSessionIds = [...receivedInviteSessionIds, ...sentInviteSessionIds];
      
      const activeSessions: CollaborationSession[] = allSessionsData
        .filter(session => 
          acceptedSessionIds.includes(session.id) && 
          !pendingSessionIds.includes(session.id)
        )
        .map(session => {
          const sessionParticipants = allParticipants.filter(p => p.session_id === session.id);
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
            isActive: allAccepted,
            boardId: session.board_id,
            status: allAccepted ? 'active' as const : 'dormant' as const,
            invitedBy: session.created_by,
            inviterProfile: undefined
          };
        });

      // Format invites for notification bar
      const formattedInvites: SessionInvite[] = (receivedInvitesData || []).map(invite => {
        const session = allSessionsData.find(s => s.id === invite.session_id);
        const inviterProfile = invite.inviter_profile;
        
        return {
          id: invite.id,
          sessionId: invite.session_id,
          sessionName: session?.name || 'Collaboration Session',
          invitedBy: {
            id: inviterProfile?.id || invite.invited_by || '',
            name: inviterProfile?.first_name && inviterProfile?.last_name
              ? `${inviterProfile.first_name} ${inviterProfile.last_name}`
              : inviterProfile?.username || 'Unknown User',
            username: inviterProfile?.username || 'unknown',
            avatar: inviterProfile?.avatar_url
          },
          message: invite.message,
          status: invite.status as 'pending',
          createdAt: invite.created_at
        };
      });

      // Combine all sessions with proper priority (pending > active > dormant)
      const allSessions = [...receivedInviteSessions, ...sentInviteSessions, ...activeSessions];
      
      // Custom deduplication that preserves pending status priority
      const sessionMap = new Map<string, CollaborationSession>();
      
      for (const session of allSessions) {
        const existingSession = sessionMap.get(session.id);
        
        if (!existingSession) {
          sessionMap.set(session.id, session);
        } else {
          // Priority: pending > active > dormant
          const currentPriority = session.status === 'pending' ? 3 : session.status === 'active' ? 2 : 1;
          const existingPriority = existingSession.status === 'pending' ? 3 : existingSession.status === 'active' ? 2 : 1;
          
          if (currentPriority > existingPriority) {
            sessionMap.set(session.id, session);
          }
        }
      }
      
      const uniqueSessions = Array.from(sessionMap.values());

      console.log('Final unique sessions:', uniqueSessions);
      console.log('=== END SESSION LOADING DEBUG ===');

      setSessionState(prev => ({
        ...prev,
        availableSessions: uniqueSessions,
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

  // Switch to collaborative session (accept invitation)
  const switchToCollaborative = useCallback(async (sessionId: string) => {
    const session = sessionState.availableSessions.find(s => s.id === sessionId);
    if (!session || !user) return;

    try {
      // If this is a pending invite, accept it
      if (session.status === 'pending' && session.invitedBy !== user.id) {
        // Update participant status to accepted
        const { error: participantError } = await supabase
          .from('session_participants')
          .update({ 
            has_accepted: true, 
            joined_at: new Date().toISOString() 
          })
          .eq('session_id', sessionId)
          .eq('user_id', user.id);

        if (participantError) {
          console.error('Participant update error:', participantError);
          toast({
            title: "Error",
            description: "Failed to accept invitation",
            variant: "destructive"
          });
          return;
        }

        // Update invite status
        const { error: inviteError } = await supabase
          .from('collaboration_invites')
          .update({ status: 'accepted' })
          .eq('session_id', sessionId)
          .eq('invited_user_id', user.id);

        if (inviteError) {
          console.error('Invite update error:', inviteError);
        }

        // Check if all participants have accepted
        const { data: allParticipants } = await supabase
          .from('session_participants')
          .select('has_accepted')
          .eq('session_id', sessionId);

        const allAccepted = allParticipants?.every(p => p.has_accepted) || false;

        if (allAccepted) {
          // Update session status to active
          await supabase
            .from('collaboration_sessions')
            .update({ status: 'active' })
            .eq('id', sessionId);
        }

        await loadUserSessions();
        
        toast({
          title: "Invitation accepted!",
          description: allAccepted 
            ? `All participants have joined! You can now collaborate on "${session.name}".`
            : "You've joined the collaboration session. Waiting for other participants.",
        });
      }

      // Set as current session
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
    } catch (error) {
      console.error('Error switching to collaborative session:', error);
      toast({
        title: "Error",
        description: "Failed to join collaboration session",
        variant: "destructive"
      });
    }
  }, [sessionState.availableSessions, user, loadUserSessions]);

  // Create new collaborative session
  const createCollaborativeSession = useCallback(async (participants: string[], sessionName: string) => {
    if (!user) return null;

    console.log('Creating collaboration session:', { participants, sessionName, userId: user.id });

    try {
      // Create a board first
      const { data: boardData, error: boardError } = await supabase
        .from('boards')
        .insert({
          name: sessionName || `Collaboration Session ${new Date().toLocaleDateString()}`,
          description: `Collaborative board for ${sessionName}`,
          created_by: user.id,
          is_public: false
        })
        .select()
        .single();

      if (boardError) {
        console.error('Board creation error:', boardError);
        throw boardError;
      }

      console.log('Board created:', boardData);

      // Create the session
      const { data: sessionData, error: sessionError } = await supabase
        .from('collaboration_sessions')
        .insert({
          name: sessionName || `Collaboration Session ${new Date().toLocaleDateString()}`,
          created_by: user.id,
          status: 'pending',
          board_id: boardData.id
        })
        .select()
        .single();

      if (sessionError) {
        console.error('Session creation error:', sessionError);
        throw sessionError;
      }

      console.log('Session created:', sessionData);

      // Update board with session_id
      const { error: updateError } = await supabase
        .from('boards')
        .update({ session_id: sessionData.id })
        .eq('id', boardData.id);

      if (updateError) {
        console.error('Board update error:', updateError);
      }

      // Add creator as participant (auto-accepted)
      const { error: participantError } = await supabase
        .from('session_participants')
        .insert({
          session_id: sessionData.id,
          user_id: user.id,
          has_accepted: true,
          joined_at: new Date().toISOString()
        });

      if (participantError) {
        console.error('Participant creation error:', participantError);
        throw participantError;
      }

      // Send invites to participants
      const invitePromises = participants.map(async (username) => {
        console.log('Processing participant:', username);
        
        // Find user by username
        const { data: invitedUser, error: userError } = await supabase
          .from('profiles')
          .select('id')
          .eq('username', username)
          .single();

        if (userError) {
          console.error('Error finding user:', userError);
          return;
        }

        if (invitedUser) {
          console.log('Found invited user:', invitedUser);
          
          // Create participant record
          const { error: partError } = await supabase
            .from('session_participants')
            .insert({
              session_id: sessionData.id,
              user_id: invitedUser.id,
              has_accepted: false
            });

          if (partError) {
            console.error('Error creating participant:', partError);
          }

          // Send invite
          const { error: inviteError } = await supabase
            .from('collaboration_invites')
            .insert({
              session_id: sessionData.id,
              invited_by: user.id,
              invited_user_id: invitedUser.id,
              status: 'pending'
            });

          if (inviteError) {
            console.error('Error sending invite:', inviteError);
          }
        }
      });

      await Promise.all(invitePromises);
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
        description: "Failed to create collaboration session. Please try again.",
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
  const cancelSessionInvitation = useCallback(async (sessionId: string, userId?: string) => {
    if (!user) return;
    
    try {
      if (userId) {
        // Cancel specific user's invitation
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
      } else {
        // Cancel all invitations for the session
        await cancelEntireSession(sessionId);
        return;
      }

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
  }, [user, loadUserSessions]);

  // Cancel entire session (for session creator)
  const cancelEntireSession = useCallback(async (sessionId: string) => {
    if (!user) return;
    
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

      // If current session is the one being cancelled, switch to solo
      if (sessionState.currentSession?.id === sessionId) {
        setSessionState(prev => ({
          ...prev,
          currentSession: null,
          isInSolo: true
        }));
      }

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
  }, [user, sessionState.currentSession, loadUserSessions]);

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