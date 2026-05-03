-- ORCH-0700 Phase 2.D MANDATORY BACKUP — admin RPCs that read admin_place_pool_mv
-- Captured 2026-05-03 BEFORE matview rebuild (Migration 20260503000004)
-- Restore command: psql -f this_file.sql against the same project
-- See: Mingla_Artifacts/specs/SPEC_ORCH-0700_MOVIES_CINEMAS_ONLY_AND_PARTIAL_DECOMMISSION.md §3.A.A5

CREATE OR REPLACE FUNCTION public.admin_place_category_breakdown(p_city_id uuid, p_country_code text)
RETURNS TABLE(category text, place_count bigint, photo_pct integer, avg_rating numeric)
LANGUAGE plpgsql SECURITY DEFINER STABLE
AS $func$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    mv.primary_category AS category,
    COUNT(*)::BIGINT AS place_count,
    CASE WHEN COUNT(*) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE mv.has_photos) * 100.0 / COUNT(*))::INTEGER
      ELSE 0
    END AS photo_pct,
    ROUND((AVG(mv.rating) FILTER (WHERE mv.rating IS NOT NULL))::NUMERIC, 1) AS avg_rating
  FROM admin_place_pool_mv mv
  WHERE mv.is_active
    AND mv.is_servable = true
    AND mv.primary_category <> 'uncategorized'
    AND (p_city_id IS NULL OR mv.city_id = p_city_id)
    AND (p_country_code IS NULL OR mv.country_code = p_country_code)
  GROUP BY mv.primary_category
  ORDER BY COUNT(*) DESC;
END;
$func$;

CREATE OR REPLACE FUNCTION public.admin_place_city_overview(p_country_code text)
RETURNS TABLE(city_id uuid, city_name text, is_servable_places bigint, photo_pct integer, bounced_pct integer, category_coverage integer, avg_rating numeric)
LANGUAGE plpgsql SECURITY DEFINER STABLE
AS $func$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  WITH per_city AS (
    SELECT
      mv.city_id,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)                                      AS is_servable_places,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.has_photos)                    AS servable_with_photos,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable IS NOT NULL)                                 AS bouncer_judged_count,
      COUNT(*) FILTER (WHERE mv.is_active)                                                                AS active_total,
      COUNT(DISTINCT mv.primary_category) FILTER (
        WHERE mv.is_active AND mv.is_servable = true AND mv.primary_category <> 'uncategorized'
      )                                                                                                    AS category_coverage,
      AVG(mv.rating) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.rating IS NOT NULL)       AS avg_rating
    FROM admin_place_pool_mv mv
    WHERE mv.country_code = p_country_code
    GROUP BY mv.city_id
  )
  SELECT
    sc.id AS city_id,
    sc.name AS city_name,
    COALESCE(pc.is_servable_places, 0)::BIGINT AS is_servable_places,
    CASE WHEN COALESCE(pc.is_servable_places, 0) > 0
      THEN ROUND(pc.servable_with_photos * 100.0 / pc.is_servable_places)::INTEGER ELSE 0
    END AS photo_pct,
    CASE WHEN COALESCE(pc.active_total, 0) > 0
      THEN ROUND(pc.bouncer_judged_count * 100.0 / pc.active_total)::INTEGER ELSE 0
    END AS bounced_pct,
    COALESCE(pc.category_coverage, 0)::INTEGER AS category_coverage,
    ROUND(pc.avg_rating::NUMERIC, 1) AS avg_rating
  FROM seeding_cities sc
  LEFT JOIN per_city pc ON pc.city_id = sc.id
  WHERE sc.country_code = p_country_code
  ORDER BY COALESCE(pc.is_servable_places, 0) DESC;
END;
$func$;

CREATE OR REPLACE FUNCTION public.admin_place_country_overview()
RETURNS TABLE(country_code text, country_name text, city_count bigint, is_servable_places bigint, photo_pct integer, bounced_pct integer, category_coverage integer)
LANGUAGE plpgsql SECURITY DEFINER STABLE
AS $func$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  WITH per_country AS (
    SELECT
      mv.country_code,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)                           AS is_servable_places,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.has_photos)         AS servable_with_photos,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable IS NOT NULL)                      AS bouncer_judged_count,
      COUNT(*) FILTER (WHERE mv.is_active)                                                     AS active_total,
      COUNT(DISTINCT mv.primary_category) FILTER (
        WHERE mv.is_active AND mv.is_servable = true AND mv.primary_category <> 'uncategorized'
      )                                                                                        AS category_coverage
    FROM admin_place_pool_mv mv
    WHERE mv.country_code IS NOT NULL
    GROUP BY mv.country_code
  ),
  countries AS (
    SELECT DISTINCT country_code, country FROM seeding_cities
  ),
  city_counts AS (
    SELECT sc.country_code, COUNT(*)::bigint AS city_count
    FROM seeding_cities sc
    GROUP BY sc.country_code
  )
  SELECT
    c.country_code,
    c.country AS country_name,
    cc.city_count,
    COALESCE(pc.is_servable_places, 0) AS is_servable_places,
    CASE WHEN COALESCE(pc.is_servable_places, 0) > 0
      THEN ROUND(pc.servable_with_photos * 100.0 / pc.is_servable_places)::INTEGER
      ELSE 0
    END AS photo_pct,
    CASE WHEN COALESCE(pc.active_total, 0) > 0
      THEN ROUND(pc.bouncer_judged_count * 100.0 / pc.active_total)::INTEGER
      ELSE 0
    END AS bounced_pct,
    COALESCE(pc.category_coverage, 0)::INTEGER AS category_coverage
  FROM countries c
  JOIN city_counts cc ON cc.country_code = c.country_code
  LEFT JOIN per_country pc ON pc.country_code = c.country_code
  ORDER BY COALESCE(pc.is_servable_places, 0) DESC;
