import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../services/supabase';
import { useAppStore } from '../store/appStore';
import { CollaborationSession, SessionInvite, SessionState } from '../types';
import { createPendingSessionInvite } from '../services/phoneLookupService';

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
  created_by: string | null
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

// ORCH-0443: buildSeedFromSoloPrefs deleted. Replaced by
// collabPreferenceSeedService.seedCollabPrefsFromSolo — single source of truth.

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

  // H9 FIX: Keep a ref that always holds the latest sessionState.
  // Callbacks that run after async operations (like loadUserSessions) close over
  // the old sessionState value. Reading from the ref gives the post-reload value.
  const sessionStateRef = useRef(sessionState);
  sessionStateRef.current = sessionState;

  // Load user's sessions and invites.
  // Queries are parallelized with Promise.all where dependencies allow:
  //   Round 1 (parallel): invites + participations (independent)
  //   Round 2 (parallel): sessions + invite-sessions + phone-invites + all-participants
  //   Round 3 (parallel): participant-profiles + inviter-profiles
  // This cuts 8 sequential queries into 3 parallel rounds (~60% faster).
  const loadUserSessions = useCallback(async () => {
    if (!user) return;

    setSessionState(prev => ({ ...prev, loading: true }));

    try {
      // ── Round 1 (parallel): invites + participations ──────────────────
      const [invitesResult, participationsResult] = await Promise.all([
        supabase
          .from('collaboration_invites')
          .select('*')
          .eq('invited_user_id', user.id)
          .eq('status', 'pending')
          .eq('pending_friendship', false),
        supabase
          .from('session_participants')
          .select('session_id, has_accepted, joined_at')
          .eq('user_id', user.id),
      ]);

      const receivedInvites = invitesResult.data;
      if (invitesResult.error) {
        console.error('❌ Error loading received invites:', invitesResult.error);
      }

      const userParticipations = participationsResult.data;
      if (participationsResult.error) {
        console.error('❌ Error loading participations:', participationsResult.error);
        setSessionState(prev => ({ ...prev, loading: false }));
        return;
      }

      const sessionIds = userParticipations?.map(p => p.session_id) || [];
      const inviteSessionIds = receivedInvites
        ? [...new Set(receivedInvites.map(invite => invite.session_id))]
        : [];
      const missingSessionIds = inviteSessionIds.filter(id => !sessionIds.includes(id));
      const allSessionIds = [...new Set([...sessionIds, ...inviteSessionIds])];

      // ── Round 2 (parallel): sessions + invite-sessions + participants + phone-invites
      const [sessionsResult, inviteSessionsResult, participantsResult, phoneInvitesResult] =
        await Promise.all([
          // Sessions by participant IDs
          sessionIds.length > 0
            ? supabase.from('collaboration_sessions').select('*').in('id', sessionIds)
            : Promise.resolve({ data: [] as SessionRow[], error: null }),
          // Sessions from received invites (missing from participation)
          missingSessionIds.length > 0
            ? supabase.from('collaboration_sessions').select('*').in('id', missingSessionIds)
            : Promise.resolve({ data: [] as SessionRow[], error: null }),
          // All participants for all sessions
          allSessionIds.length > 0
            ? supabase.from('session_participants').select('*').in('session_id', allSessionIds)
            : Promise.resolve({ data: [] as ParticipantRow[], error: null }),
          // Pending phone invites
          allSessionIds.length > 0
            ? supabase.from('pending_session_invites').select('session_id, phone_e164').in('session_id', allSessionIds).eq('status', 'pending')
            : Promise.resolve({ data: [] as { session_id: string; phone_e164: string }[], error: null }),
        ] as const);

      if (sessionsResult.error) console.error('❌ Error loading sessions:', sessionsResult.error);
      if (inviteSessionsResult.error) console.error('❌ Error loading invite sessions:', inviteSessionsResult.error);
      if (participantsResult.error) console.error('❌ Error loading participants:', participantsResult.error);
      if (phoneInvitesResult.error) console.error('❌ Error loading pending phone invites:', phoneInvitesResult.error);

      let allSessions: SessionRow[] = [
        ...(sessionsResult.data || []),
        ...(inviteSessionsResult.data || []),
      ];
      const allParticipants: ParticipantRow[] = participantsResult.data || [];
      const pendingPhoneInvites: { session_id: string; phone_e164: string }[] = phoneInvitesResult.data || [];

      // ── Round 3 (parallel): participant profiles + inviter profiles ────
      const participantUserIds = [...new Set(allParticipants.map(p => p.user_id))];
      const inviterIds = [...new Set((receivedInvites || []).map(i => i.inviter_id))];

      const [profilesResult, inviterProfilesResult] = await Promise.all([
        participantUserIds.length > 0
          ? supabase.from('profiles').select('id, username, display_name, first_name, last_name, avatar_url').in('id', participantUserIds)
          : Promise.resolve({ data: [], error: null }),
        inviterIds.length > 0
          ? supabase.from('profiles').select('id, username, display_name, first_name, last_name, avatar_url').in('id', inviterIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (profilesResult.error) console.error('❌ Error loading profiles:', profilesResult.error);
      if (inviterProfilesResult.error) console.error('❌ Error loading inviter profiles:', inviterProfilesResult.error);

      const profiles: ProfileRow[] = profilesResult.data || [];
      const inviterProfiles: ProfileRow[] = inviterProfilesResult.data || [];

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
          const sessionPhoneInvites = pendingPhoneInvites.filter(pi => pi.session_id === session.id);

          // Total "members" = real participants + pending phone invites (non-Mingla users)
          const totalMembers = sessionParticipants.length + sessionPhoneInvites.length;

          if (totalMembers < 2) {
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
          const inviterProfile = session.created_by ? getProfile(session.created_by) : null;
          const formattedInviterProfile = inviterProfile ? {
            id: inviterProfile.id,
            name: formatProfileName(inviterProfile),
            username: inviterProfile.username || 'unknown',
            avatar: inviterProfile.avatar_url ?? undefined
          } : undefined;

          return {
            id: session.id,
            name: session.name,
            participants,
            createdAt: session.created_at,
            isActive: allAccepted && participants.length >= 2,
            boardId: session.board_id ?? undefined,
            status,
            invitedBy: session.created_by || '',
            inviterProfile: formattedInviterProfile,
            created_by: session.created_by || '',
            created_at: session.created_at,
            updated_at: session.updated_at,
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
            avatar: inviter?.avatar_url ?? undefined
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

      const matchingParticipations = ((participations || []) as ParticipationRow[]).filter((p) => {
        const s = Array.isArray(p.collaboration_sessions) ? p.collaboration_sessions[0] : p.collaboration_sessions;
        return s?.name?.toLowerCase() === resolvedName.toLowerCase();
      });

      // For each matching session, check if it's a real session (2+ real participants)
      // or a limbo session (only the creator). Limbo sessions get cleaned up, not blocked.
      for (const match of matchingParticipations) {
        const { data: sessionMembers } = await supabase
          .from('session_participants')
          .select('user_id')
          .eq('session_id', match.session_id);

        const realMemberCount = sessionMembers?.length || 0;

        if (realMemberCount >= 2) {
          // Real session with 2+ participants — block as duplicate
          throw new Error('A collaboration session already exists with that name.');
        } else {
          // Limbo session (creator only, phone invites don't count as real participants yet)
          // Clean it up so the user can recreate it properly
          await supabase
            .from('collaboration_sessions')
            .delete()
            .eq('id', match.session_id);
        }
      }

      // Clean up any ghost sessions with this name (created by user but no participant record at all)
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
      if (!sessionData) throw new Error('Session creation returned no data');

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

      // ORCH-0446: Write creator's solo prefs to session JSONB via atomic RPC
      try {
        const { data: soloPrefs } = await supabase
          .from('preferences')
          .select('*')
          .eq('profile_id', user.id)
          .maybeSingle();

        const creatorPrefsPayload = {
            categories: soloPrefs?.categories?.length ? soloPrefs.categories : ['nature', 'drinks_and_music', 'icebreakers'],
            intents: soloPrefs?.intents ?? [],
            travel_mode: soloPrefs?.travel_mode ?? 'walking',
            travel_constraint_type: 'time',
            travel_constraint_value: soloPrefs?.travel_constraint_value ?? 30,
            date_option: soloPrefs?.date_option ?? null,
            datetime_pref: soloPrefs?.datetime_pref ?? null,
            selected_dates: soloPrefs?.selected_dates ?? null,
            use_gps_location: soloPrefs?.use_gps_location ?? true,
            custom_location: soloPrefs?.custom_location ?? null,
            custom_lat: soloPrefs?.custom_lat ?? null,
            custom_lng: soloPrefs?.custom_lng ?? null,
            intent_toggle: soloPrefs?.intent_toggle ?? true,
            category_toggle: soloPrefs?.category_toggle ?? true,
        };
        console.log('[useSessionManagement] Writing creator prefs:', JSON.stringify({ sessionId: sessionData.id, userId: user.id, categories: creatorPrefsPayload.categories }));
        const { error: rpcError } = await supabase.rpc('upsert_participant_prefs', {
          p_session_id: sessionData.id,
          p_user_id: user.id,
          p_prefs: creatorPrefsPayload,
        });
        if (rpcError) {
          console.error('[useSessionManagement] Creator pref RPC error:', rpcError.message, rpcError);
        } else {
          console.log('[useSessionManagement] Creator prefs written successfully');
        }
      } catch (seedErr) {
        console.error('[useSessionManagement] Creator pref write failed:', seedErr);
        // Non-blocking: deck aggregation works with remaining participants' prefs
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

        // Primary check: friends table (source of truth for accepted friendships)
        const { data: friendship } = await supabase
          .from('friends')
          .select('id')
          .eq('status', 'accepted')
          .or(`and(user_id.eq.${user.id},friend_user_id.eq.${userData.id}),and(user_id.eq.${userData.id},friend_user_id.eq.${user.id})`)
          .limit(1)
          .maybeSingle();

        let isFriend = !!friendship;

        // Fallback: check friend_requests in case friends table is out of sync
        // (should not happen after atomic accept RPC, but defense-in-depth)
        if (!isFriend) {
          const { data: acceptedRequest } = await supabase
            .from('friend_requests')
            .select('id')
            .eq('status', 'accepted')
            .or(`and(sender_id.eq.${user.id},receiver_id.eq.${userData.id}),and(sender_id.eq.${userData.id},receiver_id.eq.${user.id})`)
            .limit(1)
            .maybeSingle();

          isFriend = !!acceptedRequest;
        }

        // Add as participant (not accepted yet)
        const { error: participantError } = await supabase
          .from('session_participants')
          .insert({
            session_id: sessionData!.id,
            user_id: userData.id,
            has_accepted: false
          });

        if (participantError) {
          console.error('Error adding participant:', participantError);
          return { success: false, username };
        }

        // Create collaboration invite with pending_friendship flag
        const { data: inviteData, error: inviteError } = await supabase
          .from('collaboration_invites')
          .insert({
            session_id: sessionData!.id,
            inviter_id: user.id,
            invited_user_id: userData.id,
            status: 'pending',
            pending_friendship: !isFriend,
          })
          .select('id')
          .single();

        if (inviteError) {
          console.error('Error sending invitation:', inviteError);
          return { success: false, username };
        }

        // If not friend, send friend request (non-blocking side-effect)
        if (!isFriend) {
          await supabase
            .from('friend_requests')
            .upsert(
              { sender_id: user.id, receiver_id: userData.id, status: 'pending' },
              { onConflict: 'sender_id,receiver_id' }
            );
        }

        // Only send push notification if invite is visible (friend)
        if (isFriend && inviteData) {
          try {
            await supabase.functions.invoke('send-collaboration-invite', {
              body: {
                inviterId: user.id,
                invitedUserId: userData.id,
                invitedUserEmail: userData.email || '',
                sessionId: sessionData!.id,
                sessionName: resolvedName,
                inviteId: inviteData.id,
              }
            });
          } catch (pushErr) {
            console.warn('[useSessionManagement] Push notification failed for', username, pushErr);
          }
        }

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
          try {
            await createPendingSessionInvite(sessionId, authUser.id, p.phoneE164)
          } catch (inviteErr) {
            console.error('[useSessionManagement] Phone invite failed (non-fatal):', inviteErr)
          }
        }
      }

      // ORCH-0446: Seeding is handled by createCollaborativeSession via
      // upsert_participant_prefs RPC. The `preferences` parameter is kept in the
      // signature for API compat with OnboardingCollaborationStep but is ignored.
      // All writes to participant_prefs go through atomic RPCs.
      // and useBoardSession.updatePreferences. Do not add a third.

      return sessionId
    },
    [createCollaborativeSession]
  );

  // Accept specific invite (from notification)
  // ORCH-0443: Delegate to the single acceptance service.
  // Preserves the hook's public API so callers (OnboardingCollaborationStep) don't break.
  const acceptInvite = useCallback(async (inviteId: string) => {
    if (!user) {
      console.error('❌ No user found for invite acceptance');
      return;
    }
    try {
      const { acceptCollaborationInvite } = await import('../services/collaborationInviteService');
      const result = await acceptCollaborationInvite({ userId: user.id, inviteId });
      if (!result.success) throw new Error(result.error || 'Failed to accept invite');
    } catch (error) {
      console.error('❌ Error accepting invite:', error);
    } finally {
      setSessionState(prevState => ({
        ...prevState,
        pendingInvites: prevState.pendingInvites.filter(i => i.id !== inviteId)
      }));
      await loadUserSessions();
    }
  }, [user, loadUserSessions]);

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
        .eq('invited_user_id', user.id);

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
    let session = sessionStateRef.current.availableSessions.find(s => s.id === sessionId);

    if (!session) {
      await loadUserSessions();
      // H9 FIX: Read from ref AFTER reload — the closure-captured state is stale,
      // but the ref always holds the latest value set by setSessionState.
      session = sessionStateRef.current.availableSessions.find(s => s.id === sessionId);
    }

    if (!session || !user) {
      console.error('❌ Session not found or no user:', {
        sessionId,
        session: session ? 'found' : 'not found',
        user: user?.id,
        availableSessions: sessionStateRef.current.availableSessions.map(s => s.id)
      });
      return;
    }


    try {
      // For active sessions, just switch to them
      if (session.status === 'active') {
        setSessionState(prev => ({
          ...prev,
          currentSession: session!,
          isInSolo: false,
        }));
      }

    } catch (error) {
      console.error('❌ Error in switchToCollaborative:', error);
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
        // ORCH-0446 R6.4: Remove leaver's prefs from session JSONB (atomic)
        try {
          await supabase.rpc('remove_participant_prefs', {
            p_session_id: sessionId,
            p_user_id: user.id,
          });
        } catch { /* Non-blocking cleanup */ }

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
          .eq('invited_user_id', user.id);

        // ORCH-0446 R6.4: Remove leaver's prefs from session JSONB
        try {
          await supabase.rpc('remove_participant_prefs', {
            p_session_id: sessionId,
            p_user_id: user.id,
          });
        } catch { /* Non-blocking cleanup */ }

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
  // Load sessions on mount and when user changes.
  // Realtime updates are handled by the parent (index.tsx) which calls
  // refreshAllSessions() on any collaboration table change. That function
  // updates boardsSessions state, which is the single source of truth for pills.
  // Components that need fresh data (CollaborationModule, onboarding) call
  // loadUserSessions() directly when they open.
  useEffect(() => {
    if (!user) return;
    loadUserSessions();
  }, [user, loadUserSessions]);

  // Realtime: refetch sessions when invites or participations change for this user.
  // Covers: session deleted (cascade deletes invite), invite accepted/declined externally, etc.
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`session_pills:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collaboration_invites',
          filter: `invited_user_id=eq.${user.id}`,
        },
        () => { loadUserSessions(); }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_participants',
          filter: `user_id=eq.${user.id}`,
        },
        () => { loadUserSessions(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, loadUserSessions]);

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
