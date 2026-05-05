-- ORCH-0671 ROLLBACK — DO NOT APPLY AUTOMATICALLY.
--
-- This file exists for `supabase db reset` recovery scenarios only. It is
-- timestamped intentionally late so it stays unapplied during normal
-- `supabase db push` operations. Apply manually via the Supabase dashboard
-- SQL editor IF the ORCH-0671 cutover migration must be undone after the
-- 24-hour soak window has begun.
--
-- This file:
--   1. Restores the 12 RPCs verbatim from their authoritative source migrations.
--      Per spec §3.1 source-migration mapping:
--      • admin_photo_pool_summary           ← 20260405000001 (split_photo_pool_overview)
--      • admin_photo_pool_missing_places    ← 20260425000014 (orch_0640_rewrite_place_admin_rpcs)
--      • admin_photo_pool_categories        ← 20260425000014
--      • admin_photo_pool_locations         ← 20260425000014
--      • admin_photo_pool_refresh_health    ← 20260425000014
--      • admin_pool_category_detail         ← 20260425000014
--      • admin_trigger_backfill             ← 20260317100002 (admin_photo_pool_management)
--      • admin_trigger_category_fill        ← 20260317100002
--      • admin_pool_stats_overview          ← 20260317100002 (was already absent from live DB pre-cutover)
--      • admin_backfill_log_list            ← 20260317100002
--      • admin_backfill_status              ← 20260317100002
--      • admin_backfill_weekly_costs        ← 20260317100002
--   2. Restores the CHECK constraint on admin_backfill_log.operation_type to the
--      original 3-value form ('photo_backfill','category_fill','place_refresh').
--   3. Restores the 4 completed + 2 failed photo_backfill rows from the archive table
--      back into admin_backfill_log. The 17 pending zombies are NOT restored (they
--      were never archived; rollback accepts that loss per spec §3.1).
--   4. Does NOT drop the archive table itself (keeps historical baseline data).
--
-- The orchestrator/operator running this rollback is also expected to
-- `git revert` the ORCH-0671 commit so the source tree is consistent.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- Step R1: Restore CHECK constraint to original 3-value form
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.admin_backfill_log
  DROP CONSTRAINT IF EXISTS admin_backfill_log_operation_type_check;
ALTER TABLE public.admin_backfill_log
  ADD CONSTRAINT admin_backfill_log_operation_type_check
  CHECK (operation_type IN ('photo_backfill', 'category_fill', 'place_refresh'));

-- ──────────────────────────────────────────────────────────────────────────
-- Step R2: Restore archived rows back into main table
-- (4 completed + 2 failed = 6 rows; 17 pending were not archived and are lost.)
-- ──────────────────────────────────────────────────────────────────────────
INSERT INTO public.admin_backfill_log (
  id, operation_type, triggered_by, status, place_ids,
  target_category, target_lat, target_lng, target_radius_m,
  total_places, success_count, failure_count, error_details,
  api_calls_made, estimated_cost_usd,
  started_at, completed_at, created_at, updated_at
)
SELECT
  id, operation_type, triggered_by, status, place_ids,
  target_category, target_lat, target_lng, target_radius_m,
  total_places, success_count, failure_count, error_details,
  api_calls_made, estimated_cost_usd,
  started_at, completed_at, created_at, updated_at
FROM public.admin_backfill_log_archive_orch_0671
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════
-- Step R3: Restore 12 RPCs verbatim from authoritative source migrations
-- ══════════════════════════════════════════════════════════════════════════

-- ─── R3.1 admin_photo_pool_summary (source: 20260405000001) ─────────────────
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

  SELECT COALESCE((SELECT (value)::numeric FROM admin_config WHERE key = 'cost_alert_threshold_monthly_usd'), 50) INTO v_config_threshold;
  SELECT COALESCE((SELECT (value)::numeric FROM admin_config WHERE key = 'avg_impressions_per_place_per_day'), 2.5) INTO v_config_avg_impressions;
  SELECT COALESCE((SELECT (value)::numeric FROM admin_config WHERE key = 'google_photo_cost_per_view'), 0.007) INTO v_config_photo_cost;

  SELECT COUNT(*) INTO v_total_places
  FROM place_pool WHERE is_active = true;

  SELECT COUNT(*) INTO v_with_photos
  FROM place_pool
  WHERE is_active = true
    AND stored_photo_urls IS NOT NULL
    AND array_length(stored_photo_urls, 1) > 0;

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

