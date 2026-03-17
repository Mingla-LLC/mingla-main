-- Migration: 20260317000003_admin_place_refresh.sql
-- Adds 'place_refresh' to admin_backfill_log operation_type, adds refresh_health
-- to admin_pool_stats_overview, and creates admin_trigger_place_refresh RPC.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 0. Ensure dependent columns exist
-- ═══════════════════════════════════════════════════════════════════════════════

-- place_pool.last_detail_refresh — used by refresh_health queries
ALTER TABLE public.place_pool
  ADD COLUMN IF NOT EXISTS last_detail_refresh TIMESTAMPTZ;

-- admin_backfill_log.place_ids — used by admin_trigger_place_refresh to store resolved IDs
ALTER TABLE public.admin_backfill_log
  ADD COLUMN IF NOT EXISTS place_ids UUID[];

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Update operation_type CHECK constraint
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.admin_backfill_log
  DROP CONSTRAINT IF EXISTS admin_backfill_log_operation_type_check;

ALTER TABLE public.admin_backfill_log
  ADD CONSTRAINT admin_backfill_log_operation_type_check
  CHECK (operation_type IN ('photo_backfill', 'category_fill', 'place_refresh'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Update admin_pool_stats_overview to include refresh_health
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_pool_stats_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_photo_health JSONB;
  v_categories JSONB;
  v_location_buckets JSONB;
  v_cost_monitor JSONB;
  v_missing_places JSONB;
  v_refresh_health JSONB;
  v_config_threshold NUMERIC;
  v_config_avg_impressions NUMERIC;
  v_config_photo_cost NUMERIC;
  v_total_places BIGINT;
  v_with_photos BIGINT;
  v_missing_photos BIGINT;
  v_coverage_pct NUMERIC;
  v_recent_backfill_cost NUMERIC;
  v_daily_cost NUMERIC;
  -- refresh health vars
  v_rh_total_active BIGINT;
  v_rh_stale_7d BIGINT;
  v_rh_stale_30d BIGINT;
  v_rh_recently_served_stale BIGINT;
BEGIN
  -- Admin check
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  -- Load config
  SELECT COALESCE((SELECT (value)::numeric FROM admin_config WHERE key = 'cost_alert_threshold_monthly_usd'), 50) INTO v_config_threshold;
  SELECT COALESCE((SELECT (value)::numeric FROM admin_config WHERE key = 'avg_impressions_per_place_per_day'), 2.5) INTO v_config_avg_impressions;
  SELECT COALESCE((SELECT (value)::numeric FROM admin_config WHERE key = 'google_photo_cost_per_view'), 0.007) INTO v_config_photo_cost;

  -- Photo health
  SELECT
    COUNT(*) FILTER (WHERE is_active),
    COUNT(*) FILTER (WHERE is_active AND stored_photo_urls IS NOT NULL AND array_length(stored_photo_urls, 1) > 0),
    COUNT(*) FILTER (WHERE is_active
      AND (stored_photo_urls IS NULL OR array_length(stored_photo_urls, 1) IS NULL)
      AND photos IS NOT NULL
      AND jsonb_array_length(photos) > 0)
  INTO v_total_places, v_with_photos, v_missing_photos
  FROM place_pool;

  v_coverage_pct := CASE WHEN v_total_places > 0
    THEN ROUND((v_with_photos::numeric / v_total_places * 100), 1)
    ELSE 0 END;

  v_daily_cost := v_missing_photos * v_config_avg_impressions * v_config_photo_cost;

  v_photo_health := jsonb_build_object(
    'total_places', v_total_places,
    'with_photos', v_with_photos,
    'missing_photos', v_missing_photos,
    'coverage_pct', v_coverage_pct,
    'estimated_monthly_cost_usd', ROUND(v_daily_cost * 30, 2)
  );

  -- Categories
  SELECT COALESCE(jsonb_agg(row_to_json(cat_stats)::jsonb ORDER BY cat_stats.slug), '[]'::jsonb)
  INTO v_categories
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

  -- Location buckets
  SELECT COALESCE(jsonb_agg(row_to_json(loc_stats)::jsonb ORDER BY loc_stats.total_cards ASC), '[]'::jsonb)
  INTO v_location_buckets
  FROM (
    SELECT
      b.lat_bucket,
      b.lng_bucket,
      b.total_cards,
      b.photo_coverage_pct,
      COALESCE(cb.category_breakdown, '{}'::jsonb) AS category_breakdown
    FROM (
      SELECT
        ROUND(lat::numeric, 2) AS lat_bucket,
        ROUND(lng::numeric, 2) AS lng_bucket,
        COUNT(*) AS total_cards,
        ROUND(
          COUNT(*) FILTER (WHERE image_url IS NOT NULL AND image_url != '')::numeric
          / GREATEST(COUNT(*), 1) * 100, 1
        ) AS photo_coverage_pct
      FROM card_pool
      WHERE is_active = true
      GROUP BY ROUND(lat::numeric, 2), ROUND(lng::numeric, 2)
    ) b
    LEFT JOIN LATERAL (
      SELECT jsonb_object_agg(cg.category, cg.cnt) AS category_breakdown
      FROM (
        SELECT category, COUNT(*) AS cnt
        FROM card_pool
        WHERE is_active = true
          AND ROUND(lat::numeric, 2) = b.lat_bucket
          AND ROUND(lng::numeric, 2) = b.lng_bucket
        GROUP BY category
      ) cg
    ) cb ON true
    ORDER BY b.total_cards ASC
    LIMIT 200
  ) loc_stats;

  -- Cost monitor
  SELECT COALESCE(SUM(estimated_cost_usd), 0)
  INTO v_recent_backfill_cost
  FROM admin_backfill_log
  WHERE created_at >= now() - INTERVAL '30 days';

  v_cost_monitor := jsonb_build_object(
    'estimated_daily_cost_usd', ROUND(v_daily_cost, 4),
    'estimated_monthly_cost_usd', ROUND(v_daily_cost * 30, 2),
    'recent_backfill_cost_usd', ROUND(v_recent_backfill_cost, 2),
    'alert_threshold_monthly_usd', v_config_threshold,
    'is_over_threshold', (v_daily_cost * 30) > v_config_threshold
  );

  -- Missing places (top 200 by impression cost)
  SELECT COALESCE(jsonb_agg(row_to_json(mp)::jsonb), '[]'::jsonb)
  INTO v_missing_places
  FROM (
    SELECT
      pp.id AS place_pool_id,
      pp.google_place_id,
      pp.name,
      pp.primary_type,
      COALESCE(jsonb_array_length(pp.photos), 0) AS photo_refs_count,
      COUNT(DISTINCT cp.id) AS card_count,
      COALESCE(SUM(imp.impression_count), 0) AS total_impressions
    FROM place_pool pp
    LEFT JOIN card_pool cp ON cp.place_pool_id = pp.id AND cp.is_active = true
    LEFT JOIN (
      SELECT card_pool_id, COUNT(*) AS impression_count
      FROM user_card_impressions
      GROUP BY card_pool_id
    ) imp ON imp.card_pool_id = cp.id
    WHERE pp.is_active = true
      AND (pp.stored_photo_urls IS NULL OR array_length(pp.stored_photo_urls, 1) IS NULL)
      AND pp.photos IS NOT NULL
      AND jsonb_array_length(pp.photos) > 0
    GROUP BY pp.id, pp.google_place_id, pp.name, pp.primary_type, pp.photos
    ORDER BY COALESCE(SUM(imp.impression_count), 0) DESC
    LIMIT 200
  ) mp;

  -- ═══════════════════════════════════════════════════════════════════════════════
  -- Refresh health stats (NEW)
  -- ═══════════════════════════════════════════════════════════════════════════════

  SELECT
    COUNT(*) FILTER (WHERE is_active),
    COUNT(*) FILTER (WHERE is_active
      AND last_detail_refresh < now() - interval '7 days'),
    COUNT(*) FILTER (WHERE is_active
      AND last_detail_refresh < now() - interval '30 days')
  INTO v_rh_total_active, v_rh_stale_7d, v_rh_stale_30d
  FROM place_pool;

  -- Recently served AND stale
  SELECT COUNT(DISTINCT pp.id)
  INTO v_rh_recently_served_stale
  FROM place_pool pp
  JOIN card_pool cp ON cp.place_pool_id = pp.id AND cp.is_active = true
  JOIN user_card_impressions uci ON uci.card_pool_id = cp.id
  WHERE pp.is_active = true
    AND pp.last_detail_refresh < now() - interval '7 days'
    AND uci.created_at > now() - interval '7 days';

  v_refresh_health := jsonb_build_object(
    'total_active_places', v_rh_total_active,
    'stale_7d', COALESCE(v_rh_stale_7d, 0),
    'stale_30d', COALESCE(v_rh_stale_30d, 0),
    'recently_served_and_stale', COALESCE(v_rh_recently_served_stale, 0),
    'refresh_cost_recently_served_usd', ROUND(COALESCE(v_rh_recently_served_stale, 0) * 0.005, 2),
    'refresh_cost_all_stale_usd', ROUND(COALESCE(v_rh_stale_7d, 0) * 0.005, 2)
  );

  RETURN jsonb_build_object(
    'photo_health', v_photo_health,
    'categories', v_categories,
    'location_buckets', v_location_buckets,
    'cost_monitor', v_cost_monitor,
    'missing_places', v_missing_places,
    'refresh_health', v_refresh_health
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. RPC: admin_trigger_place_refresh
-- Creates a place_refresh backfill log entry. The actual refresh is executed
-- by the admin-refresh-places edge function (separate deployment).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_trigger_place_refresh(
  p_mode TEXT,                         -- 'recently_served', 'all_stale', or 'selected'
  p_place_pool_ids UUID[] DEFAULT NULL,
  p_stale_threshold_hours INTEGER DEFAULT 168,  -- 7 days
  p_served_within_days INTEGER DEFAULT 7
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_user_id UUID;
  v_log_id UUID;
  v_total INTEGER;
  v_estimated_cost NUMERIC;
  v_existing_id UUID;
  v_resolved_ids UUID[];
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  v_user_id := auth.uid();

  -- Validate mode
  IF p_mode NOT IN ('recently_served', 'all_stale', 'selected') THEN
    RAISE EXCEPTION 'Invalid mode: must be recently_served, all_stale, or selected';
  END IF;

  -- Validate stale_threshold_hours
  IF p_stale_threshold_hours < 1 OR p_stale_threshold_hours > 8760 THEN
    RAISE EXCEPTION 'stale_threshold_hours must be between 1 and 8760';
  END IF;

  -- Validate served_within_days
  IF p_served_within_days < 1 OR p_served_within_days > 90 THEN
    RAISE EXCEPTION 'served_within_days must be between 1 and 90';
  END IF;

  -- Concurrent guard: check for already-running place_refresh
  SELECT id INTO v_existing_id
  FROM admin_backfill_log
  WHERE operation_type = 'place_refresh'
    AND status IN ('pending', 'running')
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'backfill_log_id', v_existing_id,
      'status', 'already_running',
      'message', 'A place refresh is already in progress'
    );
  END IF;

  -- Resolve target places based on mode
  IF p_mode = 'recently_served' THEN
    SELECT array_agg(sub.id), COUNT(*)
    INTO v_resolved_ids, v_total
    FROM (
      SELECT DISTINCT pp.id
      FROM place_pool pp
      JOIN card_pool cp ON cp.place_pool_id = pp.id AND cp.is_active = true
      JOIN user_card_impressions uci ON uci.card_pool_id = cp.id
      WHERE pp.is_active = true
        AND pp.last_detail_refresh < now() - (p_stale_threshold_hours || ' hours')::interval
        AND uci.created_at > now() - (p_served_within_days || ' days')::interval
      ORDER BY pp.id
      LIMIT 500
    ) sub;

  ELSIF p_mode = 'all_stale' THEN
    SELECT array_agg(sub.id), COUNT(*)
    INTO v_resolved_ids, v_total
    FROM (
      SELECT id
      FROM place_pool
      WHERE is_active = true
        AND last_detail_refresh < now() - (p_stale_threshold_hours || ' hours')::interval
      ORDER BY last_detail_refresh ASC
      LIMIT 500
    ) sub;

  ELSIF p_mode = 'selected' THEN
    IF p_place_pool_ids IS NULL OR array_length(p_place_pool_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'place_pool_ids required for selected mode';
    END IF;

    SELECT array_agg(id), COUNT(*)
    INTO v_resolved_ids, v_total
    FROM place_pool
    WHERE id = ANY(p_place_pool_ids)
      AND is_active = true;
  END IF;

  -- Handle zero places
  IF v_total IS NULL OR v_total = 0 THEN
    RETURN jsonb_build_object(
      'backfill_log_id', NULL,
      'total_places', 0,
      'estimated_cost_usd', 0,
      'status', 'nothing_to_do',
      'message', 'No places found matching the refresh criteria'
    );
  END IF;

  -- Cost estimate: $0.005 per Place Details call
  v_estimated_cost := v_total * 0.005;

  INSERT INTO admin_backfill_log (
    operation_type, triggered_by, status, place_ids,
    total_places, estimated_cost_usd, started_at
  ) VALUES (
    'place_refresh', v_user_id, 'pending', v_resolved_ids,
    v_total, v_estimated_cost, now()
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'backfill_log_id', v_log_id,
    'total_places', v_total,
    'estimated_cost_usd', ROUND(v_estimated_cost, 2),
    'status', 'pending'
  );
END;
$$;
