import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../services/supabase';
import { useAppStore } from '../store/appStore';
import { TOUR_SESSIONS } from '../data/mockTourData';
import { CollaborationSession, SessionInvite, SessionState } from '../types';
import { createPendingSessionInvite } from '../services/phoneLookupService';
import { PreferencesService } from '../services/preferencesService';
import { normalizePreferencesForSave } from '../utils/preferencesConverter';
import { getDisplayName } from '../utils/getDisplayName';

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

/**
 * Fetch the user's solo preferences and map them to the board_session_preferences
 * column shape. Used once at onboarding (session creation / invite acceptance) so
 * collaboration preferences start with at least one value per field.
 * Returns a safe default payload if solo prefs cannot be loaded.
 */
async function buildSeedFromSoloPrefs(
  userId: string,
  sessionId: string
): Promise<Record<string, unknown>> {
  const solo = await PreferencesService.getUserPreferences(userId);

  // Safe defaults if solo prefs are missing (new user edge case)
  const defaults = {
    session_id: sessionId,
    user_id: userId,
    categories: ['nature', 'casual_eats', 'drink'],
    intents: [] as string[],
    price_tiers: ['chill', 'comfy', 'bougie', 'lavish'],
    budget_min: 0,
    budget_max: 1000,
    travel_mode: 'walking',
    travel_constraint_type: 'time' as const,
    travel_constraint_value: 30,
    date_option: null as string | null,
    time_slot: null as string | null,
    exact_time: null as string | null,
    datetime_pref: null as string | null,
    use_gps_location: true,
    custom_location: null as string | null,
    location: null as string | null,
    custom_lat: null as number | null,
    custom_lng: null as number | null,
  };

  if (!solo) return defaults;

  // Map solo → board columns and normalize
  const raw = {
    ...defaults,
    categories: solo.categories?.length ? solo.categories : defaults.categories,
    intents: solo.intents ?? defaults.intents,
    budget_min: solo.budget_min ?? defaults.budget_min,
    budget_max: solo.budget_max ?? defaults.budget_max,
    travel_mode: solo.travel_mode ?? defaults.travel_mode,
    travel_constraint_type: 'time' as const,
    travel_constraint_value: solo.travel_constraint_value ?? defaults.travel_constraint_value,
    date_option: solo.date_option ?? defaults.date_option,
    time_slot: solo.time_slot ?? defaults.time_slot,
    exact_time: solo.exact_time ?? defaults.exact_time,
    datetime_pref: solo.datetime_pref ?? defaults.datetime_pref,
  };

  // Read price_tiers from solo if it exists (field was added later, may be absent on type)
  const soloAny = solo as Record<string, unknown>;
  if (Array.isArray(soloAny.price_tiers) && soloAny.price_tiers.length > 0) {
    raw.price_tiers = soloAny.price_tiers as string[];
  }
  if (typeof soloAny.use_gps_location === 'boolean') {
    raw.use_gps_location = soloAny.use_gps_location;
  }
  if (typeof soloAny.custom_location === 'string') {
    raw.custom_location = soloAny.custom_location;
  }

  // Apply normalization to eliminate conflicting date/time/location combos
  const normalized = normalizePreferencesForSave({
    date_option: raw.date_option,
    time_slot: raw.time_slot,
    exact_time: raw.exact_time,
    datetime_pref: raw.datetime_pref,
    use_gps_location: raw.use_gps_location,
    custom_location: raw.custom_location,
  });

  return {
    ...raw,
    date_option: normalized.date_option,
    time_slot: normalized.time_slot,
    exact_time: normalized.exact_time,
    datetime_pref: normalized.datetime_pref,
    use_gps_location: normalized.use_gps_location,
    custom_location: normalized.custom_location,
  };
}

