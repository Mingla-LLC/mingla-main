/**
 * addToBoardToasts — ORCH-0666.
 *
 * Aggregates per-session outcomes from `addFriendsToSessions` into one or two
 * truth-grounded user-facing toasts. Constitution #2 single-owner: this is the
 * only file that maps `AddFriendsToSessionsReturn` to UX surfaces.
 *
 * Uses the global `toastManager` singleton from `components/ui/Toast` rather
 * than threading `setNotifications` through props. Justification: toastManager
 * is the simpler, established success/info/warning channel; doesn't require
 * touching ConnectionsPage props or AppHandlers state plumbing; matches sibling
 * "Added to Board!" UX from the prior fake handler in spirit.
 */
import i18n from '../i18n';
import { toastManager } from '../components/ui/Toast';
import type { AddFriendsToSessionsReturn } from '../services/sessionMembershipService';

interface FriendInfo {
  id: string;
  name: string;
}

interface SessionInfo {
  id: string;
  name: string;
}

const TOAST_DURATION_MS = 4000;

export function emitAddToBoardToasts(
  result: AddFriendsToSessionsReturn,
  friend: FriendInfo,
  sessions: SessionInfo[]
): void {
  // Aggregate counts per outcome
  const counts = {
    invited: 0,
    already_invited: 0,
    already_member: 0,
    blocked: 0,
    session_invalid: 0,
    other_error: 0,
  };
  const blockedSessions: string[] = [];
  const invalidSessions: string[] = [];
  const invitedSessions: string[] = [];
  const alreadyInvitedSessions: string[] = [];
  const alreadyMemberSessions: string[] = [];

  const sessionName = (sessionId: string): string =>
    sessions.find((s) => s.id === sessionId)?.name ?? 'Session';

  for (const r of result.results) {
    if (r.outcome in counts) {
      counts[r.outcome as keyof typeof counts]++;
    } else {
      counts.other_error++;
    }
    if (r.outcome === 'invited') invitedSessions.push(sessionName(r.sessionId));
    else if (r.outcome === 'already_invited') alreadyInvitedSessions.push(sessionName(r.sessionId));
    else if (r.outcome === 'already_member') alreadyMemberSessions.push(sessionName(r.sessionId));
    else if (r.outcome === 'blocked') blockedSessions.push(sessionName(r.sessionId));
    else if (r.outcome === 'session_invalid') invalidSessions.push(sessionName(r.sessionId));
  }
  for (const _e of result.errors) counts.other_error++;

  const total = result.results.length + result.errors.length;
  const N = result.results.length;

  // ── Primary toast — picks the dominant message based on result mix ───────
  if (counts.invited === N && N > 0) {
    // All invited
    if (N === 1) {
      toastManager.success(
        i18n.t('common:toast_invite_sent_single', {
          name: friend.name,
          sessionName: invitedSessions[0],
        }),
        TOAST_DURATION_MS
      );
    } else {
      toastManager.success(
        i18n.t('common:toast_invite_sent_multi', {
          name: friend.name,
          count: N,
        }),
        TOAST_DURATION_MS
      );
    }
  } else if (counts.invited > 0 && counts.already_invited > 0 && counts.already_member === 0) {
    // Mix of invited + already_invited
    toastManager.info(
      i18n.t('common:toast_invite_already_invited_multi', {
        name: friend.name,
        newCount: counts.invited,
        existingCount: counts.already_invited,
      }),
      TOAST_DURATION_MS
    );
  } else if (counts.invited > 0 && counts.already_member > 0) {
    // Mix of invited + already_member
    toastManager.info(
      i18n.t('common:toast_invite_sent_multi', {
        name: friend.name,
        count: counts.invited,
      }) +
        ' ' +
        i18n.t('common:toast_invite_already_member_multi', {
          name: friend.name,
          count: counts.already_member,
        }),
      TOAST_DURATION_MS
    );
  } else if (counts.already_member === N && N > 0) {
    // All already members
    if (N === 1) {
      toastManager.info(
        i18n.t('common:toast_invite_already_member_single', {
          name: friend.name,
          sessionName: alreadyMemberSessions[0],
        }),
        TOAST_DURATION_MS
      );
    } else {
      toastManager.info(
        i18n.t('common:toast_invite_already_member_multi', {
          name: friend.name,
          count: N,
        }),
        TOAST_DURATION_MS
      );
    }
  } else if (counts.already_invited === N && N > 0) {
    // All already invited
    if (N === 1) {
      toastManager.info(
        i18n.t('common:toast_invite_already_invited_single', {
          name: friend.name,
          sessionName: alreadyInvitedSessions[0],
        }),
        TOAST_DURATION_MS
      );
    } else {
      toastManager.info(
        i18n.t('common:toast_invite_already_invited_multi', {
          name: friend.name,
          newCount: 0,
          existingCount: N,
        }),
        TOAST_DURATION_MS
      );
    }
  } else if (total > 0 && N === 0) {
    // All errors at the loop layer
    toastManager.error(i18n.t('common:toast_invite_error'), TOAST_DURATION_MS);
  }

  // ── Secondary toasts — for non-dominant outcomes that need surface ──────
  if (counts.blocked > 0) {
    toastManager.warning(
      i18n.t('common:toast_invite_blocked', { name: friend.name }),
      TOAST_DURATION_MS
    );
  }
  if (counts.session_invalid > 0) {
    // Use first invalid session name for single-target message; if multiple,
    // omit name (rare edge case — spec accepts).
    toastManager.warning(
      i18n.t('common:toast_invite_session_invalid', {
        sessionName:
          invalidSessions.length === 1 ? invalidSessions[0] : i18n.t('common:unknown'),
      }),
      TOAST_DURATION_MS
    );
  }
}
