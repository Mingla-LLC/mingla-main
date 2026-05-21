import { BoardCardService } from '../../services/boardCardService';
import { mixpanelService } from '../../services/mixpanelService';
import { buildCardDataPayload } from './collabSaveCard';
import type { Recommendation } from '../../types/recommendation';

/**
 * ORCH-0902 CR-6 (visible-but-not-binding dismissal): Records a collab left-swipe
 * on board_user_swipe_states via the existing rpc_record_swipe_and_check_match
 * RPC. The trigger check_mutual_like only fires for swiped_right rows, so the
 * left-swipe insert is silently persisted and used by useSessionDismissedCards
 * to render attribution ("Sarah passed on this") in every participant's
 * DismissedCardsSheet.
 *
 * Soft-fail semantics: if the RPC fails, the card is still locally dismissed
 * (the caller updates dismissedCards in context immediately). On next session
 * load the server state will be re-read; we log a warning but never block UX
 * on a transient persistence error.
 *
 * Differences vs. collabSaveCard (right-swipe path):
 *   - swipeDirection: 'left'
 *   - cardData: full payload via buildCardDataPayload (same shape as
 *     right-swipes). check_mutual_like short-circuits for left-swipes so
 *     this payload is never read by the trigger, but useSessionDismissedCards
 *     reads it to render attribution rows for cards OTHER participants
 *     passed on — including cards the current user hasn't seen yet, which
 *     have no local Recommendation to fall back on. ORCH-0902 CR-6.
 *   - No provisional toast (UX: dismissal is silent)
 *   - No match notification path
 *   - No "It's a match!" upgrade
 */
export interface CollabRecordLeftSwipeParams {
  card: Recommendation;
  sessionId: string;
  userId: string;
}

export interface CollabRecordLeftSwipeResult {
  recorded: boolean;
  error?: Error;
}

export async function collabRecordLeftSwipe({
  card,
  sessionId,
  userId,
}: CollabRecordLeftSwipeParams): Promise<CollabRecordLeftSwipeResult> {
  const result = await BoardCardService.recordSwipeAndCheckMatch({
    sessionId,
    experienceId: card.id,
    userId,
    // ORCH-0902 CR-6: full card payload, same shape as collabSaveCard.
    // Trigger short-circuits for left-swipes (never written to
    // board_saved_cards), but useSessionDismissedCards reads this back to
    // render the visible-but-not-binding dismissed sheet — including cards
    // the current viewer has not yet seen in their own deck.
    cardData: buildCardDataPayload(card),
    swipeDirection: 'left',
  });

  if (result.error) {
    console.warn('[collabRecordLeftSwipe] RPC failed (soft-fail):', result.error);
    try {
      mixpanelService.track('Collab Left Swipe RPC Error', {
        session_id: sessionId,
        experience_id: card.id,
        error_message: result.error.message,
      });
    } catch (telErr) {
      console.warn('[collabRecordLeftSwipe] telemetry failed:', telErr);
    }
    return { recorded: false, error: result.error };
  }

  try {
    mixpanelService.track('Collab Left Swipe Recorded', {
      session_id: sessionId,
      experience_id: card.id,
    });
  } catch (telErr) {
    console.warn('[collabRecordLeftSwipe] telemetry failed:', telErr);
  }

  return { recorded: true };
}
