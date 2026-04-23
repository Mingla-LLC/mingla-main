import { supabase } from './supabase';

/**
 * ORCH-0640 ch09 — Engagement tracking (DEC-039, DEC-047, DEC-052).
 *
 * Rewired from record_card_interaction (DROPPED in ch11 migration 20260425000012)
 * to record_engagement (NEW in ch04 migration 20260425000006). Fire-and-forget — never
 * blocks UI. Errors logged but never thrown.
 *
 * record_engagement RPC accepts:
 *   p_event_kind:      'served' | 'seen_deck' | 'seen_expand' | 'saved' | 'scheduled' | 'reviewed'
 *   p_place_pool_id:   UUID for singles + curated-stops; NULL for curated-container events
 *   p_container_key:   NULL for singles; sha256(experience_type + ':' + sorted_stop_place_pool_ids.join(','))
 *                      for curated events (formula locked per DEC-053 / ORCH-0634 cache_key)
 *   p_experience_type: NULL for singles; curated experience_type ('romantic' etc.)
 *   p_category:        chip label ('brunch', 'drinks', ...)
 *   p_stops:           JSON array of { place_pool_id, stop_index } — when provided on
 *                      curated events, RPC fans out to 4 rows (1 container + N stops per DEC-047)
 *
 * I-ENGAGEMENT-IDENTITY-PLACE-LEVEL: engagement counters key on place_pool_id (singles
 * + stops) + container_key (curated containers). Do NOT write directly to engagement_metrics
 * from client — always go through this RPC.
 */

export type EventKind =
  | 'served'
  | 'seen_deck'
  | 'seen_expand'
  | 'saved'
  | 'scheduled'
  | 'reviewed';

export interface EngagementContext {
  category?: string;                // chip label (mandatory for singles, mandatory for curated)
  experienceType?: string;          // curated only: 'romantic' etc.
  containerKey?: string;            // curated only: ORCH-0634 cache_key
  stops?: Array<{                   // curated only: array of stops for 4-way fan-out
    placePoolId: string;
    stopIndex: number;
  }>;
}

function fire(eventKind: EventKind, placePoolId: string | null, context?: EngagementContext): void {
  const p_stops = context?.stops && context.stops.length > 0
    ? context.stops.map(s => ({ place_pool_id: s.placePoolId, stop_index: s.stopIndex }))
    : null;

  supabase.rpc('record_engagement', {
    p_event_kind:      eventKind,
    p_place_pool_id:   placePoolId,
    p_container_key:   context?.containerKey ?? null,
    p_experience_type: context?.experienceType ?? null,
    p_category:        context?.category ?? null,
    p_stops:           p_stops,
  }).then(
    ({ error }) => {
      if (error) console.warn('[recordEngagement] RPC error:', error.message);
    },
    (err) => console.warn('[recordEngagement] RPC threw:', err)
  );
}

// Public API — callers ignore 4-way fan-out; it happens server-side.
// For single cards: pass place_pool_id (card.id on the new serving shape) + context.
// For curated cards: pass NULL for place_pool_id + containerKey + stops[].
export function recordServed(placePoolId: string | null, context?: EngagementContext): void {
  fire('served', placePoolId, context);
}
export function recordSeenDeck(placePoolId: string | null, context?: EngagementContext): void {
  fire('seen_deck', placePoolId, context);
}
export function recordSeenExpand(placePoolId: string | null, context?: EngagementContext): void {
  fire('seen_expand', placePoolId, context);
}
export function recordSaved(placePoolId: string | null, context?: EngagementContext): void {
  fire('saved', placePoolId, context);
}
export function recordScheduled(placePoolId: string | null, context?: EngagementContext): void {
  fire('scheduled', placePoolId, context);
}
export function recordReviewed(placePoolId: string, context?: EngagementContext): void {
  // Reviews always reference the reviewed place directly (not a curated container).
  fire('reviewed', placePoolId, context);
}

// ─── Backward-compat shims for existing call sites ─────────────────────────
// SwipeableCards + other surfaces still call recordCardSwipe / recordCardExpand /
// recordCardSchedule. These shims translate the old CardContext API onto the new
// record_engagement RPC. Remove in a follow-up pass once call sites migrate to the
// explicit recordSaved / recordSeenExpand / recordScheduled API above.

export interface CardContext {
  category?: string;
  priceTier?: string;   // accepted but not forwarded — engagement_metrics doesn't key on price
  isCurated?: boolean;  // ignored — curated identity must now come from containerKey
}

export function recordCardSwipe(
  cardId: string,
  direction: 'left' | 'right',
  context?: CardContext
): void {
  // right → saved; left → seen_deck (impression, not a saved action)
  fire(direction === 'right' ? 'saved' : 'seen_deck', cardId, {
    category: context?.category,
  });
}

export function recordCardExpand(cardId: string, context?: CardContext): void {
  fire('seen_expand', cardId, { category: context?.category });
}

export function recordCardSchedule(cardId: string, context?: CardContext): void {
  fire('scheduled', cardId, { category: context?.category });
}
