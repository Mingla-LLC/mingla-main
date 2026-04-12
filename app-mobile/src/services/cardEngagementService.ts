import { supabase } from './supabase';

/**
 * ORCH-0408 Phase 4: Record card interactions — counters + user interaction log.
 *
 * All functions are fire-and-forget — return void, never block the UI.
 * Errors are logged but never thrown or surfaced to the user.
 *
 * The RPC does two things atomically:
 *   1. Increments the appropriate card_pool counter (save/skip/expand/visit)
 *   2. Inserts a row into user_interactions with context (when context provided)
 *
 * This is the SINGLE source of truth for interaction logging.
 * No other service should INSERT into user_interactions.
 */

export interface CardContext {
  category?: string;
  priceTier?: string;
  isCurated?: boolean;
}

function recordInteraction(
  cardId: string,
  interactionType: string,
  context?: CardContext
): void {
  supabase.rpc('record_card_interaction', {
    p_card_id: cardId,
    p_interaction_type: interactionType,
    p_category: context?.category ?? null,
    p_price_tier: context?.priceTier ?? null,
    p_is_curated: context?.isCurated ?? false,
  }).then(
    ({ error }) => {
      if (error) console.warn('[CardEngagement] Recording failed:', error.message);
    },
    (err) => console.warn('[CardEngagement] Recording failed:', err)
  );
}

export function recordCardSwipe(
  cardId: string,
  direction: 'left' | 'right',
  context?: CardContext
): void {
  recordInteraction(cardId, direction === 'left' ? 'swipe_left' : 'swipe_right', context);
}

export function recordCardExpand(cardId: string, context?: CardContext): void {
  recordInteraction(cardId, 'expand', context);
}

export function recordCardSchedule(cardId: string, context?: CardContext): void {
  recordInteraction(cardId, 'schedule', context);
}
