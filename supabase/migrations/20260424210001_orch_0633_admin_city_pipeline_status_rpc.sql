-- ORCH-0633 — admin_city_pipeline_status RPC
--
-- Powers the "City Pipeline History" table on the Signal Library admin page.
-- Gives the admin one glance at every seeded city's stage-by-stage progress:
-- seeded → refreshed → AI-validated → bouncer-judged → signal-scored → photos.
--
-- Per-stage numbers are row counts + % of total_active_places. Admin can tell
-- at a glance which cities are launch-ready vs need more work.
--
-- Idempotent (CREATE OR REPLACE). Run via `supabase db push`.

CREATE OR REPLACE FUNCTION public.admin_city_pipeline_status()
RETURNS TABLE(
  city_id uuid,
  city_name text,
  country_name text,
  country_code text,
  city_status text,
  created_at timestamptz,

  -- Stage counts (absolute)
  total_active bigint,
  seeded_count bigint,           -- rows with google_place_id (always = total_active for seeded pools)
  refreshed_count bigint,        -- rows whose last_detail_refresh > created_at (i.e., refreshed at least once)
  ai_validated_count bigint,     -- rows with ai_validated_at IS NOT NULL
  ai_approved_count bigint,      -- rows with ai_approved = true
  bouncer_judged_count bigint,   -- rows with is_servable IS NOT NULL (either true or false)
  is_servable_count bigint,      -- rows with is_servable = true
  has_real_photos_count bigint,  -- rows with non-empty stored_photo_urls (not '__backfill_failed__')
  scored_count bigint,           -- rows with ≥1 entry in place_scores

  -- Last-activity pulse
  last_place_update timestamptz, -- max(place_pool.updated_at)
  last_refresh timestamptz,      -- max(last_detail_refresh)
  last_bouncer_run timestamptz,  -- max(bouncer_validated_at)
  last_ai_run timestamptz        -- max(ai_validated_at)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pool_stats AS (
    SELECT
      pp.city_id,
      COUNT(*) FILTER (WHERE pp.is_active) AS total_active,
      COUNT(*) FILTER (WHERE pp.is_active AND pp.google_place_id IS NOT NULL) AS seeded_count,
      COUNT(*) FILTER (WHERE pp.is_active AND pp.last_detail_refresh IS NOT NULL AND pp.last_detail_refresh > pp.created_at + interval '1 minute') AS refreshed_count,
      COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_validated_at IS NOT NULL) AS ai_validated_count,
      COUNT(*) FILTER (WHERE pp.is_active AND pp.ai_approved = true) AS ai_approved_count,
      COUNT(*) FILTER (WHERE pp.is_active AND pp.is_servable IS NOT NULL) AS bouncer_judged_count,
      COUNT(*) FILTER (WHERE pp.is_active AND pp.is_servable = true) AS is_servable_count,
      COUNT(*) FILTER (
        WHERE pp.is_active
          AND pp.stored_photo_urls IS NOT NULL
          AND array_length(pp.stored_photo_urls, 1) > 0
          AND NOT (array_length(pp.stored_photo_urls, 1) = 1 AND pp.stored_photo_urls[1] = '__backfill_failed__')
      ) AS has_real_photos_count,
      MAX(pp.updated_at) AS last_place_update,
      MAX(pp.last_detail_refresh) AS last_refresh,
      MAX(pp.bouncer_validated_at) AS last_bouncer_run,
      MAX(pp.ai_validated_at) AS last_ai_run
    FROM public.place_pool pp
    WHERE pp.city_id IS NOT NULL
    GROUP BY pp.city_id
  ),
  score_stats AS (
    SELECT
      pp.city_id,
      COUNT(DISTINCT ps.place_id) AS scored_count
    FROM public.place_scores ps
    JOIN public.place_pool pp ON pp.id = ps.place_id
    WHERE pp.city_id IS NOT NULL AND pp.is_active = true
    GROUP BY pp.city_id
  )
  SELECT
    sc.id AS city_id,
    sc.name AS city_name,
    sc.country AS country_name,
    sc.country_code,
    sc.status AS city_status,
    sc.created_at,
    COALESCE(ps.total_active, 0)::bigint          AS total_active,
    COALESCE(ps.seeded_count, 0)::bigint          AS seeded_count,
    COALESCE(ps.refreshed_count, 0)::bigint       AS refreshed_count,
    COALESCE(ps.ai_validated_count, 0)::bigint    AS ai_validated_count,
    COALESCE(ps.ai_approved_count, 0)::bigint     AS ai_approved_count,
    COALESCE(ps.bouncer_judged_count, 0)::bigint  AS bouncer_judged_count,
    COALESCE(ps.is_servable_count, 0)::bigint     AS is_servable_count,
    COALESCE(ps.has_real_photos_count, 0)::bigint AS has_real_photos_count,
    COALESCE(ss.scored_count, 0)::bigint          AS scored_count,
    ps.last_place_update,
    ps.last_refresh,
    ps.last_bouncer_run,
    ps.last_ai_run
  FROM public.seeding_cities sc
  LEFT JOIN pool_stats ps ON ps.city_id = sc.id
  LEFT JOIN score_stats ss ON ss.city_id = sc.id
  ORDER BY COALESCE(ps.total_active, 0) DESC, sc.name;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_city_pipeline_status() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_city_pipeline_status() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_city_pipeline_status() IS
  'ORCH-0633: Per-city pipeline status for admin dashboard — seed/refresh/AI/Bouncer/Score/Photos row counts + last-activity timestamps. Powers SignalLibraryPage.jsx CityPipelineHistory.';
