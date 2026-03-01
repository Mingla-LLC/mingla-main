-- ============================================================
-- Centralized Google Places API response cache
-- Shared across ALL edge functions
-- Key: (place_type, location_key, radius_bucket)
-- TTL: 24 hours (configurable per query)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.google_places_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_type TEXT NOT NULL,
  location_key TEXT NOT NULL,
  radius_bucket INTEGER NOT NULL,
  search_strategy TEXT NOT NULL DEFAULT 'nearby',
  text_query TEXT,
  places JSONB NOT NULL DEFAULT '[]',
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  hit_count INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT uq_places_cache_key UNIQUE (place_type, location_key, radius_bucket, search_strategy, text_query)
);

CREATE INDEX IF NOT EXISTS idx_places_cache_lookup 
  ON public.google_places_cache (place_type, location_key, radius_bucket, search_strategy)
  WHERE expires_at > now();

CREATE INDEX IF NOT EXISTS idx_places_cache_expiry 
  ON public.google_places_cache (expires_at);

ALTER TABLE public.google_places_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.google_places_cache
  FOR ALL USING (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION cleanup_expired_places_cache()
RETURNS void AS $$
BEGIN
  DELETE FROM public.google_places_cache WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
