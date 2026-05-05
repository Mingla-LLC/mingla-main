-- ============================================================
-- Daily swipe tracking table
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_swipe_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  swipe_date DATE NOT NULL DEFAULT CURRENT_DATE,
  swipe_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, swipe_date)
);

-- Index for fast lookup by user + date
CREATE INDEX idx_daily_swipe_counts_user_date
  ON daily_swipe_counts(user_id, swipe_date);

-- RLS
ALTER TABLE daily_swipe_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own swipe counts"
  ON daily_swipe_counts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own swipe counts"
  ON daily_swipe_counts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own swipe counts"
  ON daily_swipe_counts FOR UPDATE
  USING (auth.uid() = user_id);

-- Auto-update timestamp trigger
CREATE TRIGGER set_daily_swipe_counts_updated_at
  BEFORE UPDATE ON daily_swipe_counts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Increment swipe count function (atomic, handles upsert)
-- ============================================================
CREATE OR REPLACE FUNCTION increment_daily_swipe_count(p_user_id UUID)
RETURNS TABLE(new_count INTEGER, daily_limit INTEGER, is_limited BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tier TEXT;
  v_limit INTEGER;
  v_count INTEGER;
BEGIN
  -- Get user's effective tier
  v_tier := get_effective_tier(p_user_id);

  -- Set limit based on tier
  IF v_tier IN ('pro', 'elite') THEN
    v_limit := -1; -- unlimited
  ELSE
    v_limit := 20;
  END IF;

  -- Upsert and increment atomically
  INSERT INTO daily_swipe_counts (user_id, swipe_date, swipe_count)
  VALUES (p_user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, swipe_date)
  DO UPDATE SET
    swipe_count = daily_swipe_counts.swipe_count + 1,
    updated_at = now()
  RETURNING daily_swipe_counts.swipe_count INTO v_count;

  new_count := v_count;
  daily_limit := v_limit;
  is_limited := (v_limit > 0 AND v_count >= v_limit);
  RETURN NEXT;
END;
$$;

-- ============================================================
-- Get remaining swipes function
-- ============================================================
CREATE OR REPLACE FUNCTION get_remaining_swipes(p_user_id UUID)
RETURNS TABLE(remaining INTEGER, daily_limit INTEGER, used INTEGER, resets_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tier TEXT;
  v_limit INTEGER;
  v_count INTEGER;
BEGIN
  v_tier := get_effective_tier(p_user_id);

  IF v_tier IN ('pro', 'elite') THEN
    remaining := -1; -- unlimited
    daily_limit := -1;
    used := 0;
    resets_at := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  v_limit := 20;

  SELECT COALESCE(dsc.swipe_count, 0) INTO v_count
  FROM daily_swipe_counts dsc
  WHERE dsc.user_id = p_user_id AND dsc.swipe_date = CURRENT_DATE;

  IF NOT FOUND THEN v_count := 0; END IF;

  remaining := GREATEST(v_limit - v_count, 0);
  daily_limit := v_limit;
  used := v_count;
  -- Next midnight UTC (client converts to local)
  resets_at := date_trunc('day', now() AT TIME ZONE 'UTC') + INTERVAL '1 day';
  RETURN NEXT;
END;
$$;

-- ============================================================
-- Tier limit constants function (single source of truth)
-- ============================================================
CREATE OR REPLACE FUNCTION get_tier_limits(p_tier TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE AS $$
BEGIN
  CASE p_tier
    WHEN 'free' THEN
      RETURN jsonb_build_object(
        'daily_swipes', 20,
        'max_pairings', 0,
        'max_sessions', 1,
        'max_session_members', 5,
        'curated_cards_access', false,
        'custom_starting_point', false
      );
    WHEN 'pro' THEN
      RETURN jsonb_build_object(
        'daily_swipes', -1,
        'max_pairings', 0,
        'max_sessions', 3,
        'max_session_members', 5,
        'curated_cards_access', true,
        'custom_starting_point', true
      );
    WHEN 'elite' THEN
      RETURN jsonb_build_object(
        'daily_swipes', -1,
        'max_pairings', -1,
        'max_sessions', -1,
        'max_session_members', 15,
        'curated_cards_access', true,
        'custom_starting_point', true
      );
    ELSE
      -- Default to free
      RETURN get_tier_limits('free');
  END CASE;
END;
$$;

-- ============================================================
-- Add teaser_text column to card_pool for curated card teasers
-- ============================================================
ALTER TABLE card_pool
  ADD COLUMN IF NOT EXISTS teaser_text TEXT;

COMMENT ON COLUMN card_pool.teaser_text IS
  'AI-generated teaser description for locked curated cards. Does not reveal place names.';
