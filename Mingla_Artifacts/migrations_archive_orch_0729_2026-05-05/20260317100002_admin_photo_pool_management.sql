-- Migration: 20260317000002_admin_photo_pool_management.sql
-- Creates admin_backfill_log and admin_config tables + SECURITY DEFINER RPCs
-- for the Photo & Pool Management dashboard.

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: admin_backfill_log
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.admin_backfill_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type  TEXT NOT NULL CHECK (operation_type IN ('photo_backfill', 'category_fill')),
  triggered_by    UUID NOT NULL REFERENCES auth.users(id),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'completed', 'failed')),

  -- Scope
  place_ids         UUID[],
  target_category   TEXT,
  target_lat        DOUBLE PRECISION,
  target_lng        DOUBLE PRECISION,
  target_radius_m   INTEGER,

  -- Results
  total_places      INTEGER NOT NULL DEFAULT 0,
  success_count     INTEGER NOT NULL DEFAULT 0,
  failure_count     INTEGER NOT NULL DEFAULT 0,
  error_details     JSONB DEFAULT '[]'::jsonb,

  -- Cost tracking
  api_calls_made      INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd  NUMERIC(8,4) NOT NULL DEFAULT 0,

  -- Timestamps
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backfill_log_created
  ON public.admin_backfill_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_backfill_log_status
  ON public.admin_backfill_log (status)
  WHERE status IN ('pending', 'running');

ALTER TABLE public.admin_backfill_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_backfill_log" ON public.admin_backfill_log;
CREATE POLICY "service_role_all_backfill_log" ON public.admin_backfill_log
  FOR ALL USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: admin_config
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.admin_config (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  UUID REFERENCES auth.users(id),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.admin_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_admin_config" ON public.admin_config;
CREATE POLICY "service_role_all_admin_config" ON public.admin_config
  FOR ALL USING (auth.role() = 'service_role');

INSERT INTO public.admin_config (key, value) VALUES
  ('cost_alert_threshold_monthly_usd', '50'::jsonb),
  ('avg_impressions_per_place_per_day', '2.5'::jsonb),
  ('google_photo_cost_per_view', '0.007'::jsonb),
  ('google_nearby_search_cost_per_call', '0.032'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: admin_pool_stats_overview
-- Returns all dashboard statistics in a single call.
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

  -- Location buckets (pre-grouped for efficiency)
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

  RETURN jsonb_build_object(
    'photo_health', v_photo_health,
    'categories', v_categories,
    'location_buckets', v_location_buckets,
    'cost_monitor', v_cost_monitor,
    'missing_places', v_missing_places
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: admin_pool_category_detail
-- Returns location buckets for a specific category.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_pool_category_detail(p_category TEXT)
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

  SELECT COALESCE(jsonb_agg(row_to_json(loc)::jsonb ORDER BY loc.card_count DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      ROUND(lat::numeric, 2) AS lat_bucket,
      ROUND(lng::numeric, 2) AS lng_bucket,
      COUNT(*) AS card_count,
      ROUND(AVG(rating)::numeric, 2) AS avg_rating,
      ROUND(
        COUNT(*) FILTER (WHERE image_url IS NOT NULL AND image_url != '')::numeric
        / GREATEST(COUNT(*), 1) * 100, 1
      ) AS photo_coverage_pct
    FROM card_pool
    WHERE is_active = true AND category = p_category
    GROUP BY ROUND(lat::numeric, 2), ROUND(lng::numeric, 2)
  ) loc;

  RETURN jsonb_build_object(
    'category', p_category,
    'location_buckets', v_result
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: admin_trigger_backfill
-- Creates a backfill log entry for photo backfill. Returns the log entry.
-- Actual execution happens via Supabase Edge Function (separate deployment).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_trigger_backfill(
  p_mode TEXT,           -- 'selected' or 'all_missing'
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

  -- Guard: check for already-running backfill of same type
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

  -- Resolve target places
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

  -- Cost estimate: each place triggers up to 5 photo downloads at $0.007
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

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: admin_trigger_category_fill
-- Creates a backfill log entry for category fill. Returns the log entry.
-- ═══════════════════════════════════════════════════════════════════════════════

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

  -- Validate category
  IF NOT (p_category = ANY(v_valid_categories)) THEN
    RAISE EXCEPTION 'Invalid category: %', p_category;
  END IF;

  -- Validate coordinates
  IF p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN
    RAISE EXCEPTION 'Invalid coordinates: lat must be -90..90, lng must be -180..180';
  END IF;

  -- Validate radius
  IF p_radius_m < 100 OR p_radius_m > 50000 THEN
    RAISE EXCEPTION 'Radius must be between 100 and 50000 meters';
  END IF;

  -- Validate max_results
  IF p_max_results < 1 OR p_max_results > 200 THEN
    RAISE EXCEPTION 'max_results must be between 1 and 200';
  END IF;

  -- Cost estimate
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

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: admin_backfill_status
-- Returns the current status of a backfill operation.
-- ═══════════════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: admin_backfill_log_list
-- Paginated list of backfill operations, newest first.
-- ═══════════════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: admin_backfill_weekly_costs
-- Returns weekly backfill costs for the chart (last 12 weeks).
-- ═══════════════════════════════════════════════════════════════════════════════

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
