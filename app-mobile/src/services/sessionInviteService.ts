/**
 * sessionInviteService — hybrid phone invite for collaboration sessions (ORCH-0520).
 *
 * Contract:
 *   1. Normalize phone → E.164 (caller responsibility — uses PhoneInput).
 *   2. Call lookupPhone(phoneE164).
 *   3a. If found (phone belongs to an existing Mingla user):
 *       - Idempotent INSERT into session_participants (user_id = invitee, has_accepted=false).
 *         notifications_muted is NOT set — DB DEFAULT false applies (ORCH-0520
 *         invariant I-SESSION-MUTE-DEFAULT-UNMUTED).
 *       - INSERT into collaboration_invites (status='pending').
 *       - Invoke send-collaboration-invite edge function with invitee's email.
 *         Its failure is NON-FATAL — the invite row exists, recipient can still
 *         accept via in-app UI. We log but return success.
 *   3b. If not found (cold invite):
 *       - createPendingSessionInvite → writes pending_session_invites row.
 *       - Invoke send-phone-invite edge function (Twilio SMS).
 *         SMS failure IS FATAL — without SMS, the recipient has no way to
 *         discover the invite.
 *
 * Idempotency: duplicate participant rows are skipped via the existingParticipant
 * check. Duplicate collaboration_invites rows are gracefully tolerated — a
 * pending invite already exists, fall through to notification.
 *
 * Error surfacing: every failure path returns `{kind: 'error', message}`. Caller
 * (BoardSettingsDropdown) surfaces via Alert. No silent failures.
 */
import { lookupPhone, createPendingSessionInvite } from './phoneLookupService';
import { sendPhoneInvite } from './phoneInviteService';
import { addFriendsToSessions } from './sessionMembershipService';

export type InviteByPhoneOutcome =
  | { kind: 'warm'; userId: string; displayName: string | null }
  | { kind: 'cold'; phoneE164: string }
  | { kind: 'error'; message: string };

export async function inviteByPhone(
  sessionId: string,
  inviterUserId: string,
  sessionName: string,
  phoneE164: string
): Promise<InviteByPhoneOutcome> {
  if (!sessionId || !inviterUserId || !phoneE164) {
    return { kind: 'error', message: 'Missing invite details' };
  }

  try {
    const lookupResult = await lookupPhone(phoneE164);

    // ── WARM PATH — existing Mingla user ──────────────────────────────────
    // ORCH-0666: refactored to delegate to addFriendsToSessions. The atomic
    // RPC handles participant pre-insert + invite insert + push edge fn in one
    // transactional call. Constitution #2 single-owner.
    if (lookupResult.found && lookupResult.user) {
      const invitedUserId = lookupResult.user.id;

      // Prevent self-invite (RPC also enforces, but fail fast for UX clarity)
      if (invitedUserId === inviterUserId) {
        return { kind: 'error', message: 'You cannot invite yourself' };
      }

      const { results, errors } = await addFriendsToSessions({
        sessionIds: [sessionId],
        friendUserId: invitedUserId,
        sessionNames: { [sessionId]: sessionName },
      });

      if (errors.length > 0) {
        return { kind: 'error', message: errors[0].message };
      }

      const result = results[0];

      const displayName =
        lookupResult.user.display_name ||
        [lookupResult.user.first_name, lookupResult.user.last_name]
          .filter(Boolean)
          .join(' ') ||
        lookupResult.user.username ||
        null;

      switch (result?.outcome) {
        case 'invited':
        case 'already_invited':
          // Both surface as warm — pending invite is on its way.
          return { kind: 'warm', userId: invitedUserId, displayName };
        case 'already_member':
          return { kind: 'error', message: 'This user is already in the session' };
        case 'blocked':
          return { kind: 'error', message: 'Cannot invite this user.' };
        case 'session_invalid':
          return { kind: 'error', message: 'This session is no longer available.' };
        case 'not_session_member':
          return { kind: 'error', message: 'You are no longer a member of this session.' };
        case 'session_creator_self_invite':
          return { kind: 'error', message: 'You cannot invite yourself' };
        default:
          return { kind: 'error', message: 'Could not send invite.' };
      }
    }

    // ── COLD PATH — phone does not belong to any Mingla user ──────────────
    await createPendingSessionInvite(sessionId, inviterUserId, phoneE164);

    try {
      await sendPhoneInvite(phoneE164);
    } catch (smsErr) {
      const message =
        smsErr instanceof Error
          ? smsErr.message
          : 'SMS invite failed — please try again';
      return { kind: 'error', message };
    }

    return { kind: 'cold', phoneE164 };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send invite';
    return { kind: 'error', message };
  }
}
