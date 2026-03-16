/**
 * collaborationInviteService — Shared logic for accepting/declining collaboration invites.
 *
 * This service is the SINGLE source of truth for invite acceptance.
 * Both the pill-bar path (CollaborationSessions → index.tsx) and the
 * notifications path (NotificationsModal → useNotifications) call
 * these functions. Keeping one implementation prevents the two paths
 * from drifting (the original bug: the notifications path only marked
 * the invite as 'accepted' but never added the user as a participant,
 * never activated the session, and never created a board).
 */
import { supabase } from './supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AcceptInviteResult {
  success: boolean;
  sessionId: string;
  sessionName: string;
  boardId: string | null;
  error?: string;
}

/**
 * Params for acceptCollaborationInvite.
 *
 * Two entry points supply different identifiers:
 * - Pill-bar path knows the sessionId (CollaborationSessions passes it).
 * - Notifications path knows the inviteId (notification.data.inviteId).
 *
 * Exactly one of { inviteId, sessionId } must be provided.
 */
export interface AcceptInviteParams {
  userId: string;
  inviteId?: string;
  sessionId?: string;
}

// ── Accept ────────────────────────────────────────────────────────────────────

/**
 * Full collaboration invite acceptance.
 *
 * Steps (all idempotent / concurrent-safe):
 *  1. Resolve the invite row (by inviteId OR sessionId+userId)
 *  2. Mark invite status = 'accepted'
 *  3. Upsert user into session_participants with has_accepted=true
 *  4. If ≥2 participants accepted → activate session + create board
 *  5. Add accepted participants as board collaborators
 *  6. Seed the acceptor's board_session_preferences from their solo prefs
 */
export async function acceptCollaborationInvite(
  params: AcceptInviteParams
): Promise<AcceptInviteResult> {
  const { userId } = params;

  // ── Step 1: Resolve invite ──────────────────────────────────────────────

  interface InviteRow {
    id: string;
    session_id: string;
    inviter_id: string;
    invited_user_id: string;
    collaboration_sessions: { name: string } | { name: string }[];
  }

  let invite: InviteRow | null = null;

  if (params.inviteId) {
    // Notifications path — look up by invite ID
    const { data, error } = await supabase
      .from('collaboration_invites')
      .select(`
        id,
        session_id,
        inviter_id,
        invited_user_id,
        collaboration_sessions!inner(name)
      `)
      .eq('id', params.inviteId)
      .eq('invited_user_id', userId)
      .eq('status', 'pending')
      .single();

    if (error || !data) {
      return {
        success: false,
        sessionId: '',
        sessionName: '',
        boardId: null,
        error: 'Invite not found or already processed.',
      };
    }
    invite = data as unknown as InviteRow;
  } else if (params.sessionId) {
    // Pill-bar path — look up by session ID + user
    const { data, error } = await supabase
      .from('collaboration_invites')
      .select(`
        id,
        session_id,
        inviter_id,
        invited_user_id,
        collaboration_sessions!inner(name)
      `)
      .eq('session_id', params.sessionId)
      .eq('invited_user_id', userId)
      .eq('status', 'pending')
      .single();

    if (error || !data) {
      return {
        success: false,
        sessionId: params.sessionId,
        sessionName: '',
        boardId: null,
        error: 'Invite not found.',
      };
    }
    invite = data as unknown as InviteRow;
  } else {
    return {
      success: false,
      sessionId: '',
      sessionName: '',
      boardId: null,
      error: 'Either inviteId or sessionId must be provided.',
    };
  }

  // TypeScript can't narrow past the conditional assignments + early returns above,
  // but all paths that reach here have set invite to a non-null value.
  const resolvedInvite = invite!;
  const sessionId = resolvedInvite.session_id;
  const sessionData = resolvedInvite.collaboration_sessions;
  const sessionName = Array.isArray(sessionData)
    ? sessionData[0]?.name ?? 'Session'
    : sessionData?.name ?? 'Session';

  // ── Step 2: Mark invite accepted ────────────────────────────────────────

  const { error: updateError } = await supabase
    .from('collaboration_invites')
    .update({ status: 'accepted' })
    .eq('id', resolvedInvite.id)
    .eq('invited_user_id', userId);

  if (updateError) {
    return {
      success: false,
      sessionId,
      sessionName,
      boardId: null,
      error: 'Failed to accept invite.',
    };
  }

  // ── Step 3: Upsert user as accepted participant ─────────────────────────

  const { error: participantError } = await supabase
    .from('session_participants')
    .upsert(
      {
        session_id: sessionId,
        user_id: userId,
        has_accepted: true,
        joined_at: new Date().toISOString(),
      },
      { onConflict: 'session_id,user_id' }
    );

  if (participantError) {
    console.error('[collaborationInviteService] Error adding participant:', participantError);
  }

  // ── Step 4: Activate session if ≥2 accepted ─────────────────────────────

  let boardId: string | null = null;

  const { data: allParticipants, error: participantsError } = await supabase
    .from('session_participants')
    .select('has_accepted, user_id')
    .eq('session_id', sessionId);

  if (!participantsError && allParticipants) {
    const acceptedMembers = allParticipants.filter(
      (p: { has_accepted: boolean }) => p.has_accepted === true
    );

    if (acceptedMembers.length >= 2) {
      // Check if board already exists (concurrent accept protection)
      const { data: currentSession } = await supabase
        .from('collaboration_sessions')
        .select('board_id, status')
        .eq('id', sessionId)
        .single();

      boardId = currentSession?.board_id || null;

      if (currentSession?.board_id) {
        // Board already created by a concurrent accept — use it
        boardId = currentSession.board_id;
      } else {
        // Create a new board
        const { data: newBoard, error: boardError } = await supabase
          .from('boards')
          .insert({
            name: sessionName,
            description: `Collaborative board for ${sessionName}`,
            created_by: userId,
            is_public: false,
          })
          .select('id')
          .single();

        if (boardError) {
          console.error('[collaborationInviteService] Error creating board:', boardError);
        } else {
          boardId = newBoard.id;

          // Atomically set board_id only if still NULL (optimistic locking).
          // If another accept already set board_id, this UPDATE matches 0 rows.
          const { data: updateResult } = await supabase
            .from('collaboration_sessions')
            .update({
              status: 'active',
              board_id: boardId,
              updated_at: new Date().toISOString(),
            })
            .eq('id', sessionId)
            .is('board_id', null)
            .select('id');

          if (!updateResult || updateResult.length === 0) {
            // Another accept won the race — use their board, clean up ours
            const { data: existing } = await supabase
              .from('collaboration_sessions')
              .select('board_id')
              .eq('id', sessionId)
              .single();

            if (existing?.board_id && existing.board_id !== boardId) {
              await supabase.from('boards').delete().eq('id', boardId);
              boardId = existing.board_id;
            }
          }
        }
      }

      // If session is still pending and no board was created, just activate it
      if (!boardId && currentSession?.status === 'pending') {
        await supabase
          .from('collaboration_sessions')
          .update({ status: 'active', updated_at: new Date().toISOString() })
          .eq('id', sessionId)
          .eq('status', 'pending');
      }

      // ── Step 5: Add accepted participants as board collaborators ─────────

      if (boardId) {
        const { data: sessionDetails } = await supabase
          .from('collaboration_sessions')
          .select('created_by')
          .eq('id', sessionId)
          .single();

        for (const participant of acceptedMembers) {
          await supabase
            .from('board_collaborators')
            .upsert(
              {
                board_id: boardId,
                user_id: participant.user_id,
                role:
                  participant.user_id === sessionDetails?.created_by
                    ? 'owner'
                    : 'collaborator',
              },
              { onConflict: 'board_id,user_id', ignoreDuplicates: true }
            );
        }
      }
    }
  }

  // ── Step 6: Seed board_session_preferences from solo prefs ──────────────

  const { data: soloPrefs } = await supabase
    .from('preferences')
    .select(
      'categories, intents, price_tiers, budget_min, budget_max, travel_mode, travel_constraint_type, travel_constraint_value, date_option, time_slot, exact_time, datetime_pref, use_gps_location, custom_location'
    )
    .eq('profile_id', userId)
    .single();

  const { error: preferencesError } = await supabase
    .from('board_session_preferences')
    .upsert(
      {
        session_id: sessionId,
        user_id: userId,
        categories: soloPrefs?.categories ?? [],
        intents: soloPrefs?.intents ?? [],
        price_tiers: soloPrefs?.price_tiers ?? [],
        budget_min: soloPrefs?.budget_min ?? 0,
        budget_max: soloPrefs?.budget_max ?? 1000,
        travel_mode: soloPrefs?.travel_mode ?? 'walking',
        travel_constraint_type: 'time',
        travel_constraint_value: soloPrefs?.travel_constraint_value ?? 30,
        date_option: soloPrefs?.date_option ?? null,
        time_slot: soloPrefs?.time_slot ?? null,
        exact_time: soloPrefs?.exact_time ?? null,
        datetime_pref: soloPrefs?.datetime_pref ?? null,
        use_gps_location: soloPrefs?.use_gps_location ?? true,
        custom_location: soloPrefs?.custom_location ?? null,
      },
      { onConflict: 'session_id,user_id' }
    );

  if (preferencesError) {
    console.error('[collaborationInviteService] Error creating preferences:', preferencesError);
  }

  return { success: true, sessionId, sessionName, boardId };
}