-- ─── R3.2 admin_photo_pool_categories (source: 20260425000014) ──────────────
CREATE OR REPLACE FUNCTION public.admin_photo_pool_categories()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin BOOLEAN;
  v_result JSONB;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'Forbidden: admin access required'; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(cat_stats)::jsonb ORDER BY cat_stats.slug), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      COALESCE(pp.ai_categories[1], 'uncategorized') AS slug,
      COUNT(*) AS total_cards,
      COUNT(*) FILTER (
        WHERE pp.stored_photo_urls IS NOT NULL
          AND array_length(pp.stored_photo_urls, 1) > 0
          AND NOT (array_length(pp.stored_photo_urls, 1) = 1 AND pp.stored_photo_urls[1] = '__backfill_failed__')
      ) AS total_with_photos,
      COUNT(DISTINCT (ROUND(pp.lat::numeric, 2), ROUND(pp.lng::numeric, 2))) AS location_bucket_count,
      CASE
        WHEN COUNT(*) >= 50 AND COUNT(DISTINCT (ROUND(pp.lat::numeric, 2), ROUND(pp.lng::numeric, 2))) >= 5 THEN 'green'
        WHEN COUNT(*) >= 20 OR COUNT(DISTINCT (ROUND(pp.lat::numeric, 2), ROUND(pp.lng::numeric, 2))) >= 2 THEN 'yellow'
        ELSE 'red'
      END AS health
    FROM place_pool pp
    WHERE pp.is_active = true
    GROUP BY COALESCE(pp.ai_categories[1], 'uncategorized')
  ) cat_stats;

  RETURN v_result;
END;
$function$;

-- ─── R3.3 admin_photo_pool_locations (source: 20260425000014) ───────────────
CREATE OR REPLACE FUNCTION public.admin_photo_pool_locations()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin BOOLEAN;
  v_result JSONB;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'Forbidden: admin access required'; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(loc_stats)::jsonb ORDER BY loc_stats.total_cards ASC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      lat_bucket, lng_bucket,
      SUM(cnt)::int AS total_cards,
      ROUND(SUM(cnt) FILTER (WHERE photo_cnt > 0)::numeric / GREATEST(SUM(cnt), 1) * 100, 1) AS photo_coverage_pct,
      jsonb_object_agg(category, cnt) AS category_breakdown
    FROM (
      SELECT
        ROUND(pp.lat::numeric, 2) AS lat_bucket,
        ROUND(pp.lng::numeric, 2) AS lng_bucket,
        COALESCE(pp.ai_categories[1], 'uncategorized') AS category,
        COUNT(*) AS cnt,
        COUNT(*) FILTER (
          WHERE pp.stored_photo_urls IS NOT NULL
            AND array_length(pp.stored_photo_urls, 1) > 0
            AND NOT (array_length(pp.stored_photo_urls, 1) = 1 AND pp.stored_photo_urls[1] = '__backfill_failed__')
        ) AS photo_cnt
      FROM place_pool pp
      WHERE pp.is_active = true
      GROUP BY ROUND(pp.lat::numeric, 2), ROUND(pp.lng::numeric, 2), COALESCE(pp.ai_categories[1], 'uncategorized')
    ) bucketed
    GROUP BY lat_bucket, lng_bucket
    ORDER BY SUM(cnt) ASC
    LIMIT 200
  ) loc_stats;

  RETURN v_result;
END;
$function$;

