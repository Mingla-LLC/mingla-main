-- ============================================================================
-- Fix record_card_impressions ON CONFLICT clause
-- ============================================================================
-- Migration 20260329000006 replaced UNIQUE(user_id, card_pool_id) with a
-- partial unique index: WHERE user_id IS NOT NULL.
-- The record_card_impressions RPC still uses ON CONFLICT (user_id, card_pool_id)
-- without the matching WHERE predicate, causing every insert to fail with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- This silently broke cross-page dedup since March 29.
--
-- Fix: add WHERE user_id IS NOT NULL to match the partial index.
-- Note: user_visits has the same partial index pattern but no code currently
-- uses ON CONFLICT against it — flagged here for awareness.
-- ============================================================================

CREATE OR REPLACE FUNCTION record_card_impressions(
  p_user_id UUID,
  p_card_pool_ids UUID[],
  p_batch_number INTEGER DEFAULT 0
) RETURNS void AS $$
BEGIN
  INSERT INTO public.user_card_impressions
    (user_id, card_pool_id, batch_number, created_at, view_count, first_seen_at)
  SELECT p_user_id, unnest(p_card_pool_ids), p_batch_number, now(), 1, now()
  ON CONFLICT (user_id, card_pool_id) WHERE user_id IS NOT NULL DO UPDATE SET
    created_at = now(),
    batch_number = EXCLUDED.batch_number,
    view_count = user_card_impressions.view_count + 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
