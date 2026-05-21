import { BoardCardService } from '../../services/boardCardService';
import { mixpanelService } from '../../services/mixpanelService';
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
 *   - cardData: null (no need to populate; left-swipes never promote to
 *     board_saved_cards; the card_data column is only read by the
 *     check_mutual_like trigger which short-circuits for left-swipes)
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
    // Empty object — RecordSwipeAndCheckMatchParams typed Record<string, unknown>;
    // the check_mutual_like trigger short-circuits on swipe_state != 'swiped_right'
    // so card_data is never read for left swipes regardless.
    cardData: {},
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
