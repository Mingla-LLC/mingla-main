import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../services/supabase';
import { useAppStore } from '../store/appStore';
import { CollaborationSession, SessionInvite, SessionState } from '../types';
import { createPendingSessionInvite } from '../services/phoneLookupService';
import { notificationService } from '../services/notificationService';

export interface SessionParticipantInput {
  type: 'existing_user' | 'phone_invite'
  userId?: string
  username?: string
  phoneE164?: string
  displayName?: string
}

// DB row types for useSessionManagement queries
interface SessionRow {
  id: string
  name: string
  created_by: string
  status: string
  board_id: string | null
  created_at: string
  updated_at: string
  session_type?: string
  is_active?: boolean
  max_participants?: number | null
  last_activity_at?: string
}

interface ParticipantRow {
  session_id: string
  user_id: string
  has_accepted: boolean
  joined_at?: string
  is_admin?: boolean
  id?: string
}

interface ProfileRow {
  id: string
  username: string
  display_name: string | null
  first_name: string | null
  last_name: string | null
  avatar_url: string | null
}

interface ParticipationRow {
  session_id: string
  has_accepted: boolean
  joined_at: string | null
  collaboration_sessions?: SessionRow | SessionRow[]
}

export const useSessionManagement = () => {
  const [sessionState, setSessionState] = useState<SessionState>(() => {
    // Try to restore session state from AsyncStorage (mobile equivalent of localStorage)
    // For now, we'll use a simple in-memory state
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

    setSessionState(prev => ({ ...prev, loading: true }));
    
    try {
      // 1. First load received invites to know all relevant sessions
      const { data: receivedInvites, error: receivedError } = await supabase
        .from('collaboration_invites')
        .select('*')
        .eq('invitee_id', user.id)
        .eq('status', 'pending');

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

      const sessionIds = userParticipations?.map(p => p.session_id) || [];

      // 3. Load all collaboration sessions for these session IDs
      let allSessions: SessionRow[] = [];
      if (sessionIds.length > 0) {
        const { data: sessions, error: sessionsError } = await supabase
          .from('collaboration_sessions')
          .select('*')
          .in('id', sessionIds);

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
          const { data: inviteSessions, error: inviteSessionsError } = await supabase
            .from('collaboration_sessions')
            .select('*')
            .in('id', missingSessionIds);

          if (inviteSessionsError) {
            console.error('❌ Error loading invite sessions:', inviteSessionsError);
          } else {
            allSessions = [...allSessions, ...(inviteSessions || [])];
          }
        }
      }

      // 4. Load all participants for these sessions (including invite sessions)
      let allParticipants: ParticipantRow[] = [];
      const allSessionIds = [...new Set([...sessionIds, ...(receivedInvites?.map(i => i.session_id) || [])])];
      
      if (allSessionIds.length > 0) {
        const { data: participants, error: participantsError } = await supabase
          .from('session_participants')
          .select('*')
          .in('session_id', allSessionIds);

        if (participantsError) {
          console.error('❌ Error loading participants:', participantsError);
        } else {
          allParticipants = participants || [];
        }
      }

      // 5. Load profiles for all participants
      const participantUserIds = [...new Set(allParticipants.map(p => p.user_id))];
      let profiles: ProfileRow[] = [];
      if (participantUserIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, username, display_name, first_name, last_name, avatar_url')
          .in('id', participantUserIds);

        if (profilesError) {
          console.error('❌ Error loading profiles:', profilesError);
        } else {
          profiles = profilesData || [];
        }
      }

      // 6. Load inviter profiles for received invites
      const inviterIds = [...new Set((receivedInvites || []).map(i => i.inviter_id))];
      let inviterProfiles: ProfileRow[] = [];
      if (inviterIds.length > 0) {
        const { data: invitersData, error: invitersError } = await supabase
          .from('profiles')
          .select('id, username, display_name, first_name, last_name, avatar_url')
          .in('id', inviterIds);

        if (invitersError) {
          console.error('❌ Error loading inviter profiles:', invitersError);
        } else {
          inviterProfiles = invitersData || [];
        }
      }

      // Helper function to get profile by user ID
      const getProfile = (userId: string) => {
        return profiles.find(p => p.id === userId);
      };

      // Helper function to format profile name
      const formatProfileName = (profile: ProfileRow | undefined) => {
        if (!profile) return 'Unknown User';
        if (profile.display_name) return profile.display_name;
        if (profile.first_name && profile.last_name) {
          return `${profile.first_name} ${profile.last_name}`;
        }
        return profile.username || 'Unknown User';
      };

      // Format sessions with correct status logic - include sessions even with 1 participant for pending invites
      const formattedSessions: CollaborationSession[] = allSessions
        .filter(session => {
          const sessionParticipants = allParticipants.filter(p => p.session_id === session.id);

          if (sessionParticipants.length < 2) {
            return false;
          }

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
        const inviter = inviterProfiles.find(p => p.id === invite.inviter_id);
        
        return {
          id: invite.id,
          sessionId: invite.session_id,
          sessionName: session?.name || 'Collaboration Session',
          invitedBy: {
            id: inviter?.id || invite.inviter_id,
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
      console.error('❌ Error loading sessions:', error);
      setSessionState(prev => ({ ...prev, loading: false }));
    }
  }, [user]);

  // Create new collaborative session
  const createCollaborativeSession = useCallback(async (participants: string[], sessionName: string) => {
    if (!user) {
      throw new Error('User not authenticated');
    }

    let sessionData: SessionRow | null = null;
    try {
      const resolvedName = sessionName || `Collaboration Session ${new Date().toLocaleDateString()}`;

      // Check for real duplicate: any session where user is an accepted participant with this name
      const { data: participations } = await supabase
        .from('session_participants')
        .select('session_id, collaboration_sessions!inner(id, name)')
        .eq('user_id', user.id)
        .eq('has_accepted', true);

      const hasDuplicate = (participations || []).some((p: ParticipationRow) => {
        const s = Array.isArray(p.collaboration_sessions) ? p.collaboration_sessions[0] : p.collaboration_sessions;
        return s?.name?.toLowerCase() === resolvedName.toLowerCase();
      });

      if (hasDuplicate) {
        throw new Error('A collaboration session already exists with that name.');
      }

      // Clean up any ghost sessions with this name (created by user but no participant record)
      const { data: ghostSessions } = await supabase
        .from('collaboration_sessions')
        .select('id')
        .eq('created_by', user.id)
        .ilike('name', resolvedName);

      if (ghostSessions && ghostSessions.length > 0) {
        await supabase
          .from('collaboration_sessions')
          .delete()
          .in('id', ghostSessions.map((s: { id: string }) => s.id));
      }

      // Create the session (no board yet - only created when all accept)
      const { data: createdSession, error: sessionError } = await supabase
        .from('collaboration_sessions')
        .insert({
          name: resolvedName,
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
      sessionData = createdSession;

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

      // Create preference record for the creator
      const { error: preferencesError } = await supabase
        .from('board_session_preferences')
        .insert({
          session_id: sessionData.id,
          user_id: user.id,
          budget_min: 0,
          budget_max: 1000,
          categories: [],
          travel_mode: 'walking',
          travel_constraint_type: 'time',
          travel_constraint_value: 30,
        });

      if (preferencesError) {
        console.error('Error creating preferences for creator:', preferencesError);
        // Don't throw - preferences can be created later when user opens preferences sheet
      }

      // Process participants
      const participantPromises = participants.map(async (username) => {
        // Find user by username (include email for push notification edge function)
        const { data: userData, error: userError } = await supabase
          .from('profiles')
          .select('id, email')
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

        // Send invitation and get invite ID back for the notification
        const { data: inviteData, error: inviteError } = await supabase
          .from('collaboration_invites')
          .insert({
            session_id: sessionData.id,
            inviter_id: user.id,
            invitee_id: userData.id,
            status: 'pending'
          })
          .select('id')
          .single();

        if (inviteError) {
          console.error('Error sending invitation:', inviteError);
          return { success: false, username };
        }

        // Send push notification via edge function (fire-and-forget — don't block invite creation)
        supabase.functions.invoke('send-collaboration-invite', {
          body: {
            inviterId: user.id,
            invitedUserId: userData.id,
            invitedUserEmail: userData.email || '',
            sessionId: sessionData.id,
            sessionName: resolvedName,
            inviteId: inviteData?.id,
          }
        }).catch(err => {
          console.error('[useSessionManagement] Push notification failed for', username, err);
        });

        return { success: true, username, userId: userData.id };
      });

      const results = await Promise.all(participantPromises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      if (failed.length > 0) {
        console.error('Failed to invite some users:', failed);
      }


      // Reload sessions
      await loadUserSessions();

      return sessionData.id;

    } catch (error) {
      console.error('Error creating collaborative session:', error);
      // Roll back the ghost session if it was inserted before the failure
      if (sessionData?.id) {
        supabase.from('collaboration_sessions').delete().eq('id', sessionData.id).then(({ error: deleteError }) => {
          if (deleteError) console.error('Error cleaning up failed session:', deleteError);
        });
      }
      throw error;
    }
  }, [user, loadUserSessions]);

  // Create collaborative session with mixed participant types (existing users + phone invites)
  const createCollaborativeSessionV2 = useCallback(
    async (
      participants: SessionParticipantInput[],
      sessionName: string,
      preferences?: {
        categories: string[]
        intents: string[]
        priceTiers: string[]
        travelMode: string
        travelTimeMinutes: number
      }
    ) => {
      // Verify auth BEFORE creating anything — prevents orphaned sessions on auth failure
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) return null

      // Extract usernames from existing_user participants for the existing flow
      const existingUserParticipants = participants.filter(p => p.type === 'existing_user')
      const phoneInviteParticipants = participants.filter(p => p.type === 'phone_invite')

      // Use the existing username-based flow for existing users
      const usernames = existingUserParticipants
        .map(p => p.username)
        .filter((u): u is string => !!u)

      // Call the existing createCollaborativeSession for the username-based participants
      const sessionId = await createCollaborativeSession(usernames, sessionName)

      if (!sessionId) return null

      for (const p of phoneInviteParticipants) {
        if (p.phoneE164) {
          await createPendingSessionInvite(sessionId, authUser.id, p.phoneE164)
        }
      }

      // Copy preferences if provided
      if (preferences) {
        const { error: prefError } = await supabase
          .from('board_session_preferences')
          .upsert({
            session_id: sessionId,
            user_id: authUser.id,
            categories: preferences.categories,
            intents: preferences.intents,
            price_tiers: preferences.priceTiers,
            budget_min: 0,
            budget_max: 1000,
            travel_mode: preferences.travelMode,
            travel_constraint_type: 'time',
            travel_constraint_value: preferences.travelTimeMinutes,
          }, { onConflict: 'session_id,user_id' })

        if (prefError) {
          console.error('[useSessionManagement] Failed to copy preferences:', prefError)
        }
      }

      return sessionId
    },
    [createCollaborativeSession]
  );

  // Accept specific invite (from notification)
  const acceptInvite = useCallback(async (inviteId: string) => {
    try {
      
      if (!user) {
        console.error('❌ No user found for invite acceptance');
        return;
      }

      // Find invite in current state OR fetch from database
      let invite = sessionState.pendingInvites.find(i => i.id === inviteId);
      
      if (!invite) {
        
        // Fetch invite directly from database
        const { data: dbInvite, error: inviteError } = await supabase
          .from('collaboration_invites')
          .select('*')
          .eq('id', inviteId)
          .eq('status', 'pending')
          .single();

        if (inviteError || !dbInvite) {
          console.error('❌ Invite not found in database:', inviteError);
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
          .select('id, username, display_name, first_name, last_name, avatar_url')
          .eq('id', dbInvite.inviter_id)
          .single();

        // Convert database invite to our format
        invite = {
          id: dbInvite.id,
          sessionId: dbInvite.session_id,
          sessionName: sessionData?.name || 'Collaboration Session',
          invitedBy: {
            id: dbInvite.inviter_id,
            name: inviterProfile?.display_name ||
              (inviterProfile?.first_name && inviterProfile?.last_name
              ? `${inviterProfile.first_name} ${inviterProfile.last_name}`
              : inviterProfile?.username) || 'Unknown',
            username: inviterProfile?.username || 'unknown',
            avatar: inviterProfile?.avatar_url
          },
          message: dbInvite.message,
          status: 'pending',
          createdAt: dbInvite.created_at
        };
      }


      // Step 1: Update invite status to accepted
      const { error: inviteUpdateError } = await supabase
        .from('collaboration_invites')
        .update({ 
          status: 'accepted',
          updated_at: new Date().toISOString()
        })
        .eq('id', inviteId)
        .eq('invitee_id', user.id);

      if (inviteUpdateError) {
        console.error('❌ Error updating invite status:', inviteUpdateError);
        return;
      }


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
          return;
        }
      }

      // Create preference record for the accepting user
      const { error: preferencesError } = await supabase
        .from('board_session_preferences')
        .insert({
          session_id: invite.sessionId,
          user_id: user.id,
          budget_min: 0,
          budget_max: 1000,
          categories: [],
          travel_mode: 'walking',
          travel_constraint_type: 'time',
          travel_constraint_value: 30,
        });

      if (preferencesError && preferencesError.code !== '23505') {
        // 23505 is unique violation - preferences might already exist, which is fine
        console.error('❌ Error creating preferences for accepting user:', preferencesError);
        // Don't return - this is not critical, preferences can be created later
      }


      // Step 3: Check membership count (source of truth for state transitions)
      // Count accepted members to determine if session should become active
      const { data: allParticipants, error: participantsError } = await supabase
        .from('session_participants')
        .select('has_accepted, user_id')
        .eq('session_id', invite.sessionId);

      if (participantsError) {
        console.error('❌ Error fetching participants:', participantsError);
        
        // Remove invite from UI and reload
        setSessionState(prevState => ({
          ...prevState,
          pendingInvites: prevState.pendingInvites.filter(i => i.id !== inviteId)
        }));
        await loadUserSessions();
        return;
      }

      // Membership count is the source of truth for state transitions
      const acceptedMembers = allParticipants?.filter(p => p.has_accepted) || [];
      const acceptedCount = acceptedMembers.length;

      // Session becomes active when at least 2 members have accepted
      if (acceptedCount >= 2) {
        
        // Get session details for board creation
        const { data: sessionData, error: sessionError } = await supabase
          .from('collaboration_sessions')
          .select('*')
          .eq('id', invite.sessionId)
          .single();

        if (sessionError || !sessionData) {
          console.error('❌ Error fetching session:', sessionError);
        } else {
          // IDEMPOTENT BOARD CREATION: Use session's board_id (the actual relationship)
          // collaboration_sessions.board_id points to boards.id — NOT boards.session_id
          let boardId: string | null = sessionData.board_id || null;

          // Only create board if session doesn't already have one
          if (!boardId) {
            const { data: boardData, error: boardError } = await supabase
              .from('boards')
              .insert({
                name: sessionData.name,
                description: `Collaborative board for ${sessionData.name}`,
                created_by: sessionData.created_by,
                is_public: false,
              })
              .select()
              .single();

            if (boardError) {
              console.error('❌ Error creating board:', boardError);
            } else {
              boardId = boardData.id;
              console.log('✅ Board created successfully:', boardId);
            }
          } else {
            console.log('✅ Board already exists for session, skipping creation:', boardId);
          }

          // Update session status and board_id if we have a board
          if (boardId) {
            // Only update if session is not already active (idempotent)
            if (sessionData.status !== 'active') {
              const { error: sessionUpdateError } = await supabase
                .from('collaboration_sessions')
                .update({ 
                  status: 'active',
                  board_id: boardId,
                  updated_at: new Date().toISOString()
                })
                .eq('id', invite.sessionId)
                .eq('status', 'pending'); // Only update if still pending (optimistic locking)

              if (sessionUpdateError) {
                console.error('❌ Error updating session status:', sessionUpdateError);
              } else {
                console.log('✅ Session status updated to active');
              }
            }

            // Add all accepted participants as board collaborators (idempotent with ON CONFLICT)
            for (const participant of acceptedMembers) {
              const { error: collaboratorError } = await supabase
                .from('board_collaborators')
                .upsert({
                  board_id: boardId,
                  user_id: participant.user_id,
                  role: participant.user_id === sessionData.created_by ? 'owner' : 'collaborator'
                }, {
                  onConflict: 'board_id,user_id',
                  ignoreDuplicates: true
                });

              if (collaboratorError && collaboratorError.code !== '23505') {
                console.error('❌ Error adding collaborator:', collaboratorError);
              }
            }
          }
        }

      } else {
        console.log(`Session still pending: ${acceptedCount}/2 members accepted`);
      }

      // Step 4: Remove from UI and reload sessions
      setSessionState(prevState => ({
        ...prevState,
        pendingInvites: prevState.pendingInvites.filter(i => i.id !== inviteId)
      }));
      
      await loadUserSessions();

    } catch (error) {
      console.error('❌ Error accepting invite:', error);
      
      // Reload sessions to restore correct state
      await loadUserSessions();
    }
  }, [user, sessionState.pendingInvites, loadUserSessions]);

  // Decline specific invite (from notification)
  const declineInvite = useCallback(async (inviteId: string) => {
    if (!user) return;


    try {
      // Update invite status to declined
      const { error: inviteUpdateError } = await supabase
        .from('collaboration_invites')
        .update({ 
          status: 'declined',
          updated_at: new Date().toISOString()
        })
        .eq('id', inviteId)
        .eq('invitee_id', user.id);

      if (inviteUpdateError) {
        console.error('❌ Error declining invite:', inviteUpdateError);
        return;
      }


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


      // Remove from UI and reload
      setSessionState(prevState => ({
        ...prevState,
        pendingInvites: prevState.pendingInvites.filter(i => i.id !== inviteId)
      }));

      await loadUserSessions();

    } catch (error) {
      console.error('❌ Error declining invite:', error);
    }
  }, [user, sessionState.pendingInvites, loadUserSessions]);

  // Switch to solo session
  const switchToSolo = useCallback(() => {
    if (sessionState.currentSession) {
    }
    
    const newState = {
      currentSession: null,
      availableSessions: sessionState.availableSessions,
      pendingInvites: sessionState.pendingInvites,
      isInSolo: true,
      loading: sessionState.loading
    };
    
    setSessionState(newState);
  }, [sessionState]);

  // Switch to collaborative session (accept invitation)
  const switchToCollaborative = useCallback(async (sessionId: string) => {
    
    // First try to find in available sessions, then reload if not found
    let session = sessionState.availableSessions.find(s => s.id === sessionId);
    
    if (!session) {
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
      return;
    }


    try {
      // For active sessions, just switch to them
      if (session.status === 'active') {
        const newState = {
          currentSession: session,
          availableSessions: sessionState.availableSessions,
          pendingInvites: sessionState.pendingInvites,
          isInSolo: false,
          loading: sessionState.loading
        };
        
        setSessionState(newState);
      } else {
      }

    } catch (error) {
      console.error('❌ Error in switchToCollaborative:', error);
    }
  }, [sessionState.availableSessions, user, loadUserSessions]);

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
          .eq('invitee_id', user.id);

        // Switch to solo mode
        const newState = {
          currentSession: null,
          availableSessions: sessionState.availableSessions,
          pendingInvites: sessionState.pendingInvites,
          isInSolo: true,
          loading: sessionState.loading
        };
        
        setSessionState(newState);


        // Reload sessions
        await loadUserSessions();
        return;
      }

      // Check if user is admin
      const { data: participantData } = await supabase
        .from('session_participants')
        .select('is_admin')
        .eq('session_id', sessionId)
        .eq('user_id', user.id)
        .single()

      const isAdmin = participantData?.is_admin === true
      const isCreator = session.invitedBy === user.id

      // Handle pending invitations or session management
      if (isCreator || isAdmin) {
        // Send notifications before deletion
        const { data: otherParticipants } = await supabase
          .from('session_participants')
          .select('user_id')
          .eq('session_id', sessionId)
          .neq('user_id', user.id);

        if (otherParticipants?.length) {
          const sessionName = sessionState.availableSessions.find(s => s.id === sessionId)?.name ?? 'Session';
          for (const p of otherParticipants) {
            try {
              await notificationService.sendSessionUpdate(p.user_id, sessionName, 'session_ended');
            } catch (notifError) {
              console.error('[useSessionManagement] Push notification failed:', notifError);
            }
          }
        }

        // User is the creator or admin - revoke the session
        await supabase
          .from('collaboration_invites')
          .update({ status: 'cancelled' })
          .eq('session_id', sessionId)
          .eq('inviter_id', user.id);

        // Delete the session (this will cascade to participants and invites via trigger)
        await supabase
        .from('collaboration_sessions')
          .delete()
          .eq('id', sessionId)
          .eq('created_by', user.id);

      } else {
        // User was invited - decline the invitation
        await supabase
          .from('collaboration_invites')
          .update({ status: 'declined' })
          .eq('session_id', sessionId)
          .eq('invitee_id', user.id);

        // Remove user from participants (this may trigger session cleanup)
        await supabase
          .from('session_participants')
          .delete()
          .eq('session_id', sessionId)
          .eq('user_id', user.id);

      }

      // Reload sessions
      await loadUserSessions();

    } catch (error) {
      console.error('Error handling session cancellation:', error);
    }
  }, [sessionState.availableSessions, sessionState.currentSession, user, loadUserSessions]);

  // Debounced reload — collapses rapid Realtime events into a single query burst.
  // Creating a session inserts into 3 tables in quick succession; without debouncing,
  // each insert fires loadUserSessions() independently (3× the queries).
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedReload = useCallback(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      loadUserSessions();
    }, 300);
  }, [loadUserSessions]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    };
  }, []);

  // Load sessions on mount and when user changes
  useEffect(() => {
    if (!user) return;

    loadUserSessions();

    // Set up realtime subscriptions for collaboration updates.
    // Filter collaboration_invites to only events targeting this user (invitee_id)
    // so the pill appears instantly when an invite is created for them.
    // session_participants and collaboration_sessions rely on RLS for access
    // control — we can't filter by a single column since involvement is
    // determined by the session_participants join.
    const channel = supabase
      .channel(`collaboration-updates-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_participants'
        },
        () => {
          debouncedReload();
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
          debouncedReload();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'collaboration_invites',
          filter: `invitee_id=eq.${user.id}`
        },
        () => {
          // New invite targeting this user — reload immediately (no debounce)
          // so the collaboration pill appears as fast as possible.
          loadUserSessions();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'collaboration_invites'
        },
        () => {
          debouncedReload();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'collaboration_invites'
        },
        () => {
          debouncedReload();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, loadUserSessions, debouncedReload]);

  return {
    ...sessionState,
    switchToSolo,
    switchToCollaborative,
    createCollaborativeSession,
    createCollaborativeSessionV2,
    cancelSession,
    acceptInvite,
    declineInvite,
    loadUserSessions,
    loading: sessionState.loading
  };
};