-- ─── R3.4 admin_photo_pool_missing_places (source: 20260425000014) ──────────
CREATE OR REPLACE FUNCTION public.admin_photo_pool_missing_places(p_limit integer DEFAULT 200, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin BOOLEAN;
  v_total BIGINT;
  v_rows JSONB;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'Forbidden: admin access required'; END IF;

  SELECT COUNT(*) INTO v_total
  FROM place_pool
  WHERE is_active = true
    AND stored_photo_urls IS NULL
    AND photos IS NOT NULL
    AND photos != '[]'::jsonb;

  SELECT COALESCE(jsonb_agg(row_to_json(mp)::jsonb), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT
      pp.id AS place_pool_id,
      pp.google_place_id,
      pp.name,
      pp.primary_type,
      0::int AS card_count
    FROM place_pool pp
    WHERE pp.is_active = true
      AND pp.stored_photo_urls IS NULL
      AND pp.photos IS NOT NULL
      AND pp.photos != '[]'::jsonb
    ORDER BY pp.name ASC
    LIMIT p_limit OFFSET p_offset
  ) mp;

  RETURN jsonb_build_object('total_missing', v_total, 'rows', v_rows);
END;
$function$;

-- ─── R3.5 admin_photo_pool_refresh_health (source: 20260425000014) ──────────
CREATE OR REPLACE FUNCTION public.admin_photo_pool_refresh_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin BOOLEAN;
  v_rh_total_active BIGINT;
  v_rh_stale_7d BIGINT;
  v_rh_stale_30d BIGINT;
  v_rh_recently_served_stale BIGINT;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'Forbidden: admin access required'; END IF;

  SELECT
    COUNT(*) FILTER (WHERE is_active),
    COUNT(*) FILTER (WHERE is_active AND last_detail_refresh < now() - interval '7 days'),
    COUNT(*) FILTER (WHERE is_active AND last_detail_refresh < now() - interval '30 days')
  INTO v_rh_total_active, v_rh_stale_7d, v_rh_stale_30d
  FROM place_pool;

  SELECT COUNT(DISTINCT pp.id)
  INTO v_rh_recently_served_stale
  FROM place_pool pp
  JOIN engagement_metrics em
    ON em.place_pool_id = pp.id
   AND em.event_kind = 'served'
   AND em.created_at > now() - interval '7 days'
  WHERE pp.is_active = true
    AND pp.last_detail_refresh < now() - interval '7 days';

  RETURN jsonb_build_object(
    'total_active_places', v_rh_total_active,
    'stale_7d', COALESCE(v_rh_stale_7d, 0),
    'stale_30d', COALESCE(v_rh_stale_30d, 0),
    'recently_served_and_stale', COALESCE(v_rh_recently_served_stale, 0),
    'refresh_cost_recently_served_usd', ROUND(COALESCE(v_rh_recently_served_stale, 0) * 0.005, 2),
    'refresh_cost_all_stale_usd', ROUND(COALESCE(v_rh_stale_7d, 0) * 0.005, 2)
  );
END;
$function$;

-- ─── R3.6 admin_pool_category_detail (source: 20260425000014) ───────────────
CREATE OR REPLACE FUNCTION public.admin_pool_category_detail(p_category text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin BOOLEAN;
  v_result JSONB;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'Forbidden: admin access required'; END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(loc)::jsonb ORDER BY loc.card_count DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      ROUND(pp.lat::numeric, 2) AS lat_bucket,
      ROUND(pp.lng::numeric, 2) AS lng_bucket,
      COUNT(*) AS card_count,
      ROUND(AVG(pp.rating)::numeric, 2) AS avg_rating,
      ROUND(
        COUNT(*) FILTER (
          WHERE pp.stored_photo_urls IS NOT NULL
            AND array_length(pp.stored_photo_urls, 1) > 0
            AND NOT (array_length(pp.stored_photo_urls, 1) = 1 AND pp.stored_photo_urls[1] = '__backfill_failed__')
        )::numeric / GREATEST(COUNT(*), 1) * 100, 1
      ) AS photo_coverage_pct
    FROM place_pool pp
    WHERE pp.is_active = true
      AND p_category = ANY(COALESCE(pp.ai_categories, '{}'::text[]))
    GROUP BY ROUND(pp.lat::numeric, 2), ROUND(pp.lng::numeric, 2)
  ) loc;

  RETURN jsonb_build_object(
    'category', p_category,
    'location_buckets', v_result
  );
END;
$function$;

-- ─── R3.7 admin_trigger_backfill (source: 20260317100002) ───────────────────
CREATE OR REPLACE FUNCTION public.admin_trigger_backfill(
  p_mode TEXT,
  p_place_pool_ids UUID[] DEFAULT NULL
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

  IF p_mode = 'all_missing' THEN
    SELECT id INTO v_existing_id
    FROM admin_backfill_log
    WHERE operation_type = 'photo_backfill'
      AND status IN ('pending', 'running')
      AND place_ids IS NULL
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'backfill_log_id', v_existing_id,
        'status', 'already_running',
        'message', 'A backfill for all missing places is already in progress'
      );
    END IF;
  END IF;

  IF p_mode = 'all_missing' THEN
    SELECT array_agg(id), COUNT(*)
    INTO v_resolved_ids, v_total
    FROM place_pool
    WHERE is_active = true
      AND (stored_photo_urls IS NULL OR array_length(stored_photo_urls, 1) IS NULL)
      AND photos IS NOT NULL
      AND jsonb_array_length(photos) > 0;
  ELSIF p_mode = 'selected' THEN
    IF p_place_pool_ids IS NULL OR array_length(p_place_pool_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'place_pool_ids required for selected mode';
    END IF;
    v_resolved_ids := p_place_pool_ids;
    v_total := array_length(p_place_pool_ids, 1);
  ELSE
    RAISE EXCEPTION 'Invalid mode: must be selected or all_missing';
  END IF;

  IF v_total IS NULL OR v_total = 0 THEN
    RETURN jsonb_build_object(
      'backfill_log_id', NULL,
      'total_places', 0,
      'status', 'nothing_to_do',
      'message', 'No places found that need photo backfill'
    );
  END IF;

  v_estimated_cost := v_total * 5 * 0.007;

  INSERT INTO admin_backfill_log (
    operation_type, triggered_by, status, place_ids,
    total_places, estimated_cost_usd, started_at
  ) VALUES (
    'photo_backfill', v_user_id, 'pending', v_resolved_ids,
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

-- ─── R3.8 admin_trigger_category_fill (source: 20260317100002) ──────────────
CREATE OR REPLACE FUNCTION public.admin_trigger_category_fill(
  p_category TEXT,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_radius_m INTEGER DEFAULT 5000,
  p_max_results INTEGER DEFAULT 60
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
  v_nearby_calls INTEGER;
  v_detail_calls INTEGER;
  v_photo_calls INTEGER;
  v_estimated_cost NUMERIC;
  v_valid_categories TEXT[] := ARRAY[
    'nature','first_meet','picnic_park','drink','casual_eats','fine_dining',
    'watch','creative_arts','play','wellness','groceries_flowers','work_business'
  ];
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  v_user_id := auth.uid();

  IF NOT (p_category = ANY(v_valid_categories)) THEN
    RAISE EXCEPTION 'Invalid category: %', p_category;
  END IF;

  IF p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN
    RAISE EXCEPTION 'Invalid coordinates: lat must be -90..90, lng must be -180..180';
  END IF;

  IF p_radius_m < 100 OR p_radius_m > 50000 THEN
    RAISE EXCEPTION 'Radius must be between 100 and 50000 meters';
  END IF;

  IF p_max_results < 1 OR p_max_results > 200 THEN
    RAISE EXCEPTION 'max_results must be between 1 and 200';
  END IF;

  v_nearby_calls := CEIL(p_max_results::numeric / 20);
  v_detail_calls := p_max_results;
  v_photo_calls := p_max_results * 5;
  v_estimated_cost := (v_nearby_calls * 0.032) + (v_detail_calls * 0.017) + (v_photo_calls * 0.007);

  INSERT INTO admin_backfill_log (
    operation_type, triggered_by, status,
    target_category, target_lat, target_lng, target_radius_m,
    total_places, estimated_cost_usd, started_at
  ) VALUES (
    'category_fill', v_user_id, 'pending',
    p_category, p_lat, p_lng, p_radius_m,
    p_max_results, v_estimated_cost, now()
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'backfill_log_id', v_log_id,
    'estimated_api_calls', v_nearby_calls + v_detail_calls + v_photo_calls,
    'estimated_cost_usd', ROUND(v_estimated_cost, 2),
    'status', 'pending'
  );
END;
$$;

-- ─── R3.9 admin_pool_stats_overview (source: 20260317100002) ────────────────
-- Note: this RPC was already absent from live DB pre-cutover (per spec §0.5).
-- Restored for completeness; UI consumer (RefreshTab pool-health panel) was
-- also deleted by ORCH-0671. Operator may choose to skip this restore.
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
  v_config_threshold NUMERIC;
  v_config_avg_impressions NUMERIC;
  v_config_photo_cost NUMERIC;
  v_total_places BIGINT;
  v_with_photos BIGINT;
  v_missing_photos BIGINT;
  v_coverage_pct NUMERIC;
  v_recent_backfill_cost NUMERIC;
  v_daily_cost NUMERIC;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  SELECT COALESCE((SELECT (value)::numeric FROM admin_config WHERE key = 'cost_alert_threshold_monthly_usd'), 50) INTO v_config_threshold;
  SELECT COALESCE((SELECT (value)::numeric FROM admin_config WHERE key = 'avg_impressions_per_place_per_day'), 2.5) INTO v_config_avg_impressions;
  SELECT COALESCE((SELECT (value)::numeric FROM admin_config WHERE key = 'google_photo_cost_per_view'), 0.007) INTO v_config_photo_cost;

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

  -- Note: original used card_pool which was archived by ORCH-0640.
  -- Returning empty arrays for categories + location_buckets + missing_places
  -- post-rollback (ORCH-0640 archive cannot be reversed by ORCH-0671 rollback).
  v_categories := '[]'::jsonb;
  v_location_buckets := '[]'::jsonb;

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

  v_missing_places := '[]'::jsonb;

  RETURN jsonb_build_object(
    'photo_health', v_photo_health,
    'categories', v_categories,
    'location_buckets', v_location_buckets,
    'cost_monitor', v_cost_monitor,
    'missing_places', v_missing_places
  );
END;
$$;

-- ─── R3.10 admin_backfill_status (source: 20260317100002) ───────────────────
CREATE OR REPLACE FUNCTION public.admin_backfill_status(p_backfill_log_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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

  SELECT jsonb_build_object(
    'id', id,
    'operation_type', operation_type,
    'status', status,
    'total_places', total_places,
    'success_count', success_count,
    'failure_count', failure_count,
    'api_calls_made', api_calls_made,
    'estimated_cost_usd', estimated_cost_usd,
    'error_details', error_details,
    'started_at', started_at,
    'completed_at', completed_at
  )
  INTO v_result
  FROM admin_backfill_log
  WHERE id = p_backfill_log_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Backfill log entry not found';
  END IF;

  RETURN v_result;
END;
$$;

-- ─── R3.11 admin_backfill_log_list (source: 20260317100002) ─────────────────
CREATE OR REPLACE FUNCTION public.admin_backfill_log_list(
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_rows JSONB;
  v_total BIGINT;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  SELECT COUNT(*) INTO v_total FROM admin_backfill_log;

  SELECT COALESCE(jsonb_agg(row_to_json(logs)::jsonb), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      bl.id,
      bl.operation_type,
      bl.triggered_by,
      COALESCE(p.display_name, p.email, bl.triggered_by::text) AS triggered_by_name,
      bl.status,
      bl.target_category,
      bl.target_lat,
      bl.target_lng,
      bl.total_places,
      bl.success_count,
      bl.failure_count,
      bl.api_calls_made,
      bl.estimated_cost_usd,
      bl.error_details,
      bl.started_at,
      bl.completed_at,
      bl.created_at
    FROM admin_backfill_log bl
    LEFT JOIN profiles p ON p.id = bl.triggered_by
    ORDER BY bl.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) logs;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total
  );
END;
$$;

-- ─── R3.12 admin_backfill_weekly_costs (source: 20260317100002) ─────────────
CREATE OR REPLACE FUNCTION public.admin_backfill_weekly_costs()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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

  SELECT COALESCE(jsonb_agg(row_to_json(w)::jsonb ORDER BY w.week_start), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      date_trunc('week', started_at)::date AS week_start,
      SUM(estimated_cost_usd) AS total_cost,
      COUNT(*) AS operation_count
    FROM admin_backfill_log
    WHERE started_at >= now() - INTERVAL '12 weeks'
    GROUP BY date_trunc('week', started_at)
  ) w;

  RETURN v_result;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- Step R4: Post-condition assertions (verify rollback took)
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_restored_rpcs BIGINT;
  v_restored_rows BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_restored_rpcs FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'admin_photo_pool_summary','admin_photo_pool_missing_places',
        'admin_photo_pool_categories','admin_photo_pool_locations',
        'admin_photo_pool_refresh_health','admin_pool_category_detail',
        'admin_trigger_backfill','admin_trigger_category_fill',
        'admin_pool_stats_overview','admin_backfill_log_list',
        'admin_backfill_status','admin_backfill_weekly_costs'
      );
  IF v_restored_rpcs < 12 THEN
    RAISE EXCEPTION 'ORCH-0671 ROLLBACK post-condition FAILED: only % of 12 RPCs restored', v_restored_rpcs;
  END IF;

  SELECT COUNT(*) INTO v_restored_rows FROM public.admin_backfill_log
    WHERE operation_type IN ('photo_backfill', 'category_fill');
  RAISE NOTICE 'ORCH-0671 ROLLBACK: post-conditions OK. RPCs=12, restored rows=%', v_restored_rows;
END $$;

COMMIT;