END;
$func$;

CREATE OR REPLACE FUNCTION public.admin_place_photo_stats(p_city_id uuid)
RETURNS TABLE(total_places bigint, with_photos bigint, without_photos bigint)
LANGUAGE plpgsql SECURITY DEFINER STABLE
AS $func$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total_places,
    COUNT(*) FILTER (WHERE mv.has_photos)::BIGINT AS with_photos,
    COUNT(*) FILTER (WHERE NOT mv.has_photos)::BIGINT AS without_photos
  FROM admin_place_pool_mv mv
  WHERE mv.city_id = p_city_id
    AND mv.is_active
    AND mv.is_servable = true;
END;
$func$;

CREATE OR REPLACE FUNCTION public.admin_place_pool_city_list(p_country text)
RETURNS TABLE(city_name text, approved_places bigint, with_photos bigint, existing_cards bigint, ready_to_generate bigint)
LANGUAGE plpgsql SECURITY DEFINER STABLE
AS $func$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active')
  THEN RAISE EXCEPTION 'Not authorized'; END IF;

  -- ORCH-0640: existing_cards + ready_to_generate degrade to 0 (card_pool archived).
  -- "approved_places" renamed semantics: now means "Bouncer-servable places".
  RETURN QUERY
  SELECT
    COALESCE(mv.pp_city, 'Unknown City') AS city_name,
    COUNT(*) FILTER (WHERE mv.is_servable = TRUE) AS approved_places,
    COUNT(*) FILTER (WHERE mv.is_servable = TRUE AND mv.has_photos) AS with_photos,
    0::bigint AS existing_cards,
    0::bigint AS ready_to_generate
  FROM admin_place_pool_mv mv
  WHERE mv.is_active = TRUE
    AND mv.pp_country = p_country
  GROUP BY mv.pp_city
  ORDER BY approved_places DESC;
END;
$func$;

CREATE OR REPLACE FUNCTION public.admin_place_pool_country_list()
RETURNS TABLE(country text, approved_places bigint, with_photos bigint, existing_cards bigint)
LANGUAGE plpgsql SECURITY DEFINER STABLE
AS $func$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active')
  THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    COALESCE(mv.pp_country, 'Unknown') AS country,
    COUNT(*) FILTER (WHERE mv.is_servable = TRUE) AS approved_places,
    COUNT(*) FILTER (WHERE mv.is_servable = TRUE AND mv.has_photos) AS with_photos,
    0::bigint AS existing_cards
  FROM admin_place_pool_mv mv
  WHERE mv.is_active = TRUE
  GROUP BY mv.pp_country
  ORDER BY approved_places DESC;
END;
$func$;

