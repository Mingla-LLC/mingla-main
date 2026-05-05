-- ═══════════════════════════════════════════════════════════════════════════════
-- Split admin_pool_stats_overview into per-section RPCs
--
-- The monolith ran 7 queries sequentially (78s + 10s + timeout = >2min).
-- Now each section has its own fast RPC, lazy-loaded from the UI.
--
-- Target times at 53K places / 6.5K cards:
--   admin_photo_pool_summary         < 1s   (was 78s — eliminated JSONB parse)
--   admin_photo_pool_categories      < 1.5s (unchanged query, just isolated)
--   admin_photo_pool_locations       < 1.5s (was 10s — eliminated LATERAL N+1)
--   admin_photo_pool_missing_places  < 2s   (was timeout — dropped impressions join)
--   admin_photo_pool_refresh_health  < 2s   (was 2s — unchanged, just isolated)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Index: support admin queries that join impressions by card ──────────────
CREATE INDEX IF NOT EXISTS idx_impressions_card_pool_id
  ON public.user_card_impressions (card_pool_id);

-- ─── RPC 1: admin_photo_pool_summary ────────────────────────────────────────
-- Always loaded on page open. Provides stat cards + cost alert.
-- Target: <1s at 100K places
CREATE OR REPLACE FUNCTION public.admin_photo_pool_summary()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_total_places BIGINT;
  v_with_photos BIGINT;
  v_missing_photos BIGINT;
  v_coverage_pct NUMERIC;
  v_config_threshold NUMERIC;
  v_config_avg_impressions NUMERIC;
  v_config_photo_cost NUMERIC;
  v_daily_cost NUMERIC;
  v_recent_backfill_cost NUMERIC;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  -- Load config
  SELECT COALESCE((SELECT (value)::numeric FROM admin_config WHERE key = 'cost_alert_threshold_monthly_usd'), 50) INTO v_config_threshold;
  SELECT COALESCE((SELECT (value)::numeric FROM admin_config WHERE key = 'avg_impressions_per_place_per_day'), 2.5) INTO v_config_avg_impressions;
  SELECT COALESCE((SELECT (value)::numeric FROM admin_config WHERE key = 'google_photo_cost_per_view'), 0.007) INTO v_config_photo_cost;

  -- Photo health: three fast COUNTs, NO jsonb_array_length()
  -- Uses idx_place_pool_needs_photos partial index for missing_photos count.
  SELECT COUNT(*) INTO v_total_places
  FROM place_pool WHERE is_active = true;

  SELECT COUNT(*) INTO v_with_photos
  FROM place_pool
  WHERE is_active = true
    AND stored_photo_urls IS NOT NULL
    AND array_length(stored_photo_urls, 1) > 0;

  -- Missing = has Google photo refs but no stored photos yet
  -- Uses idx_place_pool_needs_photos: (created_at) WHERE is_active AND stored_photo_urls IS NULL AND photos IS NOT NULL
  SELECT COUNT(*) INTO v_missing_photos
  FROM place_pool
  WHERE is_active = true
    AND stored_photo_urls IS NULL
    AND photos IS NOT NULL
    AND photos != '[]'::jsonb;

  v_coverage_pct := CASE WHEN v_total_places > 0
    THEN ROUND((v_with_photos::numeric / v_total_places * 100), 1)
    ELSE 0 END;

  v_daily_cost := v_missing_photos * v_config_avg_impressions * v_config_photo_cost;

  -- Cost monitor
  SELECT COALESCE(SUM(estimated_cost_usd), 0)
  INTO v_recent_backfill_cost
  FROM admin_backfill_log
  WHERE created_at >= now() - INTERVAL '30 days';

  RETURN jsonb_build_object(
    'photo_health', jsonb_build_object(
      'total_places', v_total_places,
      'with_photos', v_with_photos,
      'missing_photos', v_missing_photos,
      'coverage_pct', v_coverage_pct,
      'estimated_monthly_cost_usd', ROUND(v_daily_cost * 30, 2)
    ),
    'cost_monitor', jsonb_build_object(
      'estimated_daily_cost_usd', ROUND(v_daily_cost, 4),
      'estimated_monthly_cost_usd', ROUND(v_daily_cost * 30, 2),
      'recent_backfill_cost_usd', ROUND(v_recent_backfill_cost, 2),
      'alert_threshold_monthly_usd', v_config_threshold,
      'is_over_threshold', (v_daily_cost * 30) > v_config_threshold
    )
  );
END;
$$;

-- ─── RPC 2: admin_photo_pool_categories ─────────────────────────────────────
-- Loaded when Categories tab is opened.
-- Target: <1.5s at 10K cards
CREATE OR REPLACE FUNCTION public.admin_photo_pool_categories()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_result JSONB;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(cat_stats)::jsonb ORDER BY cat_stats.slug), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      category AS slug,
      COUNT(*) AS total_cards,
      COUNT(*) FILTER (WHERE image_url IS NOT NULL AND image_url != '') AS total_with_photos,
      COUNT(DISTINCT (ROUND(lat::numeric, 2), ROUND(lng::numeric, 2))) AS location_bucket_count,
      CASE
        WHEN COUNT(*) >= 50 AND COUNT(DISTINCT (ROUND(lat::numeric, 2), ROUND(lng::numeric, 2))) >= 5 THEN 'green'
        WHEN COUNT(*) >= 20 OR COUNT(DISTINCT (ROUND(lat::numeric, 2), ROUND(lng::numeric, 2))) >= 2 THEN 'yellow'
        ELSE 'red'
      END AS health
    FROM card_pool
    WHERE is_active = true
    GROUP BY category
  ) cat_stats;

  RETURN v_result;
