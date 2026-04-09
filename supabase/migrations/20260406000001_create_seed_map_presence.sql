-- Standalone table for seeded map strangers.
-- NO foreign keys — seeds don't need auth.users or profiles rows.
-- Read by get-nearby-people via admin client (bypasses RLS).

CREATE TABLE IF NOT EXISTS public.seed_map_presence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  first_name TEXT,
  avatar_url TEXT,
  approximate_lat DOUBLE PRECISION NOT NULL,
  approximate_lng DOUBLE PRECISION NOT NULL,
  activity_status TEXT,
  activity_status_expires_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  categories TEXT[] NOT NULL DEFAULT '{}',
  price_tiers TEXT[] NOT NULL DEFAULT '{}',
  intents TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bounding box index for spatial queries (same pattern as user_map_settings)
CREATE INDEX IF NOT EXISTS idx_seed_map_presence_location
  ON public.seed_map_presence (approximate_lat, approximate_lng);

-- No RLS — table is read/written exclusively via admin client in edge functions.
-- Real users never query this table directly.
