-- Migration: Adventurous Turbo Pipeline
-- Adds composite index for faster curated pool lookups and an RPC function
-- for single-query pool serving with anti-join on impressions.

-- Composite index for curated pool queries (geo + budget + active)
CREATE INDEX IF NOT EXISTS idx_card_pool_curated_geo
  ON card_pool (experience_type, is_active, lat, lng, total_price_max)
  WHERE card_type = 'curated';

-- RPC function for optimized pool query with anti-join on impressions
CREATE OR REPLACE FUNCTION serve_curated_from_pool(
  p_user_id UUID,
  p_experience_type TEXT,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_radius_meters DOUBLE PRECISION,
  p_budget_max INTEGER,
  p_pref_updated_at TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 20
)
RETURNS SETOF card_pool
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_lat_delta DOUBLE PRECISION := p_radius_meters / 111320.0;
  v_lng_delta DOUBLE PRECISION := p_radius_meters / (111320.0 * cos(radians(p_lat)));
BEGIN
  RETURN QUERY
  SELECT cp.*
  FROM card_pool cp
  WHERE cp.is_active = true
    AND cp.card_type = 'curated'
    AND cp.experience_type = p_experience_type
    AND cp.lat BETWEEN p_lat - v_lat_delta AND p_lat + v_lat_delta
    AND cp.lng BETWEEN p_lng - v_lng_delta AND p_lng + v_lng_delta
    AND cp.total_price_max <= p_budget_max
    AND NOT EXISTS (
      SELECT 1 FROM user_card_impressions uci
      WHERE uci.card_pool_id = cp.id
        AND uci.user_id = p_user_id
        AND uci.created_at >= p_pref_updated_at
    )
  ORDER BY cp.popularity_score DESC
  LIMIT p_limit;
END;
$$;