END;
$$;

-- ─── RPC 3: admin_photo_pool_locations ──────────────────────────────────────
-- Loaded when Locations tab is opened. Single-pass GROUP BY, no LATERAL.
-- Target: <1.5s at 10K cards (was 10s with LATERAL N+1)
CREATE OR REPLACE FUNCTION public.admin_photo_pool_locations()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_result JSONB;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(loc_stats)::jsonb ORDER BY loc_stats.total_cards ASC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      lat_bucket,
      lng_bucket,
      SUM(cnt)::int AS total_cards,
      ROUND(
        SUM(cnt) FILTER (WHERE photo_cnt > 0)::numeric
        / GREATEST(SUM(cnt), 1) * 100, 1
      ) AS photo_coverage_pct,
      jsonb_object_agg(category, cnt) AS category_breakdown
    FROM (
      SELECT
        ROUND(lat::numeric, 2) AS lat_bucket,
        ROUND(lng::numeric, 2) AS lng_bucket,
        category,
        COUNT(*) AS cnt,
        COUNT(*) FILTER (WHERE image_url IS NOT NULL AND image_url != '') AS photo_cnt
      FROM card_pool
      WHERE is_active = true
      GROUP BY ROUND(lat::numeric, 2), ROUND(lng::numeric, 2), category
    ) bucketed
    GROUP BY lat_bucket, lng_bucket
    ORDER BY SUM(cnt) ASC
    LIMIT 200
  ) loc_stats;

  RETURN v_result;
END;
$$;

-- ─── RPC 4: admin_photo_pool_missing_places ─────────────────────────────────
-- Loaded when Health tab is opened. Paginated, no impressions join.
-- Target: <2s at 50K missing places (was >2min timeout)
CREATE OR REPLACE FUNCTION public.admin_photo_pool_missing_places(
  p_limit INT DEFAULT 200,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_total BIGINT;
  v_rows JSONB;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  -- Total count (uses idx_place_pool_needs_photos partial index)
  SELECT COUNT(*) INTO v_total
  FROM place_pool
  WHERE is_active = true
    AND stored_photo_urls IS NULL
    AND photos IS NOT NULL
    AND photos != '[]'::jsonb;

  -- Paginated rows — LEFT JOIN card_pool only, no impressions
  SELECT COALESCE(jsonb_agg(row_to_json(mp)::jsonb), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      pp.id AS place_pool_id,
      pp.google_place_id,
      pp.name,
      pp.primary_type,
      COUNT(cp.id)::int AS card_count
    FROM place_pool pp
    LEFT JOIN card_pool cp ON cp.place_pool_id = pp.id AND cp.is_active = true
    WHERE pp.is_active = true
      AND pp.stored_photo_urls IS NULL
      AND pp.photos IS NOT NULL
      AND pp.photos != '[]'::jsonb
    GROUP BY pp.id, pp.google_place_id, pp.name, pp.primary_type
    ORDER BY COUNT(cp.id) DESC, pp.name ASC
    LIMIT p_limit OFFSET p_offset
  ) mp;

  RETURN jsonb_build_object(
    'total_missing', v_total,
    'rows', v_rows
  );
END;
$$;

-- ─── RPC 5: admin_photo_pool_refresh_health ─────────────────────────────────
-- Loaded when Place Refresh tab is opened.
-- Target: <2s at 53K places
CREATE OR REPLACE FUNCTION public.admin_photo_pool_refresh_health()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_rh_total_active BIGINT;
  v_rh_stale_7d BIGINT;
  v_rh_stale_30d BIGINT;
  v_rh_recently_served_stale BIGINT;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE is_active),
    COUNT(*) FILTER (WHERE is_active
      AND last_detail_refresh < now() - interval '7 days'),
    COUNT(*) FILTER (WHERE is_active
      AND last_detail_refresh < now() - interval '30 days')
  INTO v_rh_total_active, v_rh_stale_7d, v_rh_stale_30d
  FROM place_pool;

  -- Recently served AND stale (uses new idx_impressions_card_pool_id)
  SELECT COUNT(DISTINCT pp.id)
  INTO v_rh_recently_served_stale
  FROM place_pool pp
  JOIN card_pool cp ON cp.place_pool_id = pp.id AND cp.is_active = true
  JOIN user_card_impressions uci ON uci.card_pool_id = cp.id
  WHERE pp.is_active = true
    AND pp.last_detail_refresh < now() - interval '7 days'
    AND uci.created_at > now() - interval '7 days';

  RETURN jsonb_build_object(
    'total_active_places', v_rh_total_active,
    'stale_7d', COALESCE(v_rh_stale_7d, 0),
    'stale_30d', COALESCE(v_rh_stale_30d, 0),
    'recently_served_and_stale', COALESCE(v_rh_recently_served_stale, 0),
    'refresh_cost_recently_served_usd', ROUND(COALESCE(v_rh_recently_served_stale, 0) * 0.005, 2),
    'refresh_cost_all_stale_usd', ROUND(COALESCE(v_rh_stale_7d, 0) * 0.005, 2)
  );
END;
$$;

-- ─── Deprecation note ───────────────────────────────────────────────────────
-- admin_pool_stats_overview() is no longer called by the UI.
-- Kept for one release cycle as safety net. Drop in next cleanup pass.
-- DROP FUNCTION IF EXISTS public.admin_pool_stats_overview();
