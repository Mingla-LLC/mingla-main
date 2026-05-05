-- ORCH-0653 v3.2: push the bbox+filter+rank query into Postgres via RPC.
--
-- v3 (bbox-first reorder, commit 55410580) and v3.1 (chunking, commit
-- 7737119a) both hit transport-layer URL length walls when passing
-- thousands of place_ids through PostgREST .in(). Supabase edge proxy
-- caps at ~10-12KB, smaller than Deno fetch's ~64KB. Chunking to ~200
-- IDs would work but cost ~25 sequential roundtrips per intent (~2s).
--
-- Solution: do the entire 3-step query (bbox + filter signal + rank
-- signal) inside Postgres in one call. No URL involved. Returns the
-- final top-N place_ids + their rank scores. Edge function then
-- hydrates this small set via a single .in('id', rankedIds) which is
-- always small (<= limit*2 = ~100).
--
-- Three-gate serving still enforced:
--   G1: pp.is_servable = true (WHERE)
--   G2: ps_filter.score >= filter_min (INNER JOIN ON)
--   G3: real stored_photo_urls (post-RPC, in edge function)

CREATE OR REPLACE FUNCTION fetch_local_signal_ranked(
  p_filter_signal text,
  p_filter_min numeric,
  p_rank_signal text,
  p_lat_min numeric,
  p_lat_max numeric,
  p_lng_min numeric,
  p_lng_max numeric,
  p_required_types text[] DEFAULT NULL,
  p_limit int DEFAULT 100
)
RETURNS TABLE (
  place_id uuid,
  rank_score numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ps_rank.place_id,
    ps_rank.score AS rank_score
  FROM place_pool pp
  INNER JOIN place_scores ps_filter
    ON ps_filter.place_id = pp.id
    AND ps_filter.signal_id = p_filter_signal
    AND ps_filter.score >= p_filter_min
  INNER JOIN place_scores ps_rank
    ON ps_rank.place_id = pp.id
    AND ps_rank.signal_id = p_rank_signal
  WHERE pp.is_active = true
    AND pp.is_servable = true
    AND pp.lat BETWEEN p_lat_min AND p_lat_max
    AND pp.lng BETWEEN p_lng_min AND p_lng_max
    AND (p_required_types IS NULL OR pp.types && p_required_types)
  ORDER BY ps_rank.score DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION fetch_local_signal_ranked IS
'ORCH-0653 v3.2: returns top-N local place_ids ranked by rank_signal score, after filtering by filter_signal threshold + bbox + servable. Used by generate-curated-experiences edge function. Replaces 3 separate PostgREST roundtrips that hit Supabase edge proxy URL length cap.';

GRANT EXECUTE ON FUNCTION fetch_local_signal_ranked TO authenticated;
GRANT EXECUTE ON FUNCTION fetch_local_signal_ranked TO anon;
GRANT EXECUTE ON FUNCTION fetch_local_signal_ranked TO service_role;
