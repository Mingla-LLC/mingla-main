/**
 * sessionMembershipService — ORCH-0666.
 *
 * Single source of truth for "add a known friend to one or more existing collab
 * sessions." Replaces:
 *   - The dead-tap path at FriendsManagementList → ConnectionsPage → onSendCollabInvite.
 *   - The toast-only fake at AppHandlers.handleAddToBoard.
 *   - The setTimeout placeholder at AddToBoardModal.handleAddToBoard.
 *   - The zombie BoardInviteService.sendFriendInvites (deleted in this PR).
 *
 * Calls atomic SECURITY DEFINER RPC `add_friend_to_session` per session, then
 * fires push via the existing `send-collaboration-invite` edge function. The
 * RPC handles all guards (auth, session-membership, block-check, status-check,
 * idempotency). The service ONLY sequences sessions, translates outcomes, and
 * fires telemetry.
 *
 * Constitution invariants enforced:
 *   - #1 no dead taps: every outcome maps to user-visible UX.
 *   - #2 single owner: this is THE service for session-invite-from-friends-list.
 *     InlineInviteFriendsList + sessionInviteService.inviteByPhone (warm path)
 *     delegate here.
 *   - #3 no silent failures: errors propagate via the {errors} array; caller
 *     surfaces them.
 *   - #9 no fabricated data: success outcomes match real RPC return values.
 *
 * Future invariant established by this file:
 *   - I-INVITE-CREATION-IS-RPC-ONLY — direct INSERTs into collaboration_invites
 *     from mobile code are prohibited going forward. CI gate grep enforced.
 */
import { supabase } from './supabase';
import { mixpanelService } from './mixpanelService';
import { logAppsFlyerEvent } from './appsFlyerService';

export type AddFriendOutcome =
  | 'invited'
  | 'already_invited'
  | 'already_member'
  | 'blocked'
  | 'session_invalid'
  | 'not_session_member'
  | 'session_creator_self_invite';

export interface AddFriendResult {
  sessionId: string;
  outcome: AddFriendOutcome;
  inviteId?: string;
  createdAt?: string;
  errorCode?: string;
}

export interface AddFriendError {
  sessionId: string;
  message: string;
  errorCode?: string;
}

export interface AddFriendsToSessionsParams {
  sessionIds: string[];
  friendUserId: string;
  /** Optional context for telemetry only; not persisted. */
  sessionNames?: Record<string, string>;
}

export interface AddFriendsToSessionsReturn {
  results: AddFriendResult[];
  errors: AddFriendError[];
}

/**
 * Adds the given friend to each session via atomic RPC.
 * Sequential (not parallel) to ensure predictable ordering, RLS-friendliness,
 * and easy partial-failure UX. N invites = N round-trips, but N is small (1-5
 * typical) and the RPC is fast (<50ms p95).
 *
 * @returns aggregate outcomes — caller renders UX from this shape.
 */
export async function addFriendsToSessions(
  params: AddFriendsToSessionsParams
): Promise<AddFriendsToSessionsReturn> {
  const { sessionIds, friendUserId, sessionNames } = params;

  if (sessionIds.length === 0) {
    return { results: [], errors: [] };
  }

  const results: AddFriendResult[] = [];
  const errors: AddFriendError[] = [];

  // Resolve current user once for telemetry payload
  const { data: { user } } = await supabase.auth.getUser();
  const inviterId = user?.id;

  // Resolve invitee email once for the push edge function
  const { data: inviteeProfile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', friendUserId)
    .maybeSingle();

  for (const sessionId of sessionIds) {
    try {
      const { data, error } = await supabase.rpc('add_friend_to_session', {
        p_session_id: sessionId,
        p_friend_user_id: friendUserId,
      });

      if (error) {
        console.error('[sessionMembershipService] RPC error', { sessionId, error });
        errors.push({
          sessionId,
          message: error.message ?? 'RPC failed',
          errorCode: 'rpc_error',
        });
        continue;
      }

      const result = data as {
        outcome: AddFriendOutcome;
        invite_id?: string;
        created_at?: string;
        error_code?: string;
      };

      results.push({
        sessionId,
        outcome: result.outcome,
        inviteId: result.invite_id,
        createdAt: result.created_at,
        errorCode: result.error_code,
      });

      // Fire push only on fresh `invited` outcome (NOT on `already_invited` —
      // we already pushed the first time and don't want to spam the friend).
      if (result.outcome === 'invited' && result.invite_id && inviterId && inviteeProfile?.email) {
        const sessionName = sessionNames?.[sessionId] ?? 'Session';
        try {
          await supabase.functions.invoke('send-collaboration-invite', {
            body: {
              inviterId,
              invitedUserId: friendUserId,
              invitedUserEmail: inviteeProfile.email,
              sessionId,
              sessionName,
              inviteId: result.invite_id,
            },
          });
        } catch (pushErr: unknown) {
          // Non-fatal — invite row exists; recipient can accept via in-app UI.
          console.warn('[sessionMembershipService] push failed (non-fatal):', {
            sessionId, pushErr,
          });
        }
      }
    } catch (loopErr: unknown) {
      const message = loopErr instanceof Error ? loopErr.message : 'Unknown error';
      console.error('[sessionMembershipService] loop error', { sessionId, loopErr });
      errors.push({ sessionId, message, errorCode: 'service_loop_error' });
    }
  }

  // Telemetry — emit ONCE per call (not per session) for ratios
  const successCount = results.filter((r) => r.outcome === 'invited').length;
  if (successCount > 0 && inviterId) {
    try {
      mixpanelService.trackCollaborationInvitesSent({
        sessionId: sessionIds.join(','), // multi-session aggregate
        sessionName: 'multi',
        invitedCount: sessionIds.length,
        successCount,
      });
      logAppsFlyerEvent('collaboration_invite_sent', {
        session_count: sessionIds.length,
        success_count: successCount,
        invitee_id: friendUserId,
      });
    } catch (telErr: unknown) {
      console.warn('[sessionMembershipService] telemetry failed (non-fatal):', telErr);
    }
  }

  return { results, errors };
}
