import { BoardCardService } from '../../services/boardCardService';
import { notifyMatch } from '../../services/boardNotificationService';
import { inAppNotificationService } from '../../services/inAppNotificationService';
import { toastManager } from '../ui/Toast';
import type { Recommendation } from '../../types/recommendation';

export interface CollabSaveCardParams {
  card: Recommendation;
  sessionId: string;
  userId: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

export interface CollabSaveCardResult {
  tracked: boolean;
  matched: boolean;
  matchedUserIds?: string[];
  savedCardId?: string;
  cardTitle?: string;
  error?: Error;
}

/**
 * ORCH-0532: THE ONLY path client-side collab right-swipe/save logic should take.
 *
 * Writes to `board_user_swipe_states` via `trackSwipeState`. The
 * `check_mutual_like` trigger (SECURITY DEFINER, enforced by RLS policy
 * `bsc_insert_trigger_or_service_only`) decides whether to promote to
 * `board_saved_cards` based on ≥2-participant quorum.
 *
 * DO NOT call `BoardCardService.saveCardToBoard` from this helper or anywhere
 * else in user-auth context. Direct INSERTs into `board_saved_cards` are
 * rejected by RLS policy (migration 20260420000006), AND they would bypass
 * quorum logic even if RLS were weaker.
 *
 * Toast semantics (Q1 Option B):
 *   - On successful swipe-right: show "Liked — waiting for others" (2s, info)
 *   - If checkForMatch returns matched: true: replace with "It's a match!"
 *     (4s, success) + fire notifyMatch + local in-app notification
 *   - On trackSwipeState error: show "Couldn't save — tap to retry" (3s, error)
 *
 * All toast calls are wrapped in try/catch — toast system unavailability
 * must never propagate and block the save flow.
 */
export async function collabSaveCard({
  card,
  sessionId,
  userId,
  t,
}: CollabSaveCardParams): Promise<CollabSaveCardResult> {
  // 1. Provisional toast — fire-and-forget, must not throw.
  try {
    toastManager.show(
      t('swipeable.liked_waiting', { defaultValue: 'Liked — waiting for others' }),
      'info',
      2000
    );
  } catch (toastErr) {
    // Toast system unavailable — non-fatal. Log and continue.
    console.warn('[collabSaveCard] toast show failed (provisional):', toastErr);
  }

  // 2. Write swipe-state row — the ONE authoritative client write for collab.
  //    trackSwipeState catches internally and returns { data, error }.
  const { error: trackErr } = await BoardCardService.trackSwipeState({
    sessionId,
    experienceId: card.id,
    userId,
    swipeDirection: 'right',
  });

  if (trackErr) {
    console.error('[collabSaveCard] trackSwipeState failed:', trackErr);
    try {
      toastManager.show(
        t('swipeable.save_failed', { defaultValue: "Couldn't save — tap to retry" }),
        'error',
        3000
      );
    } catch (toastErr) {
      console.warn('[collabSaveCard] toast show failed (error path):', toastErr);
    }
    return { tracked: false, matched: false, error: trackErr as Error };
  }

  // 3. Check if the trigger promoted to a match (quorum reached).
  const matchResult = await BoardCardService.checkForMatch(sessionId, card.id);

  if (matchResult.matched && matchResult.savedCardId && matchResult.matchedUserIds) {
    const cardTitle = matchResult.cardTitle || card.title || 'a spot';

    // Fire match push/analytics — fire-and-forget, must not block toast.
    notifyMatch({
      sessionId,
      savedCardId: matchResult.savedCardId,
      experienceId: card.id,
      cardTitle,
      matchedUserIds: matchResult.matchedUserIds,
    });

    // Local in-app notification for the current user.
    inAppNotificationService.add(
      'board_card_matched',
      t('swipeable.match_title', { defaultValue: "It's a match!" }),
      t('swipeable.match_body', {
        defaultValue: `You and others liked ${cardTitle}`,
        cardTitle,
      }),
      { page: 'home', sessionId }
    );

    // Upgrade the provisional toast to the match toast.
    try {
      toastManager.show(
        t('swipeable.match_toast', {
          defaultValue: `It's a match! 🎉 ${cardTitle}`,
          cardTitle,
        }),
        'success',
        4000
      );
    } catch (toastErr) {
      console.warn('[collabSaveCard] toast show failed (match):', toastErr);
    }
  }

  return {
    tracked: true,
    matched: !!matchResult.matched,
    matchedUserIds: matchResult.matchedUserIds,
    savedCardId: matchResult.savedCardId,
    cardTitle: matchResult.cardTitle,
  };
}
