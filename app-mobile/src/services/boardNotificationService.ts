/**
 * boardNotificationService — Sends in-app + push notifications for board
 * activity events (card saved, voted, RSVP, member joined/left).
 *
 * All calls are fire-and-forget (non-blocking) to avoid slowing down
 * the primary user action. Failures are logged but never thrown.
 *
 * Routes through notify-dispatch via the notify-message edge function,
 * which handles: DB row insert, preference checks, quiet hours,
 * rate limiting, idempotency, and OneSignal push delivery.
 */
import { supabase } from './supabase';
import { withTimeout } from '../utils/withTimeout';

// ── Types ─────────────────────────────────────────────────────────────────

interface BoardActivityPayload {
  sessionId: string;
  sessionName: string;
  userId: string;        // The user who performed the action
  userName: string;       // Display name of the acting user
  savedCardId?: string;
  cardName?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Get all session participants except the acting user. */
async function getOtherParticipants(
  sessionId: string,
  excludeUserId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('session_participants')
    .select('user_id')
    .eq('session_id', sessionId)
    .neq('user_id', excludeUserId);

  if (error || !data) return [];
  return data.map((p) => p.user_id);
}

/** Fire a notification to multiple users via notify-dispatch. Non-blocking. */
function notifyUsers(
  recipientIds: string[],
  payload: {
    type: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
    actorId: string;
    relatedId: string;
    relatedType: string;
    idempotencyPrefix: string;
    sessionId: string;
  }
): void {
  const fiveBucket = Math.floor(Date.now() / (5 * 60 * 1000));

  for (const recipientId of recipientIds) {
    withTimeout(
      supabase.functions.invoke('notify-dispatch', {
        body: {
          userId: recipientId,
          type: payload.type,
          title: payload.title,
          body: payload.body,
          data: payload.data,
          actorId: payload.actorId,
          relatedId: payload.relatedId,
          relatedType: payload.relatedType,
          idempotencyKey: `${payload.idempotencyPrefix}:${fiveBucket}:${recipientId}`,
          pushOverrides: {
            androidChannelId: 'collaboration',
            collapseId: `board:${payload.sessionId}`,
          },
        },
      }),
      5000,
      'boardNotification'
    ).catch((err) =>
      console.warn(`[boardNotificationService] ${payload.type} notification error:`, err)
    );
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Notify other session participants that a card was saved to the board.
 * Called after a successful board_saved_cards insert.
 */
export function notifyCardSaved(payload: BoardActivityPayload): void {
  const { sessionId, sessionName, userId, userName, savedCardId, cardName } = payload;
  if (!sessionId || !userId) return;

  getOtherParticipants(sessionId, userId).then((recipients) => {
    if (recipients.length === 0) return;
    notifyUsers(recipients, {
      type: 'board_card_saved',
      title: `${userName} saved a spot`,
      body: cardName
        ? `"${cardName}" was added to ${sessionName}`
        : `New experience added to ${sessionName}`,
      data: {
        deepLink: `mingla://session/${sessionId}`,
        sessionId,
        savedCardId: savedCardId || '',
        senderName: userName,
      },
      actorId: userId,
      relatedId: savedCardId || sessionId,
      relatedType: 'board_saved_card',
      idempotencyPrefix: `board_card_saved:${savedCardId || sessionId}`,
      sessionId,
    });
  });
}

/**
 * Notify the card saver that someone voted on their card.
 * Called after a successful board_votes upsert (not on vote removal).
 */
export function notifyCardVoted(
  payload: BoardActivityPayload & { cardSaverId: string; voteType: 'up' | 'down' }
): void {
  const { sessionId, sessionName, userId, userName, savedCardId, cardName, cardSaverId, voteType } = payload;
  if (!sessionId || !userId || !cardSaverId || cardSaverId === userId) return;

  const emoji = voteType === 'up' ? '👍' : '👎';
  notifyUsers([cardSaverId], {
    type: 'board_card_voted',
    title: `${userName} voted ${emoji}`,
    body: cardName
      ? `on "${cardName}" in ${sessionName}`
      : `on a card in ${sessionName}`,
    data: {
      deepLink: `mingla://session/${sessionId}`,
      sessionId,
      savedCardId: savedCardId || '',
      senderName: userName,
    },
    actorId: userId,
    relatedId: savedCardId || sessionId,
    relatedType: 'board_vote',
    idempotencyPrefix: `board_card_voted:${savedCardId}:${userId}`,
    sessionId,
  });
}

/**
 * Notify the card saver that someone RSVP'd to their card.
 * Called after a successful board_card_rsvps upsert (attending only).
 */
export function notifyCardRsvp(
  payload: BoardActivityPayload & { cardSaverId: string }
): void {
  const { sessionId, sessionName, userId, userName, savedCardId, cardName, cardSaverId } = payload;
  if (!sessionId || !userId || !cardSaverId || cardSaverId === userId) return;

  notifyUsers([cardSaverId], {
    type: 'board_card_rsvp',
    title: `${userName} is in!`,
    body: cardName
      ? `RSVP'd to "${cardName}" in ${sessionName}`
      : `RSVP'd to an experience in ${sessionName}`,
    data: {
      deepLink: `mingla://session/${sessionId}`,
      sessionId,
      savedCardId: savedCardId || '',
      senderName: userName,
    },
    actorId: userId,
    relatedId: savedCardId || sessionId,
    relatedType: 'board_card_rsvp',
    idempotencyPrefix: `board_card_rsvp:${savedCardId}:${userId}`,
    sessionId,
  });
}

/**
 * Notify other session participants that a new member joined.
 * Called after successful invite acceptance (participant added).
 */
export function notifyMemberJoined(
  payload: Omit<BoardActivityPayload, 'savedCardId' | 'cardName'>
): void {
  const { sessionId, sessionName, userId, userName } = payload;
  if (!sessionId || !userId) return;

  getOtherParticipants(sessionId, userId).then((recipients) => {
    if (recipients.length === 0) return;
    notifyUsers(recipients, {
      type: 'session_member_joined',
      title: `${userName} joined the crew`,
      body: `${sessionName} just got better — start planning together!`,
      data: {
        deepLink: `mingla://session/${sessionId}`,
        sessionId,
        senderName: userName,
      },
      actorId: userId,
      relatedId: sessionId,
      relatedType: 'session',
      idempotencyPrefix: `session_member_joined:${sessionId}:${userId}`,
      sessionId,
    });
  });
}

/**
 * Notify other session participants that a member left.
 * Called after successful session leave.
 */
export function notifyMemberLeft(
  payload: Omit<BoardActivityPayload, 'savedCardId' | 'cardName'>
): void {
  const { sessionId, sessionName, userId, userName } = payload;
  if (!sessionId || !userId) return;

  getOtherParticipants(sessionId, userId).then((recipients) => {
    if (recipients.length === 0) return;
    notifyUsers(recipients, {
      type: 'session_member_left',
      title: `${userName} left ${sessionName}`,
      body: 'The session is still going — keep planning!',
      data: {
        deepLink: `mingla://session/${sessionId}`,
        sessionId,
        senderName: userName,
      },
      actorId: userId,
      relatedId: sessionId,
      relatedType: 'session',
      idempotencyPrefix: `session_member_left:${sessionId}:${userId}`,
      sessionId,
    });
  });
}
