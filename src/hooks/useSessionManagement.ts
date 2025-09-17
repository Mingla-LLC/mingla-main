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
    
    setSessionState(prev => ({ ...prev, loading: true }));
    
    try {
      // 1. Load all sessions where user is a participant or creator
      const { data: userParticipations, error: participationError } = await supabase
        .from('session_participants')
        .select('session_id, has_accepted, joined_at')
        .eq('user_id', user.id);

      if (participationError) {
        console.error('Error loading participations:', participationError);
        setSessionState(prev => ({ ...prev, loading: false }));
        return;
      }

      const sessionIds = userParticipations?.map(p => p.session_id) || [];

      // 2. Load all collaboration sessions for these session IDs
      let allSessions: any[] = [];
      if (sessionIds.length > 0) {
        const { data: sessions, error: sessionsError } = await supabase
          .from('collaboration_sessions')
          .select('*')
          .in('id', sessionIds);

        if (sessionsError) {
          console.error('Error loading sessions:', sessionsError);
        } else {
          allSessions = sessions || [];
        }
      }

      // 3. Load all participants for these sessions
      let allParticipants: any[] = [];
      if (sessionIds.length > 0) {
        const { data: participants, error: participantsError } = await supabase
          .from('session_participants')
          .select('*')
          .in('session_id', sessionIds);

        if (participantsError) {
          console.error('Error loading participants:', participantsError);
        } else {
          allParticipants = participants || [];
        }
      }

      // 4. Load profiles for all participants
      const participantUserIds = [...new Set(allParticipants.map(p => p.user_id))];
      let profiles: any[] = [];
      if (participantUserIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, username, first_name, last_name, avatar_url')
          .in('id', participantUserIds);

        if (profilesError) {
          console.error('Error loading profiles:', profilesError);
        } else {
          profiles = profilesData || [];
        }
      }

      // 5. Load received invites
      const { data: receivedInvites, error: receivedError } = await supabase
        .from('collaboration_invites')
        .select('*')
        .eq('invited_user_id', user.id)
        .eq('status', 'pending');

      if (receivedError) {
        console.error('Error loading received invites:', receivedError);
      }

      // 6. Load inviter profiles for received invites
      const inviterIds = [...new Set((receivedInvites || []).map(i => i.invited_by))];
      let inviterProfiles: any[] = [];
      if (inviterIds.length > 0) {
        const { data: invitersData, error: invitersError } = await supabase
          .from('profiles')
          .select('id, username, first_name, last_name, avatar_url')
          .in('id', inviterIds);

        if (invitersError) {
          console.error('Error loading inviter profiles:', invitersError);
        } else {
          inviterProfiles = invitersData || [];
        }
      }

      // Helper function to get profile by user ID
      const getProfile = (userId: string) => {
        return profiles.find(p => p.id === userId);
      };

      // Helper function to format profile name
      const formatProfileName = (profile: any) => {
        if (!profile) return 'Unknown User';
        if (profile.first_name && profile.last_name) {
          return `${profile.first_name} ${profile.last_name}`;
        }
        return profile.username || 'Unknown User';
      };

      // Format sessions with correct status logic
      const formattedSessions: CollaborationSession[] = allSessions.map(session => {
        const sessionParticipants = allParticipants.filter(p => p.session_id === session.id);
        const participants = sessionParticipants.map(p => {
          const profile = getProfile(p.user_id);
          return {
            id: p.user_id,
            name: formatProfileName(profile),
            username: profile?.username || 'unknown',
            avatar: profile?.avatar_url || '',
            hasAccepted: p.has_accepted
          };
        });

        const userParticipation = userParticipations?.find(up => up.session_id === session.id);
        const allAccepted = participants.length > 0 && participants.every(p => p.hasAccepted);
        
        // Determine status based on user's acceptance and overall session state
        let status: 'pending' | 'active' | 'dormant' = 'dormant';
        
        if (userParticipation && !userParticipation.has_accepted) {
          // User hasn't accepted yet - this is a pending invitation for them
          status = 'pending';
        } else if (allAccepted && participants.length > 0) {
          // All participants have accepted - session is active
          status = 'active';
        } else if (userParticipation?.has_accepted) {
          // User accepted but not everyone has - session is dormant
          status = 'dormant';
        }

        // Get inviter profile (creator of the session)
        const inviterProfile = getProfile(session.created_by);
        const formattedInviterProfile = inviterProfile ? {
          id: inviterProfile.id,
          name: formatProfileName(inviterProfile),
          username: inviterProfile.username || 'unknown',
          avatar: inviterProfile.avatar_url
        } : undefined;

        return {
          id: session.id,
          name: session.name,
          participants,
          createdAt: session.created_at,
          isActive: allAccepted,
          boardId: session.board_id,
          status,
          invitedBy: session.created_by,
          inviterProfile: formattedInviterProfile
        };
      });

      // Format invites for notification bar (only received invites)
      const formattedInvites: SessionInvite[] = (receivedInvites || []).map(invite => {
        const session = allSessions.find(s => s.id === invite.session_id);
        const inviter = inviterProfiles.find(p => p.id === invite.invited_by);
        
        return {
          id: invite.id,
          sessionId: invite.session_id,
          sessionName: session?.name || 'Collaboration Session',
          invitedBy: {
            id: inviter?.id || invite.invited_by,
            name: formatProfileName(inviter),
            username: inviter?.username || 'unknown',
            avatar: inviter?.avatar_url
          },
          message: invite.message,
          status: 'pending',
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

  // Switch to collaborative session (accept invitation)
  const switchToCollaborative = useCallback(async (sessionId: string) => {
    const session = sessionState.availableSessions.find(s => s.id === sessionId);
    if (!session || !user) return;

    try {
      // If this is a pending invite that user received, accept it
      if (session.status === 'pending' && session.invitedBy !== user.id) {
        // Accept the invitation
        const { error: participantError } = await supabase
          .from('session_participants')
          .update({ 
            has_accepted: true, 
            joined_at: new Date().toISOString() 
          })
          .eq('session_id', sessionId)
          .eq('user_id', user.id);

        if (participantError) {
          console.error('Error accepting invitation:', participantError);
          toast({
            title: "Error",
            description: "Failed to accept invitation",
            variant: "destructive"
          });
          return;
        }

        // Update invite status
        await supabase
          .from('collaboration_invites')
          .update({ status: 'accepted' })
          .eq('session_id', sessionId)
          .eq('invited_user_id', user.id);

        // Check if all participants have now accepted
        const { data: allParticipants } = await supabase
          .from('session_participants')
          .select('has_accepted')
          .eq('session_id', sessionId);

        const allAccepted = allParticipants?.every(p => p.has_accepted) || false;

        if (allAccepted) {
          // All participants accepted - create board and activate session
          const { data: boardData, error: boardError } = await supabase
            .from('boards')
            .insert({
              name: session.name,
              description: `Collaborative board for ${session.name}`,
              created_by: session.invitedBy,
              is_public: false,
              session_id: sessionId
            })
            .select()
            .single();

          if (boardError) {
            console.error('Error creating board:', boardError);
          } else {
            // Update session with board_id and active status
            await supabase
              .from('collaboration_sessions')
              .update({ 
                status: 'active',
                board_id: boardData.id 
              })
              .eq('id', sessionId);

            // Add all participants to the board as collaborators
            const collaborators = session.participants.map(p => ({
              board_id: boardData.id,
              user_id: p.id,
              role: p.id === session.invitedBy ? 'owner' : 'collaborator'
            }));

            await supabase
              .from('board_collaborators')
              .insert(collaborators);
          }

          toast({
            title: "Collaboration started!",
            description: `All participants have joined! Board "${session.name}" has been created.`,
          });
        } else {
          toast({
            title: "Invitation accepted!",
            description: "Waiting for other participants to join...",
          });
        }

        // Reload sessions
        await loadUserSessions();
        return;
      }

      // For active sessions, just switch to them
      if (session.status === 'active') {
        setSessionState(prev => ({
          ...prev,
          currentSession: session,
          isInSolo: false
        }));

        toast({
          title: "Switched to collaboration",
          description: `Now collaborating on "${session.name}"`,
        });
      }

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

    try {
      // Create the session (no board yet - only created when all accept)
      const { data: sessionData, error: sessionError } = await supabase
        .from('collaboration_sessions')
        .insert({
          name: sessionName || `Collaboration Session ${new Date().toLocaleDateString()}`,
          created_by: user.id,
          status: 'pending',
          board_id: null
        })
        .select()
        .single();

      if (sessionError) {
        console.error('Error creating session:', sessionError);
        throw sessionError;
      }

      // Add creator as participant (auto-accepted)
      const { error: creatorParticipantError } = await supabase
        .from('session_participants')
        .insert({
          session_id: sessionData.id,
          user_id: user.id,
          has_accepted: true,
          joined_at: new Date().toISOString()
        });

      if (creatorParticipantError) {
        console.error('Error adding creator as participant:', creatorParticipantError);
        throw creatorParticipantError;
      }

      // Process participants
      const participantPromises = participants.map(async (username) => {
        // Find user by username
        const { data: userData, error: userError } = await supabase
          .from('profiles')
          .select('id')
          .eq('username', username)
          .single();

        if (userError || !userData) {
          console.error(`User not found: ${username}`, userError);
          return { success: false, username };
        }

        // Add as participant (not accepted yet)
        const { error: participantError } = await supabase
          .from('session_participants')
          .insert({
            session_id: sessionData.id,
            user_id: userData.id,
            has_accepted: false
          });

        if (participantError) {
          console.error('Error adding participant:', participantError);
          return { success: false, username };
        }

        // Send invitation
        const { error: inviteError } = await supabase
          .from('collaboration_invites')
          .insert({
            session_id: sessionData.id,
            invited_by: user.id,
            invited_user_id: userData.id,
            status: 'pending'
          });

        if (inviteError) {
          console.error('Error sending invitation:', inviteError);
          return { success: false, username };
        }

        return { success: true, username, userId: userData.id };
      });

      const results = await Promise.all(participantPromises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      if (failed.length > 0) {
        console.error('Failed to invite some users:', failed);
      }

      toast({
        title: "Invitations sent!",
        description: `Invited ${successful.length} friend${successful.length !== 1 ? 's' : ''} to collaborate on "${sessionName}".`,
      });

      // Reload sessions
      await loadUserSessions();

      return sessionData.id;

    } catch (error) {
      console.error('Error creating collaborative session:', error);
      toast({
        title: "Error",
        description: "Failed to create collaboration session",
        variant: "destructive"
      });
      return null;
    }
  }, [user, loadUserSessions]);

  // Cancel/decline/revoke invite OR leave active session
  const cancelSession = useCallback(async (sessionId: string) => {
    if (!user) return;

    const session = sessionState.availableSessions.find(s => s.id === sessionId);
    if (!session) return;

    try {
      // If user is currently in this active session, leave it
      if (sessionState.currentSession?.id === sessionId) {
        // Remove user from session participants
        await supabase
          .from('session_participants')
          .delete()
          .eq('session_id', sessionId)
          .eq('user_id', user.id);

        // Update any invites to declined status
        await supabase
          .from('collaboration_invites')
          .update({ status: 'declined' })
          .eq('session_id', sessionId)
          .eq('invited_user_id', user.id);

        // Switch to solo mode
        setSessionState(prev => ({
          ...prev,
          currentSession: null,
          isInSolo: true
        }));

        toast({
          title: "Left collaboration session",
          description: `You've left "${session.name}".`,
        });

        // Reload sessions
        await loadUserSessions();
        return;
      }

      // Handle pending invitations
      if (session.invitedBy === user.id) {
        // User is the creator - revoke the session
        await supabase
          .from('collaboration_invites')
          .update({ status: 'cancelled' })
          .eq('session_id', sessionId)
          .eq('invited_by', user.id);

        await supabase
          .from('collaboration_sessions')
          .delete()
          .eq('id', sessionId)
          .eq('created_by', user.id);

        toast({
          title: "Session cancelled",
          description: `"${session.name}" has been cancelled.`,
        });
      } else {
        // User was invited - decline the invitation
        await supabase
          .from('collaboration_invites')
          .update({ status: 'declined' })
          .eq('session_id', sessionId)
          .eq('invited_user_id', user.id);

        await supabase
          .from('session_participants')
          .delete()
          .eq('session_id', sessionId)
          .eq('user_id', user.id);

        toast({
          title: "Invitation declined",
          description: `You've declined the invitation to "${session.name}".`,
        });
      }

      // Reload sessions
      await loadUserSessions();

    } catch (error) {
      console.error('Error handling session cancellation:', error);
      toast({
        title: "Error",
        description: "Failed to process request",
        variant: "destructive"
      });
    }
  }, [sessionState.availableSessions, sessionState.currentSession, user, loadUserSessions]);

  // Accept specific invite (from notification)
  const acceptInvite = useCallback(async (inviteId: string) => {
    if (!user) return;

    const invite = sessionState.pendingInvites.find(i => i.id === inviteId);
    if (!invite) return;

    return switchToCollaborative(invite.sessionId);
  }, [user, sessionState.pendingInvites, switchToCollaborative]);

  // Decline specific invite (from notification)
  const declineInvite = useCallback(async (inviteId: string) => {
    if (!user) return;

    const invite = sessionState.pendingInvites.find(i => i.id === inviteId);
    if (!invite) return;

    return cancelSession(invite.sessionId);
  }, [user, sessionState.pendingInvites, cancelSession]);

  // Set up real-time subscriptions
  useEffect(() => {
    if (!user) return;

    const channels: any[] = [];

    // Listen to collaboration_invites changes
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
          loadUserSessions();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collaboration_invites',
          filter: `invited_by=eq.${user.id}`
        },
        () => {
          loadUserSessions();
        }
      )
      .subscribe();

    channels.push(invitesChannel);

    // Listen to session_participants changes
    const participantsChannel = supabase
      .channel('session_participants_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_participants',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          loadUserSessions();
        }
      )
      .subscribe();

    channels.push(participantsChannel);

    // Listen to collaboration_sessions changes
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
          loadUserSessions();
        }
      )
      .subscribe();

    channels.push(sessionsChannel);

    return () => {
      channels.forEach(channel => {
        supabase.removeChannel(channel);
      });
    };
  }, [user, loadUserSessions]);

  return {
    ...sessionState,
    switchToSolo,
    switchToCollaborative,
    createCollaborativeSession,
    cancelSession,
    acceptInvite,
    declineInvite,
    loading: sessionState.loading
  };
};