// ── Decline ───────────────────────────────────────────────────────────────────

export interface DeclineInviteParams {
  userId: string;
  inviteId?: string;
  sessionId?: string;
}

/**
 * Decline a collaboration invite.
 *
 * Like accept, supports both inviteId (notifications path) and
 * sessionId (pill-bar path) entry points.
 */
export async function declineCollaborationInvite(
  params: DeclineInviteParams
): Promise<{ success: boolean; error?: string }> {
  const { userId } = params;

  // Resolve the invite row — need both inviteId and sessionId for full cleanup
  let inviteId: string | undefined;
  let sessionId: string | undefined;

  if (params.inviteId) {
    // Notifications/push path — resolve sessionId from the invite row
    const { data, error } = await supabase
      .from('collaboration_invites')
      .select('id, session_id')
      .eq('id', params.inviteId)
      .eq('invited_user_id', userId)
      .eq('status', 'pending')
      .single();

    if (error || !data) {
      return { success: false, error: 'Invite not found.' };
    }
    inviteId = data.id;
    sessionId = data.session_id;
  } else if (params.sessionId) {
    // Pill-bar path — resolve inviteId from session + user
    const { data, error } = await supabase
      .from('collaboration_invites')
      .select('id')
      .eq('session_id', params.sessionId)
      .eq('invited_user_id', userId)
      .eq('status', 'pending')
      .single();

    if (error || !data) {
      return { success: false, error: 'Invite not found.' };
    }
    inviteId = data.id;
    sessionId = params.sessionId;
  } else {
    return { success: false, error: 'Either inviteId or sessionId must be provided.' };
  }

  const { error } = await supabase
    .from('collaboration_invites')
    .update({ status: 'declined' })
    .eq('id', inviteId)
    .eq('invited_user_id', userId);

  if (error) {
    return { success: false, error: 'Failed to decline invite.' };
  }

  // Remove participant row if it exists (they may have been pre-added)
  if (sessionId) {
    await supabase
      .from('session_participants')
      .delete()
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .eq('has_accepted', false);
  }

  return { success: true };
}
