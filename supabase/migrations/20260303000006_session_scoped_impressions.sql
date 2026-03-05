-- Session-Scoped Impressions Migration
-- Date: 2026-03-03
-- Replaces 200-card sliding window with preference-session scoped filtering.
-- Cards seen in a previous preference session become eligible when prefs change.

-- 1. Add analytics columns to existing user_card_impressions table
ALTER TABLE public.user_card_impressions
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. Backfill first_seen_at from existing created_at for all existing rows
UPDATE public.user_card_impressions SET first_seen_at = created_at;

-- 3. Create RPC function for session-aware impression recording.
-- Supabase JS .upsert() only supports ignoreDuplicates (skip) or full replace.
-- We need ON CONFLICT DO UPDATE to bump created_at and increment view_count
-- while preserving first_seen_at.
CREATE OR REPLACE FUNCTION record_card_impressions(
  p_user_id UUID,
  p_card_pool_ids UUID[],
  p_batch_number INTEGER DEFAULT 0
) RETURNS void AS $$
BEGIN
  INSERT INTO public.user_card_impressions
    (user_id, card_pool_id, batch_number, created_at, view_count, first_seen_at)
  SELECT p_user_id, unnest(p_card_pool_ids), p_batch_number, now(), 1, now()
  ON CONFLICT (user_id, card_pool_id) DO UPDATE SET
    created_at = now(),
    batch_number = EXCLUDED.batch_number,
    view_count = user_card_impressions.view_count + 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Add covering index for session-scoped queries.
-- The query pattern is: WHERE user_id = ? AND created_at >= ?
-- INCLUDE card_pool_id so the query is index-only (no heap access).
CREATE INDEX IF NOT EXISTS idx_impressions_user_session
  ON public.user_card_impressions (user_id, created_at)
  INCLUDE (card_pool_id);
