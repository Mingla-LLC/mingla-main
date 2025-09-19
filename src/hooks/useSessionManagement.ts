import { useState, useEffect, useCallback } from 'react';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { 
  acceptInvite as apiAcceptInvite, 
  declineInvite as apiDeclineInvite, 
  revokeInvite as apiRevokeInvite 
} from '@/api/invites';

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

  // Load user's sessions and invites
  const loadUserSessions = useCallback(async () => {
    if (!user) return;
    
    console.log('🔄 Loading user sessions for user:', user.id);
    setSessionState(prev => ({ ...prev, loading: true }));
    
    try {
      // 1. First load received invites to know all relevant sessions
      const { data: receivedInvites, error: receivedError } = await supabase
        .from('collaboration_invites')
        .select('*')
        .eq('invited_user_id', user.id)
        .eq('status', 'pending');

      console.log('📮 Received invites:', receivedInvites);
      if (receivedError) {
        console.error('❌ Error loading received invites:', receivedError);
      }

      // 2. Load all sessions where user is a participant or creator
      const { data: userParticipations, error: participationError } = await supabase
        .from('session_participants')
        .select('session_id, has_accepted, joined_at')
        .eq('user_id', user.id);

      if (participationError) {
        console.error('❌ Error loading participations:', participationError);
        setSessionState(prev => ({ ...prev, loading: false }));
        return;
      }

      console.log('👥 User participations:', userParticipations);
      const sessionIds = userParticipations?.map(p => p.session_id) || [];

      // 3. Load all collaboration sessions for these session IDs
      let allSessions: any[] = [];
      if (sessionIds.length > 0) {
        const { data: sessions, error: sessionsError } = await supabase
          .from('collaboration_sessions')
          .select('*')
          .in('id', sessionIds);

        console.log('📋 Loaded sessions:', sessions);
        if (sessionsError) {
          console.error('❌ Error loading sessions:', sessionsError);
        } else {
          allSessions = sessions || [];
        }
      }

      // 3.5. Also load sessions from received invites to ensure we have all relevant sessions
      if (receivedInvites && receivedInvites.length > 0) {
        const inviteSessionIds = [...new Set(receivedInvites.map(invite => invite.session_id))];
        const missingSessionIds = inviteSessionIds.filter(id => !sessionIds.includes(id));
        
        if (missingSessionIds.length > 0) {
          console.log('🔍 Loading additional sessions from invites:', missingSessionIds);
          const { data: inviteSessions, error: inviteSessionsError } = await supabase
            .from('collaboration_sessions')
            .select('*')
            .in('id', missingSessionIds);

          if (inviteSessionsError) {
            console.error('❌ Error loading invite sessions:', inviteSessionsError);
          } else {
            allSessions = [...allSessions, ...(inviteSessions || [])];
            console.log('📋 Added invite sessions:', inviteSessions);
          }
        }
      }

      // 4. Load all participants for these sessions (including invite sessions)
      let allParticipants: any[] = [];
      const allSessionIds = [...new Set([...sessionIds, ...(receivedInvites?.map(i => i.session_id) || [])])];
      
      if (allSessionIds.length > 0) {
        const { data: participants, error: participantsError } = await supabase
          .from('session_participants')
          .select('*')
          .in('session_id', allSessionIds);

        console.log('👥 All participants:', participants);
        if (participantsError) {
          console.error('❌ Error loading participants:', participantsError);
        } else {
          allParticipants = participants || [];
        }
      }

      // 5. Load profiles for all participants
      const participantUserIds = [...new Set(allParticipants.map(p => p.user_id))];
      let profiles: any[] = [];
      if (participantUserIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, username, first_name, last_name, avatar_url')
          .in('id', participantUserIds);

        if (profilesError) {
          console.error('❌ Error loading profiles:', profilesError);
        } else {
          profiles = profilesData || [];
          console.log('👤 Loaded profiles:', profiles);
        }
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
          console.error('❌ Error loading inviter profiles:', invitersError);
        } else {
          inviterProfiles = invitersData || [];
          console.log('👤 Inviter profiles:', inviterProfiles);
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

      // Format sessions with correct status logic - include sessions even with 1 participant for pending invites
      const formattedSessions: CollaborationSession[] = allSessions
        .filter(session => {
          // Include sessions where:
          // 1. User is a participant (already filtered by sessionIds)
          // 2. OR user has a pending invite to this session
          const userIsParticipant = sessionIds.includes(session.id);
          const userHasInvite = receivedInvites?.some(invite => invite.session_id === session.id);
          return userIsParticipant || userHasInvite;
        })
        .map(session => {
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
          const allAccepted = participants.length >= 2 && participants.every(p => p.hasAccepted);
          
          // Determine status based on acceptance and session state
          let status: 'pending' | 'active' | 'dormant' = 'dormant';
          
          // Check if this user has not accepted yet (received invite)
          if (!userParticipation?.has_accepted) {
            status = 'pending';
          } 
          // Check if all participants have accepted (active session)  
          else if (allAccepted && participants.length >= 2) {
            status = 'active';
          } 
          // User accepted but waiting for others (dormant)
          else if (userParticipation?.has_accepted && participants.length >= 2) {
            status = 'dormant';
          }

          console.log('📊 Session status calculation:', {
            sessionId: session.id,
            sessionName: session.name,
            userHasAccepted: userParticipation?.has_accepted,
            allAccepted,
            participantCount: participants.length,
            createdBy: session.created_by,
            userId: user?.id,
            finalStatus: status
          });

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
            isActive: allAccepted && participants.length >= 2,
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

      console.log('✅ Final formatted sessions:', formattedSessions);
      console.log('✅ Final formatted invites:', formattedInvites);

      setSessionState(prev => ({
        ...prev,
        availableSessions: formattedSessions,
        pendingInvites: formattedInvites,
        loading: false
      }));

    } catch (error) {
      console.error('❌ Error loading sessions:', error);
      setSessionState(prev => ({ ...prev, loading: false }));
    }
  }, [user]);

  // Load sessions on mount and when user changes
  useEffect(() => {
    loadUserSessions();

    // Set up realtime subscription for collaboration updates
    const channel = supabase
      .channel('collaboration-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_participants'
        },
        () => {
          // Reload sessions when participants change
          loadUserSessions();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public', 
          table: 'collaboration_sessions'
        },
        () => {
          // Reload sessions when sessions change
          loadUserSessions();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collaboration_invites'
        },
        () => {
          // Reload sessions when invites change
          loadUserSessions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadUserSessions]);

  // Switch to solo session
  const switchToSolo = useCallback(() => {
    if (sessionState.currentSession) {
      toast({
        title: "Left collaboration session",
        description: `You've left "${sessionState.currentSession.name}"`,
      });
    }
    
    const newState = {
      currentSession: null,
      availableSessions: sessionState.availableSessions,
      pendingInvites: sessionState.pendingInvites,
      isInSolo: true,
      loading: sessionState.loading
    };
    
    setSessionState(newState);
    
    // Save to localStorage
    localStorage.setItem('collaboration_session_state', JSON.stringify({
      currentSession: null,
      isInSolo: true
    }));
  }, [sessionState]);

  // Switch to collaborative session (accept invitation)
  const switchToCollaborative = useCallback(async (sessionId: string) => {
    console.log('🚀 switchToCollaborative called with sessionId:', sessionId);
    
    // First try to find in available sessions, then reload if not found
    let session = sessionState.availableSessions.find(s => s.id === sessionId);
    
    if (!session) {
      console.log('🔄 Session not found in current state, reloading sessions...');
      await loadUserSessions();
      // Try to find again after reload
      session = sessionState.availableSessions.find(s => s.id === sessionId);
    }
    
    if (!session || !user) {
      console.error('❌ Session not found or no user:', { 
        sessionId, 
        session: session ? 'found' : 'not found', 
        user: user?.id,
        availableSessions: sessionState.availableSessions.map(s => s.id)
      });
      
      // If still not found, try to fetch directly from database
      const { data: directSession } = await supabase
        .from('collaboration_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();
      
      if (directSession) {
        console.log('✅ Found session in database, creating temporary session object');
        session = {
          id: directSession.id,
          name: directSession.name,
          participants: [], // Will be populated after acceptance
          createdAt: directSession.created_at,
          isActive: false,
          boardId: directSession.board_id,
          status: 'pending' as const,
          invitedBy: directSession.created_by
        };
      } else {
        toast({
          title: "Error",
          description: "Session not found. It may have been cancelled.",
          variant: "destructive"
        });
        return;
      }
    }

    console.log('✅ Found session:', session);
    console.log('📊 Session status:', session.status);
    console.log('👥 Session participants:', session.participants);

    try {
      // If this is a pending invite that user received, accept it
      if (session.status === 'pending' && session.invitedBy !== user.id) {
        console.log('💌 Accepting pending invitation...');
        
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
          console.error('❌ Error accepting invitation:', participantError);
          toast({
            title: "Error",
            description: "Failed to accept invitation",
            variant: "destructive"
          });
          return;
        }

        console.log('✅ Participant acceptance updated successfully');

        // Update invite status
        const { error: inviteUpdateError } = await supabase
          .from('collaboration_invites')
          .update({ status: 'accepted' })
          .eq('session_id', sessionId)
          .eq('invited_user_id', user.id);

        if (inviteUpdateError) {
          console.error('⚠️ Error updating invite status:', inviteUpdateError);
        } else {
          console.log('✅ Invite status updated to accepted');
        }

        // Check if all participants have now accepted
        console.log('🔍 Checking if all participants have accepted...');
        const { data: allParticipants, error: participantsError } = await supabase
          .from('session_participants')
          .select('has_accepted, user_id')
          .eq('session_id', sessionId);

        if (participantsError) {
          console.error('❌ Error fetching participants:', participantsError);
        } else {
          console.log('👥 All participants:', allParticipants);
          const allAccepted = allParticipants?.every(p => p.has_accepted) || false;
          console.log('✅ All participants accepted?', allAccepted);

          if (allAccepted && allParticipants.length >= 2) {
            console.log('🎉 All participants accepted! Creating board and activating session...');
            
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
              console.error('❌ Error creating board:', boardError);
              toast({
                title: "Warning",
                description: "Session activated but board creation failed",
                variant: "destructive"
              });
            } else {
              console.log('✅ Board created successfully:', boardData);
              
              // Update session with board_id and active status
              const { error: sessionUpdateError } = await supabase
                .from('collaboration_sessions')
                .update({ 
                  status: 'active',
                  board_id: boardData.id 
                })
                .eq('id', sessionId);

              if (sessionUpdateError) {
                console.error('❌ Error updating session status:', sessionUpdateError);
              } else {
                console.log('✅ Session updated to active status');
              }

              // Add all participants to the board as collaborators
              const collaborators = allParticipants.map(p => ({
                board_id: boardData.id,
                user_id: p.user_id,
                role: p.user_id === session.invitedBy ? 'owner' : 'collaborator'
              }));

              console.log('👥 Adding collaborators to board:', collaborators);
              const { error: collaboratorsError } = await supabase
                .from('board_collaborators')
                .insert(collaborators);

              if (collaboratorsError) {
                console.error('❌ Error adding collaborators:', collaboratorsError);
              } else {
                console.log('✅ Collaborators added successfully');
              }
            }

            toast({
              title: "Collaboration started!",
              description: `All participants have joined! Board "${session.name}" has been created.`,
            });
          } else {
            console.log('⏳ Waiting for other participants...');
            toast({
              title: "Invitation accepted!",
              description: "Waiting for other participants to join...",
            });
          }
        }

        // Force reload sessions to update UI and remove accepted invite from pending
        console.log('🔄 Reloading sessions and updating state...');
        await loadUserSessions();
        
        // Immediately update state to remove the accepted invite
        setSessionState(prevState => ({
          ...prevState,
          pendingInvites: prevState.pendingInvites.filter(invite => invite.sessionId !== sessionId)
        }));
        
        // Check if session is now active after all participants accepted
        const { data: updatedSession } = await supabase
          .from('collaboration_sessions')
          .select('*, board_id')
          .eq('id', sessionId)
          .single();
        
                console.log('🔍 Updated session after reload:', updatedSession);
                
                if (updatedSession && updatedSession.status === 'active' && updatedSession.board_id) {
                  console.log('🎯 Session is now active with board, switching to it...');
                  
                  // Get updated participant information
                  const { data: updatedParticipants } = await supabase
                    .from('session_participants')
                    .select('user_id, has_accepted')
                    .eq('session_id', sessionId);
                  
                  const { data: participantProfiles } = await supabase
                    .from('profiles')
                    .select('id, username, first_name, last_name, avatar_url')
                    .in('id', updatedParticipants?.map(p => p.user_id) || []);
                  
                  // Create active session object
                  const activeSession: CollaborationSession = {
                    id: updatedSession.id,
                    name: updatedSession.name,
                    participants: updatedParticipants?.map(p => {
                      const profile = participantProfiles?.find(prof => prof.id === p.user_id);
                      return {
                        id: p.user_id,
                        name: profile ? (profile.first_name && profile.last_name ? `${profile.first_name} ${profile.last_name}` : profile.username) : 'Unknown',
                        username: profile?.username || 'unknown',
                        avatar: profile?.avatar_url || '',
                        hasAccepted: p.has_accepted
                      };
                    }) || [],
                    createdAt: updatedSession.created_at,
                    isActive: true,
                    boardId: updatedSession.board_id,
                    status: 'active',
                    invitedBy: updatedSession.created_by
                  };
                  
                  console.log('📍 Setting active session as current:', activeSession);
                  setSessionState(prevState => ({
                    ...prevState,
                    currentSession: activeSession,
                    pendingInvites: prevState.pendingInvites.filter(invite => invite.sessionId !== sessionId),
                    isInSolo: false
                  }));
                  
                  // Save to localStorage
                  localStorage.setItem('collaboration_session_state', JSON.stringify({
                    currentSession: activeSession,
                    isInSolo: false
                  }));

                  toast({
                    title: "Collaboration Active!",
                    description: `All participants joined! "${session.name}" board is ready for collaboration.`,
                  });
                }

        return;
      }

      // For active sessions, just switch to them
      if (session.status === 'active') {
        console.log('🎯 Switching to active session...');
        const newState = {
          currentSession: session,
          availableSessions: sessionState.availableSessions,
          pendingInvites: sessionState.pendingInvites,
          isInSolo: false,
          loading: sessionState.loading
        };
        
        setSessionState(newState);
        
        // Save to localStorage
        localStorage.setItem('collaboration_session_state', JSON.stringify({
          currentSession: session,
          isInSolo: false
        }));

        toast({
          title: "Switched to collaboration",
          description: `Now collaborating on "${session.name}"`,
        });
      } else {
        console.log('⚠️ Session not in expected state:', session.status);
      }

    } catch (error) {
      console.error('❌ Error in switchToCollaborative:', error);
      toast({
        title: "Error",
        description: "Failed to join collaboration session",
        variant: "destructive"
      });
    }
  }, [sessionState.availableSessions, user, loadUserSessions]);

  // Create new collaborative session
  const createCollaborativeSession = useCallback(async (participants: string[], sessionName: string) => {
    if (!user) {
      throw new Error('User not authenticated');
    }

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
        // Remove user from session participants (this will trigger cleanup)
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

        // Clear from localStorage
        localStorage.removeItem('collaboration_session_state');

        // Switch to solo mode
        const newState = {
          currentSession: null,
          availableSessions: sessionState.availableSessions,
          pendingInvites: sessionState.pendingInvites,
          isInSolo: true,
          loading: sessionState.loading
        };
        
        setSessionState(newState);

        toast({
          title: "Left collaboration session",
          description: `You've left "${session.name}".`,
        });

        // Reload sessions
        await loadUserSessions();
        return;
      }

      // Handle pending invitations or session management
      if (session.invitedBy === user.id) {
        // User is the creator - revoke the session
        await supabase
          .from('collaboration_invites')
          .update({ status: 'cancelled' })
          .eq('session_id', sessionId)
          .eq('invited_by', user.id);

        // Delete the session (this will cascade to participants and invites via trigger)
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

        // Remove user from participants (this may trigger session cleanup)
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
    try {
      console.log('🔔 Accepting invite:', inviteId);
      
      if (!user) {
        console.error('❌ No user found for invite acceptance');
        toast({
          title: "Error",
          description: "You must be logged in to accept invitations",
          variant: "destructive"
        });
        return;
      }

      // Find invite in current state OR fetch from database
      let invite = sessionState.pendingInvites.find(i => i.id === inviteId);
      
      if (!invite) {
        console.log('🔍 Invite not in state, fetching from database...');
        
        // Fetch invite directly from database
        const { data: dbInvite, error: inviteError } = await supabase
          .from('collaboration_invites')
          .select('*')
          .eq('id', inviteId)
          .eq('status', 'pending')
          .single();

        if (inviteError || !dbInvite) {
          console.error('❌ Invite not found in database:', inviteError);
          toast({
            title: "Error", 
            description: "Invitation not found or already processed",
            variant: "destructive"
          });
          return;
        }

        // Get session name separately
        const { data: sessionData, error: sessionError } = await supabase
          .from('collaboration_sessions')
          .select('name')
          .eq('id', dbInvite.session_id)
          .single();

        // Get inviter profile separately  
        const { data: inviterProfile, error: profileError } = await supabase
          .from('profiles')
          .select('id, username, first_name, last_name, avatar_url')
          .eq('id', dbInvite.invited_by)
          .single();

        // Convert database invite to our format
        invite = {
          id: dbInvite.id,
          sessionId: dbInvite.session_id,
          sessionName: sessionData?.name || 'Collaboration Session',
          invitedBy: {
            id: dbInvite.invited_by,
            name: inviterProfile?.first_name && inviterProfile?.last_name 
              ? `${inviterProfile.first_name} ${inviterProfile.last_name}` 
              : inviterProfile?.username || 'Unknown',
            username: inviterProfile?.username || 'unknown',
            avatar: inviterProfile?.avatar_url
          },
          message: dbInvite.message,
          status: 'pending',
          createdAt: dbInvite.created_at
        };
      }

      console.log('✅ Found invite for session:', invite.sessionId);

      // Step 1: Update invite status to accepted
      const { error: inviteUpdateError } = await supabase
        .from('collaboration_invites')
        .update({ 
          status: 'accepted',
          updated_at: new Date().toISOString()
        })
        .eq('id', inviteId)
        .eq('invited_user_id', user.id);

      if (inviteUpdateError) {
        console.error('❌ Error updating invite status:', inviteUpdateError);
        toast({
          title: "Error",
          description: "Failed to accept invitation",
          variant: "destructive"
        });
        return;
      }

      console.log('✅ Invite status updated to accepted');

      // Step 2: Add user as participant or update existing participation
      const { data: existingParticipant, error: checkError } = await supabase
        .from('session_participants')
        .select('*')
        .eq('session_id', invite.sessionId)
        .eq('user_id', user.id)
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        console.error('❌ Error checking existing participation:', checkError);
      }

      if (existingParticipant) {
        // Update existing participant
        const { error: updateError } = await supabase
          .from('session_participants')
          .update({ 
            has_accepted: true, 
            joined_at: new Date().toISOString() 
          })
          .eq('id', existingParticipant.id);

        if (updateError) {
          console.error('❌ Error updating participant:', updateError);
          toast({
            title: "Error",
            description: "Failed to join session",
            variant: "destructive"
          });
          return;
        }
      } else {
        // Create new participant record
        const { error: participantError } = await supabase
          .from('session_participants')
          .insert({
            session_id: invite.sessionId,
            user_id: user.id,
            has_accepted: true,
            joined_at: new Date().toISOString()
          });

        if (participantError) {
          console.error('❌ Error creating participant:', participantError);
          toast({
            title: "Error",
            description: "Failed to join session",
            variant: "destructive"
          });
          return;
        }
      }

      console.log('✅ User added as participant successfully');

      // Step 3: Check if all participants have accepted
      const { data: allParticipants, error: participantsError } = await supabase
        .from('session_participants')
        .select('has_accepted, user_id')
        .eq('session_id', invite.sessionId);

      if (participantsError) {
        console.error('❌ Error fetching participants:', participantsError);
        toast({
          title: "Joined session!",
          description: "Successfully joined collaboration session",
        });
        
        // Remove invite from UI and reload
        setSessionState(prevState => ({
          ...prevState,
          pendingInvites: prevState.pendingInvites.filter(i => i.id !== inviteId)
        }));
        await loadUserSessions();
        return;
      }

      const allAccepted = allParticipants?.every(p => p.has_accepted) || false;
      console.log('👥 All participants:', allParticipants);
      console.log('✅ All participants accepted?', allAccepted);

      if (allAccepted && allParticipants.length >= 2) {
        console.log('🎉 All participants accepted! Creating board and activating session...');
        
        // Get session details for board creation
        const { data: sessionData, error: sessionError } = await supabase
          .from('collaboration_sessions')
          .select('*')
          .eq('id', invite.sessionId)
          .single();

        if (sessionError || !sessionData) {
          console.error('❌ Error fetching session:', sessionError);
        } else {
          // Create board
          const { data: boardData, error: boardError } = await supabase
            .from('boards')
            .insert({
              name: sessionData.name,
              description: `Collaborative board for ${sessionData.name}`,
              created_by: sessionData.created_by,
              is_public: false,
              session_id: invite.sessionId
            })
            .select()
            .single();

          if (boardError) {
            console.error('❌ Error creating board:', boardError);
          } else {
            console.log('✅ Board created successfully:', boardData);
            
            // Update session status and board_id
            const { error: sessionUpdateError } = await supabase
              .from('collaboration_sessions')
              .update({ 
                status: 'active',
                board_id: boardData.id,
                updated_at: new Date().toISOString()
              })
              .eq('id', invite.sessionId);

            if (sessionUpdateError) {
              console.error('❌ Error updating session status:', sessionUpdateError);
            } else {
              console.log('✅ Session updated to active status');
            }

            // Add all participants as board collaborators
            const collaborators = allParticipants.map(p => ({
              board_id: boardData.id,
              user_id: p.user_id,
              role: p.user_id === sessionData.created_by ? 'owner' : 'collaborator'
            }));

            const { error: collaboratorsError } = await supabase
              .from('board_collaborators')
              .insert(collaborators);

            if (collaboratorsError) {
              console.error('❌ Error adding collaborators:', collaboratorsError);
            } else {
              console.log('✅ Collaborators added successfully');
            }
          }
        }

        toast({
          title: "Collaboration started!",
          description: `All participants have joined! Board "${invite.sessionName}" is ready for collaboration.`,
        });
      } else {
        toast({
          title: "Invitation accepted!",
          description: "Waiting for other participants to join...",
        });
      }

      // Step 4: Remove from UI and reload sessions
      setSessionState(prevState => ({
        ...prevState,
        pendingInvites: prevState.pendingInvites.filter(i => i.id !== inviteId)
      }));
      
      await loadUserSessions();
      
    } catch (error) {
      console.error('❌ Error accepting invite:', error);
      toast({
        title: "Error",
        description: "Failed to accept invitation. Please try again.",
        variant: "destructive"
      });
      
      // Reload sessions to restore correct state
      await loadUserSessions();
    }
  }, [user, sessionState.pendingInvites, loadUserSessions]);

  // Decline specific invite (from notification)
  const declineInvite = useCallback(async (inviteId: string) => {
    if (!user) return;

    console.log('❌ Declining invite:', inviteId);

    try {
      // Update invite status to declined
      const { error: inviteUpdateError } = await supabase
        .from('collaboration_invites')
        .update({ 
          status: 'declined',
          updated_at: new Date().toISOString()
        })
        .eq('id', inviteId)
        .eq('invited_user_id', user.id);

      if (inviteUpdateError) {
        console.error('❌ Error declining invite:', inviteUpdateError);
        toast({
          title: "Error",
          description: "Failed to decline invitation",
          variant: "destructive"
        });
        return;
      }

      console.log('✅ Invite declined successfully');

      // Remove any participant record for this user in this session
      // Find the invite to get session ID
      const inviteToDecline = sessionState.pendingInvites.find(i => i.id === inviteId);
      if (inviteToDecline) {
        await supabase
          .from('session_participants')
          .delete()
          .eq('session_id', inviteToDecline.sessionId)
          .eq('user_id', user.id);
      } else {
        // If invite not in state, get session ID from database
        const { data: dbInvite } = await supabase
          .from('collaboration_invites')
          .select('session_id')
          .eq('id', inviteId)
          .single();
        
        if (dbInvite) {
          await supabase
            .from('session_participants')
            .delete()
            .eq('session_id', dbInvite.session_id)
            .eq('user_id', user.id);
        }
      }

      toast({
        title: "Invitation declined",
        description: "You've declined the collaboration invitation",
      });

      // Remove from UI and reload
      setSessionState(prevState => ({
        ...prevState,
        pendingInvites: prevState.pendingInvites.filter(i => i.id !== inviteId)
      }));

      await loadUserSessions();

    } catch (error) {
      console.error('❌ Error declining invite:', error);
      toast({
        title: "Error",
        description: "Failed to decline invitation",
        variant: "destructive"
      });
    }
    
    // Immediately remove from UI
    setSessionState(prevState => ({
      ...prevState,
      pendingInvites: prevState.pendingInvites.filter(i => i.id !== inviteId)
    }));

    try {
      // Update invite status to declined
      await supabase
        .from('collaboration_invites')
        .update({ status: 'declined' })
        .eq('id', inviteId);

      // Get session ID from invite to remove participant
      const { data: dbInvite } = await supabase
        .from('collaboration_invites')
        .select('session_id')
        .eq('id', inviteId)
        .single();
      
      if (dbInvite) {
        // Remove user from session participants
        await supabase
          .from('session_participants')
          .delete()
          .eq('session_id', dbInvite.session_id)
          .eq('user_id', user.id);
      }

      toast({
        title: "Invitation declined",
        description: "You've declined the collaboration invitation.",
      });

      // Reload sessions to update state
      await loadUserSessions();

    } catch (error) {
      console.error('❌ Error declining invite:', error);
      
      // Restore invite to UI if error occurred
      await loadUserSessions();
      
      toast({
        title: "Error",
        description: "Failed to decline invitation. Please try again.",
        variant: "destructive"
      });
    }
  }, [user, sessionState.pendingInvites, loadUserSessions]);

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

  // Revoke specific invite (inviter only)
  const handleRevokeInvite = useCallback(async (inviteId: string) => {
    if (!user) {
      toast({
        title: "Error",
        description: "You must be logged in to revoke invitations",
        variant: "destructive"
      });
      return;
    }

    try {
      console.log('🚫 Revoking invite:', inviteId);
      
      const result = await apiRevokeInvite(inviteId);
      console.log('✅ Invite revoked:', result);
      
      toast({
        title: "Invitation Revoked",
        description: "The invitation has been revoked.",
      });
      
      // Reload sessions to reflect changes
      await loadUserSessions();
      
    } catch (error) {
      console.error('❌ Error revoking invite:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to revoke invitation",
        variant: "destructive"
      });
    }
  }, [user, loadUserSessions]);

  return {
    ...sessionState,
    switchToSolo,
    switchToCollaborative,
    createCollaborativeSession,
    cancelSession,
    acceptInvite,
    declineInvite,
    revokeInvite: handleRevokeInvite,
    loading: sessionState.loading
  };
};