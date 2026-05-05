-- ===========================================
-- ORCH-0437: Near You Leaderboard — Phase 1
-- Migration 2: Leaderboard Presence table + RLS + FoF helper
-- ===========================================

-- Friends-of-friends helper function (must exist before RLS policy references it)
CREATE OR REPLACE FUNCTION public.are_friends_or_fof(viewer_id UUID, target_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Direct friends check
  SELECT EXISTS (
    SELECT 1 FROM friends
    WHERE status = 'accepted' AND deleted_at IS NULL
      AND (
        (user_id = viewer_id AND friend_user_id = target_id)
        OR (friend_user_id = viewer_id AND user_id = target_id)
      )
  )
  OR EXISTS (
    -- Friends of friends: viewer→mutual→target (2-hop)
    SELECT 1 FROM friends f1
    JOIN friends f2 ON (
      CASE WHEN f1.user_id = viewer_id THEN f1.friend_user_id ELSE f1.user_id END
      = CASE WHEN f2.user_id = target_id THEN f2.friend_user_id ELSE f2.user_id END
    )
    WHERE f1.status = 'accepted' AND f1.deleted_at IS NULL
      AND f2.status = 'accepted' AND f2.deleted_at IS NULL
      AND (f1.user_id = viewer_id OR f1.friend_user_id = viewer_id)
      AND (f2.user_id = target_id OR f2.friend_user_id = target_id)
    LIMIT 1
  );
$$;

-- Leaderboard presence: one row per active user, upserted on each swipe
CREATE TABLE public.leaderboard_presence (
  user_id         UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_discoverable BOOLEAN NOT NULL DEFAULT false,
  visibility_level TEXT NOT NULL DEFAULT 'friends'
    CHECK (visibility_level IN ('off','paired','friends','friends_of_friends','everyone')),

  -- Location (plain doubles — no PostGIS in this project)
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,

  -- Status & intent
  activity_status TEXT,
  preference_categories TEXT[] NOT NULL DEFAULT '{}',
  last_swiped_category TEXT,

  -- Seats (0 = all filled, user hidden from leaderboard via partial index)
  available_seats INTEGER NOT NULL DEFAULT 1
    CHECK (available_seats BETWEEN 0 AND 5),
  active_collab_session_id UUID REFERENCES public.collaboration_sessions(id) ON DELETE SET NULL,

  -- Activity metrics
  swipe_count     INTEGER NOT NULL DEFAULT 0,
  session_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_swipe_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Level (materialized — updated by recalculate_user_level RPC)
  user_level      INTEGER NOT NULL DEFAULT 1
    CHECK (user_level BETWEEN 1 AND 99),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for geographic bounding box queries
CREATE INDEX idx_leaderboard_presence_geo
  ON public.leaderboard_presence (lat, lng)
  WHERE is_discoverable = true AND available_seats > 0;

-- Index for recency ranking
CREATE INDEX idx_leaderboard_presence_recency
  ON public.leaderboard_presence (last_swipe_at DESC)
  WHERE is_discoverable = true AND available_seats > 0;

-- Enable Realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.leaderboard_presence;

-- Row Level Security
ALTER TABLE public.leaderboard_presence ENABLE ROW LEVEL SECURITY;

-- Users can always read/write their own row
CREATE POLICY "Users manage own presence"
  ON public.leaderboard_presence
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Visibility policy: enforces who-sees-you at the database level
CREATE POLICY "Users see discoverable presence"
  ON public.leaderboard_presence
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      is_discoverable = true
      AND available_seats > 0
      AND last_swipe_at > now() - interval '24 hours'
      AND (
        visibility_level = 'everyone'
        OR (visibility_level = 'friends' AND EXISTS (
          SELECT 1 FROM public.friends
          WHERE status = 'accepted'
            AND deleted_at IS NULL
            AND (
              (user_id = auth.uid() AND friend_user_id = leaderboard_presence.user_id)
              OR (friend_user_id = auth.uid() AND user_id = leaderboard_presence.user_id)
            )
        ))
        OR (visibility_level = 'friends_of_friends' AND public.are_friends_or_fof(auth.uid(), leaderboard_presence.user_id))
        OR (visibility_level = 'paired' AND EXISTS (
          SELECT 1 FROM public.friends
          WHERE status = 'accepted'
            AND deleted_at IS NULL
            AND (
              (user_id = auth.uid() AND friend_user_id = leaderboard_presence.user_id)
              OR (friend_user_id = auth.uid() AND user_id = leaderboard_presence.user_id)
            )
        ))
      )
    )
  );
