-- ===========================================
-- ORCH-0437: Near You Leaderboard — Phase 1
-- Migration 1: User Levels table + recalculate RPC
-- ===========================================

-- User level scoring cache. Aggregates from 5+ tables.
-- Lazy recalculation: only updates when stale (>1 hour).
CREATE TABLE IF NOT EXISTS public.user_levels (
  user_id           UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  level             INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 99),
  xp_score          NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Cached input counts (updated by RPC)
  reviews_count     INTEGER NOT NULL DEFAULT 0,
  saves_count       INTEGER NOT NULL DEFAULT 0,
  scheduled_count   INTEGER NOT NULL DEFAULT 0,
  friends_count     INTEGER NOT NULL DEFAULT 0,
  collabs_count     INTEGER NOT NULL DEFAULT 0,
  account_age_days  INTEGER NOT NULL DEFAULT 0,

  last_calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_levels ENABLE ROW LEVEL SECURITY;

-- Anyone can read anyone's level (public info — shown on leaderboard cards)
CREATE POLICY "Levels are public"
  ON public.user_levels
  FOR SELECT
  USING (true);

-- Only service role writes (via RPC from edge functions)
CREATE POLICY "Service role manages levels"
  ON public.user_levels
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Level calculation RPC
-- Weights: reviews=5, saves=2, scheduled=3, friends=3, collabs=4, tenure=0.1/day (cap 365)
-- Curve: logarithmic — level = floor(10 * ln(xp + 1)) + 1, clamped [1, 99]
CREATE OR REPLACE FUNCTION public.recalculate_user_level(target_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reviews    INTEGER;
  v_saves      INTEGER;
  v_scheduled  INTEGER;
  v_friends    INTEGER;
  v_collabs    INTEGER;
  v_age_days   INTEGER;
  v_xp         NUMERIC(10,2);
  v_level      INTEGER;
BEGIN
  -- Count inputs from authoritative tables
  SELECT count(*) INTO v_reviews FROM place_reviews WHERE user_id = target_user_id;
  SELECT count(*) INTO v_saves FROM saved_card WHERE profile_id = target_user_id;
  SELECT count(*) INTO v_scheduled FROM calendar_entries WHERE user_id = target_user_id;
  SELECT count(*) INTO v_friends FROM friends
    WHERE status = 'accepted' AND deleted_at IS NULL
      AND (user_id = target_user_id OR friend_user_id = target_user_id);
  SELECT count(DISTINCT session_id) INTO v_collabs FROM session_participants
    WHERE user_id = target_user_id AND has_accepted = true;
  SELECT COALESCE(EXTRACT(DAY FROM now() - created_at)::INTEGER, 0) INTO v_age_days
    FROM auth.users WHERE id = target_user_id;

  -- XP formula
  v_xp := (v_reviews * 5.0)
         + (v_saves * 2.0)
         + (v_scheduled * 3.0)
         + (v_friends * 3.0)
         + (v_collabs * 4.0)
         + (LEAST(COALESCE(v_age_days, 0), 365) * 0.1);

  -- Logarithmic level curve
  v_level := GREATEST(1, LEAST(99, FLOOR(10.0 * LN(v_xp + 1)) + 1));

  -- Upsert into user_levels cache
  INSERT INTO user_levels (user_id, level, xp_score, reviews_count, saves_count,
    scheduled_count, friends_count, collabs_count, account_age_days, last_calculated_at)
  VALUES (target_user_id, v_level, v_xp, v_reviews, v_saves, v_scheduled,
    v_friends, v_collabs, COALESCE(v_age_days, 0), now())
  ON CONFLICT (user_id) DO UPDATE SET
    level = v_level,
    xp_score = v_xp,
    reviews_count = v_reviews,
    saves_count = v_saves,
    scheduled_count = v_scheduled,
    friends_count = v_friends,
    collabs_count = v_collabs,
    account_age_days = COALESCE(v_age_days, 0),
    last_calculated_at = now();

  -- Also update the materialized level on leaderboard_presence (if row exists)
  UPDATE leaderboard_presence SET user_level = v_level WHERE user_id = target_user_id;

  RETURN v_level;
END;
$$;
