-- ============================================================
-- Card Pool Data Pipeline — Migration
-- Date: 2026-03-01
-- Creates: place_pool, card_pool, user_card_impressions
-- ============================================================

-- Ensure the updated_at trigger function exists
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. PLACE POOL — Shared reservoir of Google Places data
-- One row per unique Google Place. Shared across ALL users.
-- Refreshed daily via free Place Details by ID (Basic).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.place_pool (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_place_id TEXT UNIQUE NOT NULL,

  -- Core place data (from Google Places API)
  name TEXT NOT NULL,
  address TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  types TEXT[] NOT NULL DEFAULT '{}',
  primary_type TEXT,
  rating DOUBLE PRECISION,
  review_count INTEGER DEFAULT 0,
  price_level TEXT,
  price_min INTEGER DEFAULT 0,
  price_max INTEGER DEFAULT 0,
  opening_hours JSONB,
  photos JSONB DEFAULT '[]',
  website TEXT,

  -- Raw Google response (for future use / re-processing)
  raw_google_data JSONB,

  -- Lifecycle
  fetched_via TEXT DEFAULT 'nearby_search'
    CHECK (fetched_via IN ('nearby_search', 'text_search', 'detail_refresh')),
  first_fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_detail_refresh TIMESTAMPTZ NOT NULL DEFAULT now(),
  refresh_failures INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Geo-lookup: bounding box index for radius queries
CREATE INDEX IF NOT EXISTS idx_place_pool_geo
  ON public.place_pool (lat, lng) WHERE is_active = true;

-- Type lookup: find places by category
CREATE INDEX IF NOT EXISTS idx_place_pool_types
  ON public.place_pool USING GIN (types) WHERE is_active = true;

-- Refresh job: find stale places
CREATE INDEX IF NOT EXISTS idx_place_pool_refresh
  ON public.place_pool (last_detail_refresh)
  WHERE is_active = true;

-- google_place_id unique lookup
CREATE INDEX IF NOT EXISTS idx_place_pool_google_id
  ON public.place_pool (google_place_id);

ALTER TABLE public.place_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_place_pool" ON public.place_pool
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read_place_pool" ON public.place_pool
  FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 2. CARD POOL — Pre-built, enriched, ready-to-serve cards
-- Derived from place_pool. Includes AI descriptions.
-- Two types: 'single' (one place) and 'curated' (three stops).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.card_pool (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_type TEXT NOT NULL DEFAULT 'single'
    CHECK (card_type IN ('single', 'curated')),

  -- Single card fields
  place_pool_id UUID REFERENCES public.place_pool(id) ON DELETE CASCADE,
  google_place_id TEXT,

  -- Curated card fields
  stop_place_pool_ids UUID[],
  stop_google_place_ids TEXT[],
  curated_pairing_key TEXT,
  experience_type TEXT,
  stops JSONB,
  tagline TEXT,
  total_price_min INTEGER,
  total_price_max INTEGER,
  estimated_duration_minutes INTEGER,

  -- Shared card display data (ready to serve)
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  categories TEXT[] NOT NULL DEFAULT '{}',
  description TEXT,
  highlights TEXT[] DEFAULT '{}',
  image_url TEXT,
  images TEXT[] DEFAULT '{}',
  address TEXT,

  -- Matching / filtering criteria
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  rating DOUBLE PRECISION,
  review_count INTEGER DEFAULT 0,
  price_min INTEGER DEFAULT 0,
  price_max INTEGER DEFAULT 0,
  opening_hours JSONB,

  -- Scoring
  base_match_score DOUBLE PRECISION DEFAULT 85,
  popularity_score DOUBLE PRECISION DEFAULT 0,

  -- Lifecycle
  is_active BOOLEAN DEFAULT true,
  served_count INTEGER DEFAULT 0,
  last_served_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Primary query: find cards by category + location bounding box
CREATE INDEX IF NOT EXISTS idx_card_pool_category_geo
  ON public.card_pool (category, lat, lng)
  WHERE is_active = true;

-- GIN index on categories array for overlap queries
CREATE INDEX IF NOT EXISTS idx_card_pool_categories
  ON public.card_pool USING GIN (categories)
  WHERE is_active = true;

-- Card type filter
CREATE INDEX IF NOT EXISTS idx_card_pool_type
  ON public.card_pool (card_type, experience_type)
  WHERE is_active = true;

-- Popularity sort
CREATE INDEX IF NOT EXISTS idx_card_pool_popularity
  ON public.card_pool (popularity_score DESC)
  WHERE is_active = true;

ALTER TABLE public.card_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_card_pool" ON public.card_pool
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read_card_pool" ON public.card_pool
  FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 3. USER CARD IMPRESSIONS — Tracks which cards a user has seen
-- Keyed per-user. "Seen" resets when preferences.updated_at changes.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_card_impressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_pool_id UUID NOT NULL REFERENCES public.card_pool(id) ON DELETE CASCADE,
  impression_type TEXT DEFAULT 'served'
    CHECK (impression_type IN ('served', 'swiped_left', 'swiped_right', 'saved', 'expanded')),
  batch_number INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (user_id, card_pool_id)
);

-- Fast lookup: "which cards has this user seen?"
CREATE INDEX IF NOT EXISTS idx_impressions_user_created
  ON public.user_card_impressions (user_id, created_at DESC);

-- Cleanup: join with preferences.updated_at
CREATE INDEX IF NOT EXISTS idx_impressions_user_card
  ON public.user_card_impressions (user_id, card_pool_id);

ALTER TABLE public.user_card_impressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_impressions" ON public.user_card_impressions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_role_all_impressions" ON public.user_card_impressions
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- 4. HELPER: Updated_at triggers for new tables
-- ============================================================

CREATE TRIGGER update_place_pool_updated_at
  BEFORE UPDATE ON public.place_pool
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_card_pool_updated_at
  BEFORE UPDATE ON public.card_pool
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 5. CLEANUP FUNCTIONS
-- ============================================================

-- Clear stale impressions (older than 30 days)
CREATE OR REPLACE FUNCTION cleanup_stale_impressions()
RETURNS void AS $$
BEGIN
  DELETE FROM public.user_card_impressions
  WHERE created_at < now() - interval '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Deactivate places that haven't been refreshed in 7 days
CREATE OR REPLACE FUNCTION deactivate_stale_places()
RETURNS void AS $$
BEGIN
  UPDATE public.place_pool
  SET is_active = false
  WHERE last_detail_refresh < now() - interval '7 days'
    AND refresh_failures >= 3
    AND is_active = true;

  UPDATE public.card_pool
  SET is_active = false
  WHERE place_pool_id IN (
    SELECT id FROM public.place_pool WHERE is_active = false
  ) AND is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