export const useSessionManagement = () => {
  const tourMode = useAppStore((s) => s.tourMode);

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

      const matchingParticipations = (participations || []).filter((p: ParticipationRow) => {
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

      // Seed collaboration preferences from the creator's solo preferences
      // so there is at least one value per field from the start.
      const seedPayload = await buildSeedFromSoloPrefs(user.id, sessionData.id);
      const { error: preferencesError } = await supabase
        .from('board_session_preferences')
        .insert(seedPayload);

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
            session_id: sessionData.id,
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
            session_id: sessionData.id,
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
                sessionId: sessionData.id,
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
          try {
            await createPendingSessionInvite(sessionId, authUser.id, p.phoneE164)
          } catch (inviteErr) {
            console.error('[useSessionManagement] Phone invite failed (non-fatal):', inviteErr)
          }
        }
      }

      // Overwrite the seeded preferences with the explicit values passed in.
      // createCollaborativeSession already seeded from solo prefs; this upsert
      // applies any overrides the caller specified (e.g. from onboarding flow).
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
            name: getDisplayName(inviterProfile, 'Unknown'),
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
        .eq('invited_user_id', user.id);

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

      // Seed collaboration preferences from the accepting user's solo preferences
      // so there is at least one value per field from the start.
      const seedPayload = await buildSeedFromSoloPrefs(user.id, invite.sessionId);
      const { error: preferencesError } = await supabase
        .from('board_session_preferences')
        .insert(seedPayload);

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
          let createdBoardId: string | null = null;

          // Only create board if session doesn't already have one
          if (!boardId) {
            // Use current user as created_by — RLS requires auth.uid() = created_by.
            // The accepting user triggers board creation; session ownership is tracked
            // separately in collaboration_sessions.created_by.
            const { data: boardData, error: boardError } = await supabase
              .from('boards')
              .insert({
                name: sessionData.name,
                description: `Collaborative board for ${sessionData.name}`,
                created_by: user.id,
                is_public: false,
              })
              .select()
              .single();

            if (boardError) {
              console.error('❌ Error creating board:', boardError);
            } else {
              boardId = boardData.id;
              createdBoardId = boardData.id;
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

            // RELIABILITY: Re-read the session to get the ACTUAL board_id.
            // The optimistic lock (.eq('status', 'pending')) may have matched zero rows
            // if a concurrent accept already activated the session with a different board.
            // Supabase .update() returns no error for zero affected rows, so we must
            // re-read to discover the real board_id linked to this session.
            const { data: refreshedSession } = await supabase
              .from('collaboration_sessions')
              .select('board_id')
              .eq('id', invite.sessionId)
              .single();

            const actualBoardId = refreshedSession?.board_id;

            if (!actualBoardId) {
              console.error('❌ Session has no board_id after update — cannot add collaborators');
            } else {
              // Clean up orphaned board if a concurrent accept won the race
              if (createdBoardId && actualBoardId !== createdBoardId) {
                console.warn('⚠️ Concurrent accept detected — cleaning up orphaned board:', createdBoardId);
                await supabase.from('boards').delete().eq('id', createdBoardId).eq('created_by', user.id);
              }

              // Add all accepted participants as board collaborators using the ACTUAL board_id.
              // One round-trip regardless of participant count — avoids the N+1 serial-await pattern.
              const collaboratorRows = acceptedMembers.map((participant) => ({
                board_id: actualBoardId,
                user_id: participant.user_id,
                role: participant.user_id === sessionData.created_by ? 'owner' : 'collaborator',
              }));

              const { error: collaboratorError } = await supabase
                .from('board_collaborators')
                .upsert(collaboratorRows, {
                  onConflict: 'board_id,user_id',
                  ignoreDuplicates: true,
                });

              if (collaboratorError && collaboratorError.code !== '23505') {
                console.error('❌ Error adding collaborators:', collaboratorError);
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

  // Tour mode: return mock sessions, all mutations are no-ops
  if (tourMode) {
    return {
      currentSession: null,
      availableSessions: TOUR_SESSIONS as any[],
      pendingInvites: [] as any[],
      isInSolo: true,
      loading: false,
      switchToSolo: async () => {},
      switchToCollaborative: async (_sessionId: string) => {},
      createCollaborativeSession: async (_name: string, _friends: any[]) => {},
      createCollaborativeSessionV2: async (_name: string, _participants: any[]) => {},
      cancelSession: async (_sessionId: string) => {},
      acceptInvite: async (_sessionId: string) => {},
      declineInvite: async (_sessionId: string) => {},
      loadUserSessions: async () => {},
    };
  }

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