CREATE OR REPLACE FUNCTION public.admin_place_pool_overview(p_city_id uuid, p_country_code text)
RETURNS TABLE(total_places bigint, active_places bigint, is_servable_places bigint, with_photos bigint, photo_pct integer, bouncer_judged_count bigint, is_servable_count bigint, bouncer_excluded_count bigint, bouncer_pending_count bigint, distinct_categories integer)
LANGUAGE plpgsql SECURITY DEFINER STABLE
AS $func$
DECLARE
  v_total BIGINT;
  v_active BIGINT;
  v_servable BIGINT;
  v_with_photos BIGINT;
  v_judged BIGINT;
  v_excluded BIGINT;
  v_pending BIGINT;
  v_categories INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  -- City-scoped: single narrow query. MV's city_id index narrows to ~5k rows max.
  IF p_city_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      COUNT(*)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.has_photos)::BIGINT,
      CASE WHEN COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true) > 0
        THEN ROUND(
          COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.has_photos) * 100.0
          / COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)
        )::INTEGER
        ELSE 0 END,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable IS NOT NULL)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = false)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable IS NULL)::BIGINT,
      COUNT(DISTINCT mv.primary_category) FILTER (
        WHERE mv.is_active AND mv.is_servable = true AND mv.primary_category <> 'uncategorized'
      )::INTEGER
    FROM admin_place_pool_mv mv
    WHERE mv.city_id = p_city_id;
    RETURN;
  END IF;

  -- Country-scoped: single narrow query. MV's country_code index narrows to one country's rows.
  IF p_country_code IS NOT NULL THEN
    RETURN QUERY
    SELECT
      COUNT(*)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.has_photos)::BIGINT,
      CASE WHEN COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true) > 0
        THEN ROUND(
          COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true AND mv.has_photos) * 100.0
          / COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)
        )::INTEGER
        ELSE 0 END,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable IS NOT NULL)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = true)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable = false)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.is_servable IS NULL)::BIGINT,
      COUNT(DISTINCT mv.primary_category) FILTER (
        WHERE mv.is_active AND mv.is_servable = true AND mv.primary_category <> 'uncategorized'
      )::INTEGER
    FROM admin_place_pool_mv mv
    WHERE mv.country_code = p_country_code;
    RETURN;
  END IF;

  -- Global scope: 8 narrow subqueries, each eligible for Index-Only Scan via mv_country_active_servable index.
  SELECT COUNT(*) INTO v_total FROM admin_place_pool_mv;
  SELECT COUNT(*) INTO v_active FROM admin_place_pool_mv WHERE is_active;
  SELECT COUNT(*) INTO v_servable FROM admin_place_pool_mv WHERE is_active AND is_servable = true;
  SELECT COUNT(*) INTO v_with_photos FROM admin_place_pool_mv
    WHERE is_active AND is_servable = true AND has_photos;
  SELECT COUNT(*) INTO v_judged FROM admin_place_pool_mv WHERE is_active AND is_servable IS NOT NULL;
  SELECT COUNT(*) INTO v_excluded FROM admin_place_pool_mv WHERE is_active AND is_servable = false;
  SELECT COUNT(*) INTO v_pending FROM admin_place_pool_mv WHERE is_active AND is_servable IS NULL;
  SELECT COUNT(DISTINCT primary_category)::INTEGER INTO v_categories
    FROM admin_place_pool_mv
    WHERE is_active AND is_servable = true AND primary_category <> 'uncategorized';

  RETURN QUERY SELECT
    v_total,
    v_active,
    v_servable,
    v_with_photos,
    CASE WHEN v_servable > 0 THEN ROUND(v_with_photos * 100.0 / v_servable)::INTEGER ELSE 0 END,
    v_judged,
    v_servable,
    v_excluded,
    v_pending,
    v_categories;
END;
$func$;

CREATE OR REPLACE FUNCTION public.admin_pool_category_health(p_country text, p_city text)
RETURNS TABLE(category text, total_places bigint, active_places bigint, with_photos bigint, photo_pct integer, avg_rating numeric, total_cards bigint, single_cards bigint, curated_cards bigint, places_needing_cards bigint, health text)
LANGUAGE plpgsql SECURITY DEFINER STABLE
AS $func$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active')
  THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  WITH place_stats AS (
    SELECT
      mv.seeding_category,
      COUNT(*) AS total_places,
      COUNT(*) FILTER (WHERE mv.is_active) AS active_places,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.has_photos) AS with_photos,
      ROUND((AVG(mv.rating) FILTER (WHERE mv.rating IS NOT NULL))::NUMERIC, 1) AS avg_rating
    FROM admin_place_pool_mv mv
    WHERE mv.seeding_category IS NOT NULL
      AND (p_country IS NULL OR mv.pp_country = p_country)
      AND (p_city IS NULL OR mv.pp_city = p_city)
    GROUP BY mv.seeding_category
  )
  SELECT
    ps.seeding_category AS category,
    ps.total_places,
    ps.active_places,
    ps.with_photos,
    CASE WHEN ps.active_places > 0
      THEN ROUND(ps.with_photos * 100.0 / ps.active_places)::INTEGER
      ELSE 0 END AS photo_pct,
    ps.avg_rating,
    0::bigint AS total_cards,            -- ORCH-0640: card_pool archived
    0::bigint AS single_cards,
    0::bigint AS curated_cards,
    0::bigint AS places_needing_cards,   -- "needing cards" concept retired
    CASE
      WHEN ps.with_photos >= ps.active_places * 0.8 THEN 'green'
      WHEN ps.with_photos >= ps.active_places * 0.5 THEN 'yellow'
      ELSE 'red'
    END AS health  -- health now measures photo coverage (the actual G3 gate)
  FROM place_stats ps
  ORDER BY ps.active_places DESC;
END;
$func$;

CREATE OR REPLACE FUNCTION public.admin_refresh_place_pool_mv()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_row_count bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_place_pool_mv;

  SELECT COUNT(*) INTO v_row_count FROM public.admin_place_pool_mv;

  RETURN jsonb_build_object(
    'success', true,
    'row_count', v_row_count,
    'duration_ms', ROUND(EXTRACT(EPOCH FROM clock_timestamp() - v_started) * 1000)
  );
END;
$func$;

CREATE OR REPLACE FUNCTION public.cron_refresh_admin_place_pool_mv()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
BEGIN
  -- Refresh the MV concurrently (reads not blocked during refresh)
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_place_pool_mv;

  -- Update planner statistics so aggregate RPCs pick good plans.
  -- Without this, admin_place_category_breakdown and similar drift to slow plans
  -- over time as underlying place_pool churn makes the planner's cached stats stale.
  ANALYZE public.admin_place_pool_mv;
END;
$func$;

