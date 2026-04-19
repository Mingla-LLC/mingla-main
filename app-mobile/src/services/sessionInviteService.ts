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
import { supabase } from './supabase';
import { lookupPhone, createPendingSessionInvite } from './phoneLookupService';
import { sendPhoneInvite } from './phoneInviteService';

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
    if (lookupResult.found && lookupResult.user) {
      const invitedUserId = lookupResult.user.id;

      // Prevent self-invite
      if (invitedUserId === inviterUserId) {
        return { kind: 'error', message: 'You cannot invite yourself' };
      }

      // Idempotent participant pre-insert — check if already present
      const { data: existingParticipant } = await supabase
        .from('session_participants')
        .select('user_id, has_accepted')
        .eq('session_id', sessionId)
        .eq('user_id', invitedUserId)
        .maybeSingle();

      if (existingParticipant) {
        if (existingParticipant.has_accepted) {
          return { kind: 'error', message: 'This user is already in the session' };
        }
        // Has a pending participant row already — fall through to invite creation
      } else {
        const { error: partErr } = await supabase
          .from('session_participants')
          .insert({
            session_id: sessionId,
            user_id: invitedUserId,
            has_accepted: false,
          });
        if (partErr) {
          return {
            kind: 'error',
            message: partErr.message || 'Failed to add participant',
          };
        }
      }

      // Create pending invite row (may fail on duplicate UNIQUE — tolerate)
      const { data: inviteData, error: inviteErr } = await supabase
        .from('collaboration_invites')
        .insert({
          session_id: sessionId,
          inviter_id: inviterUserId,
          invited_user_id: invitedUserId,
          status: 'pending',
        })
        .select('id')
        .single();

      if (inviteErr) {
        // 23505 = unique_violation — invite already exists, proceed to notify
        const code = (inviteErr as { code?: string }).code;
        if (code !== '23505') {
          return {
            kind: 'error',
            message: inviteErr.message || 'Failed to create invite',
          };
        }
      }

      // Fetch invitee email for notification
      const { data: profile } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', invitedUserId)
        .maybeSingle();

      if (profile?.email && inviteData) {
        try {
          await supabase.functions.invoke('send-collaboration-invite', {
            body: {
              inviterId: inviterUserId,
              invitedUserId,
              invitedUserEmail: profile.email,
              sessionId,
              sessionName,
              inviteId: inviteData.id,
            },
          });
        } catch (notifErr) {
          // Non-fatal — the invite row exists; recipient can accept via UI.
          console.warn(
            '[sessionInviteService] notification send failed (non-fatal):',
            notifErr
          );
        }
      }

      const displayName =
        lookupResult.user.display_name ||
        [lookupResult.user.first_name, lookupResult.user.last_name]
          .filter(Boolean)
          .join(' ') ||
        lookupResult.user.username ||
        null;

      return { kind: 'warm', userId: invitedUserId, displayName };
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
