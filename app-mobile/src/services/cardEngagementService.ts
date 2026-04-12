import { supabase } from './supabase';

/**
 * ORCH-0408 Phase 3: Record card interactions to card_pool counters.
 *
 * All functions are fire-and-forget — return void, never block the UI.
 * Errors are logged but never thrown or surfaced to the user.
 *
 * Card ID matching: google_place_id (singles) OR id::TEXT (pool curated).
 * Fresh-gen curated (curated_...) silently no-op (0 rows matched).
 */

function recordInteraction(cardId: string, interactionType: string): void {
  supabase.rpc('record_card_interaction', {
    p_card_id: cardId,
    p_interaction_type: interactionType,
  }).then(
    ({ error }) => {
      if (error) console.warn('[CardEngagement] Recording failed:', error.message);
    },
    (err) => console.warn('[CardEngagement] Recording failed:', err)
  );
}

export function recordCardSwipe(cardId: string, direction: 'left' | 'right'): void {
  recordInteraction(cardId, direction === 'left' ? 'swipe_left' : 'swipe_right');
}

export function recordCardExpand(cardId: string): void {
  recordInteraction(cardId, 'expand');
}

export function recordCardSchedule(cardId: string): void {
  recordInteraction(cardId, 'schedule');
}
