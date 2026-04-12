import { supabase } from './supabase';

/**
 * ORCH-0408 Phase 2: Record a card swipe to card_pool counters.
 *
 * Fire-and-forget — returns void, never blocks the swipe animation.
 * Errors are logged but never thrown or surfaced to the user.
 *
 * p_card_id is card.id from the Recommendation:
 *   - Single cards: Google Place ID (matched by card_pool.google_place_id)
 *   - Pool curated: card_pool UUID (matched by card_pool.id::TEXT)
 *   - Fresh-gen curated: synthetic ID (matches 0 rows — silent no-op, acceptable)
 */
export function recordCardSwipe(cardId: string, direction: 'left' | 'right'): void {
  supabase.rpc('record_card_swipe', {
    p_card_id: cardId,
    p_direction: direction,
  }).then(
    ({ error }) => {
      if (error) console.warn('[CardEngagement] Swipe recording failed:', error.message);
    },
    (err) => console.warn('[CardEngagement] Swipe recording failed:', err)
  );
}
