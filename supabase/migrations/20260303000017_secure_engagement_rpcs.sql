-- Secure engagement RPC functions
-- Date: 2026-03-03
-- Fixes: increment_user_engagement and increment_place_engagement are SECURITY DEFINER
-- functions with no field whitelisting and no ownership check. Any authenticated user
-- could inflate any user's engagement stats or update arbitrary place_pool columns.
--
-- Fix: Add explicit field whitelists and auth.uid() ownership check.

-- ============================================================
-- 1. increment_user_engagement — field whitelist + auth.uid() check
-- ============================================================

CREATE OR REPLACE FUNCTION increment_user_engagement(
  p_user_id UUID,
  p_field TEXT,
  p_amount INTEGER DEFAULT 1
) RETURNS void AS $$
DECLARE
  allowed_fields TEXT[] := ARRAY[
    'total_cards_seen',
    'total_cards_saved',
    'total_cards_scheduled',
    'total_reviews_given'
  ];
BEGIN
  -- Ownership check: users can only increment their own stats.
  -- Service role (edge functions like cardPoolService, process-voice-review) is exempt —
  -- they call this on behalf of the user via supabaseAdmin.
  IF auth.role() != 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
      RAISE EXCEPTION 'Permission denied: can only update own engagement stats';
    END IF;
  END IF;

  -- Field whitelist: prevent arbitrary column writes via dynamic SQL
  IF NOT (p_field = ANY(allowed_fields)) THEN
    RAISE EXCEPTION 'Invalid field: %', p_field;
  END IF;

  -- Ensure row exists
  INSERT INTO public.user_engagement_stats (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Increment the specified field
  EXECUTE format(
    'UPDATE public.user_engagement_stats SET %I = %I + $1, updated_at = now() WHERE user_id = $2',
    p_field, p_field
  ) USING p_amount, p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2. increment_place_engagement — field whitelist only
-- (No ownership check — place stats are global, any authenticated
-- user legitimately increments them via swipe/save/schedule actions)
-- ============================================================

CREATE OR REPLACE FUNCTION increment_place_engagement(
  p_google_place_id TEXT,
  p_field TEXT,
  p_amount INTEGER DEFAULT 1
) RETURNS void AS $$
DECLARE
  allowed_fields TEXT[] := ARRAY[
    'total_impressions',
    'total_saves',
    'total_schedules',
    'mingla_review_count',
    'mingla_positive_count',
    'mingla_negative_count'
  ];
BEGIN
  -- Require authenticated user or service role (edge functions call via supabaseAdmin).
  IF auth.role() != 'service_role' AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Permission denied: authentication required';
  END IF;

  -- Field whitelist: prevent arbitrary column writes via dynamic SQL
  IF NOT (p_field = ANY(allowed_fields)) THEN
    RAISE EXCEPTION 'Invalid field: %', p_field;
  END IF;

  EXECUTE format(
    'UPDATE public.place_pool SET %I = %I + $1 WHERE google_place_id = $2',
    p_field, p_field
  ) USING p_amount, p_google_place_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
