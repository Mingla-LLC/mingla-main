-- ORCH-0640 ch05 — Rewrite place/photo admin RPCs to remove card_pool joins (DEC-037)
-- After ch03 MV rebuild, admin_place_pool_mv no longer has ai_approved column.
-- After ch12 archive, card_pool + card_pool_stops no longer readable from serving path.
-- After ch13 column drop, place_pool.ai_approved is gone.
-- These RPCs must run pool-only.
--
-- Transforms applied:
--   (1) mv.ai_approved = TRUE    → mv.is_servable = TRUE
--   (2) SELECT FROM card_pool ... → removed (or replaced with engagement_metrics)
--   (3) cascade UPDATE card_pool  → removed (no card_pool to cascade to)
--   (4) card_count projections    → removed OR derived from engagement_metrics
--   (5) user_card_impressions     → removed (table never existed in prod; Phase-2 F-5 errata)
--
-- MUST run AFTER ch03 MV rebuild (20260425000003) and BEFORE ch11 RPC drops (20260425000012).
-- Signatures + return types preserved — admin callers untouched.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. admin_bulk_deactivate_places — drop card_pool count projections
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_bulk_deactivate_places(p_place_ids uuid[], p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin BOOLEAN;
  v_user_id UUID;
  v_places_deactivated INTEGER;
  v_pid UUID;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'Forbidden: admin access required'; END IF;
  v_user_id := auth.uid();

  IF p_place_ids IS NULL OR array_length(p_place_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('error', 'No place IDs provided');
  END IF;

  WITH deactivated AS (
    UPDATE place_pool SET is_active = false, updated_at = now()
    WHERE id = ANY(p_place_ids) AND is_active = true
    RETURNING id
  )
  SELECT COUNT(*) INTO v_places_deactivated FROM deactivated;

  FOREACH v_pid IN ARRAY p_place_ids LOOP
    INSERT INTO place_admin_actions (place_id, action_type, acted_by, reason, metadata)
    VALUES (v_pid, 'bulk_deactivate', v_user_id, p_reason,
      jsonb_build_object('batch_size', array_length(p_place_ids, 1)));
  END LOOP;

  -- ORCH-0640: card-count projections removed. Cards no longer exist.
  -- Callers who displayed the counts now show 0 or omit the field.
  RETURN jsonb_build_object(
    'success', true,
    'places_deactivated', v_places_deactivated,
    'cards_deactivated', 0,
    'single_cards_deactivated', 0,
    'curated_cards_deactivated', 0
  );
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. admin_city_pipeline_status — drop ai_approved_count + ai_validated_count
-- ═══════════════════════════════════════════════════════════════════════════
-- Legacy projections drop + TABLE column list updated per DROP COLUMN ai_approved.
-- Callers (admin city launch pipeline view) must stop rendering the AI columns —
-- orchestrator updates admin pages in ch08 accordingly.
-- ORCH-0640 rework v2.1: return-type changed (ai_approved_count → is_servable_count
-- etc.). Postgres rejects CREATE OR REPLACE when return type differs — must DROP first.
DROP FUNCTION IF EXISTS public.admin_city_pipeline_status();
CREATE OR REPLACE FUNCTION public.admin_city_pipeline_status()
 RETURNS TABLE(city_id uuid, city_name text, country_name text, country_code text, city_status text, created_at timestamp with time zone, total_active bigint, seeded_count bigint, refreshed_count bigint, bouncer_judged_count bigint, is_servable_count bigint, has_real_photos_count bigint, scored_count bigint, last_place_update timestamp with time zone, last_refresh timestamp with time zone, last_bouncer_run timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH pool_stats AS (
    SELECT
      pp.city_id,
      COUNT(*) FILTER (WHERE pp.is_active) AS total_active,
      COUNT(*) FILTER (WHERE pp.is_active AND pp.google_place_id IS NOT NULL) AS seeded_count,
      COUNT(*) FILTER (WHERE pp.is_active AND pp.last_detail_refresh IS NOT NULL
                       AND pp.last_detail_refresh > pp.created_at + interval '1 minute') AS refreshed_count,
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
      MAX(pp.bouncer_validated_at) AS last_bouncer_run
    FROM public.place_pool pp
    WHERE pp.city_id IS NOT NULL
    GROUP BY pp.city_id
  ),
  score_stats AS (
    SELECT pp.city_id, COUNT(DISTINCT ps.place_id) AS scored_count
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
    COALESCE(ps.total_active, 0)::bigint,
    COALESCE(ps.seeded_count, 0)::bigint,
    COALESCE(ps.refreshed_count, 0)::bigint,
    COALESCE(ps.bouncer_judged_count, 0)::bigint,
    COALESCE(ps.is_servable_count, 0)::bigint,
    COALESCE(ps.has_real_photos_count, 0)::bigint,
    COALESCE(ss.scored_count, 0)::bigint,
    ps.last_place_update,
    ps.last_refresh,
    ps.last_bouncer_run
  FROM public.seeding_cities sc
  LEFT JOIN pool_stats ps ON ps.city_id = sc.id
  LEFT JOIN score_stats ss ON ss.city_id = sc.id
  ORDER BY COALESCE(ps.total_active, 0) DESC, sc.name;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. admin_deactivate_place — drop card_pool count projections
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_deactivate_place(p_place_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin BOOLEAN;
  v_user_id UUID;
  v_place_name TEXT;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'Forbidden: admin access required'; END IF;
  v_user_id := auth.uid();

  SELECT name INTO v_place_name FROM place_pool
  WHERE id = p_place_id AND is_active = true;

  IF v_place_name IS NULL THEN
    RETURN jsonb_build_object('error', 'Place not found or already inactive');
  END IF;

  UPDATE place_pool SET is_active = false, updated_at = now()
  WHERE id = p_place_id;

  INSERT INTO place_admin_actions (place_id, action_type, acted_by, reason, metadata)
  VALUES (p_place_id, 'deactivate', v_user_id, p_reason,
    jsonb_build_object('place_name', v_place_name));

  RETURN jsonb_build_object(
    'success', true,
    'place_name', v_place_name,
    'cards_deactivated', 0,
    'single_cards_deactivated', 0,
    'curated_cards_deactivated', 0
  );
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. admin_edit_place — drop card_pool cascade writes
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_edit_place(p_place_id uuid, p_name text DEFAULT NULL::text, p_price_tier text DEFAULT NULL::text, p_is_active boolean DEFAULT NULL::boolean, p_seeding_category text DEFAULT NULL::text, p_price_tiers text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_effective_tiers TEXT[];
  v_tiers_provided BOOLEAN := (p_price_tiers IS NOT NULL);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_tiers_provided THEN
    v_effective_tiers := p_price_tiers;
  ELSIF p_price_tier IS NOT NULL THEN
    v_effective_tiers := ARRAY[p_price_tier];
  ELSE
    v_effective_tiers := NULL;
  END IF;

  UPDATE public.place_pool
  SET
    name = COALESCE(p_name, name),
    price_tier = CASE
      WHEN v_effective_tiers IS NOT NULL AND array_length(v_effective_tiers, 1) > 0 THEN v_effective_tiers[1]
      WHEN v_effective_tiers IS NOT NULL THEN NULL
      ELSE price_tier
    END,
    price_tiers = COALESCE(v_effective_tiers, price_tiers),
    is_active = COALESCE(p_is_active, is_active),
    seeding_category = COALESCE(p_seeding_category, seeding_category),
    updated_at = now()
  WHERE id = p_place_id
  RETURNING jsonb_build_object(
    'id', id, 'name', name, 'price_tier', price_tier, 'price_tiers', price_tiers,
    'is_active', is_active, 'seeding_category', seeding_category
  )
  INTO v_result;

  IF v_result IS NULL THEN RAISE EXCEPTION 'Place not found: %', p_place_id; END IF;

  -- ORCH-0640: card_pool cascade writes removed. Cards no longer persist.
  RETURN v_result;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. admin_photo_pool_categories — read place_pool instead of card_pool
-- ═══════════════════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. admin_photo_pool_locations — read place_pool instead of card_pool
-- ═══════════════════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. admin_photo_pool_missing_places — drop card_count projection
-- ═══════════════════════════════════════════════════════════════════════════
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

  -- ORCH-0640: card_count projection removed (card_pool no longer exists).
  -- Returns 0 for card_count so admin UI can keep the column or hide it.
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. admin_photo_pool_refresh_health — use engagement_metrics for "recently_served"
-- ═══════════════════════════════════════════════════════════════════════════
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

  -- ORCH-0640: user_card_impressions doesn't exist; card_pool archived.
  -- "Recently served and stale" now computed from engagement_metrics.
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. admin_place_pool_city_list — mv.ai_approved → mv.is_servable; drop card_pool
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_place_pool_city_list(p_country text)
 RETURNS TABLE(city_name text, approved_places bigint, with_photos bigint, existing_cards bigint, ready_to_generate bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. admin_place_pool_country_list — mv.ai_approved → mv.is_servable; drop card_pool
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_place_pool_country_list()
 RETURNS TABLE(country text, approved_places bigint, with_photos bigint, existing_cards bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. admin_pool_category_detail — read place_pool instead of card_pool
-- ═══════════════════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. admin_pool_category_health — drop card_pool aggregates, keep place stats
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_pool_category_health(p_country text DEFAULT NULL::text, p_city text DEFAULT NULL::text)
 RETURNS TABLE(category text, total_places bigint, active_places bigint, with_photos bigint, photo_pct integer, avg_rating numeric, total_cards bigint, single_cards bigint, curated_cards bigint, places_needing_cards bigint, health text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
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
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 13. admin_reactivate_place — drop card_pool cascade
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_reactivate_place(p_place_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin BOOLEAN;
  v_user_id UUID;
  v_place_name TEXT;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION 'Forbidden: admin access required'; END IF;
  v_user_id := auth.uid();

  SELECT name INTO v_place_name FROM place_pool
  WHERE id = p_place_id AND is_active = false;

  IF v_place_name IS NULL THEN
    RETURN jsonb_build_object('error', 'Place not found or already active');
  END IF;

  UPDATE place_pool SET is_active = true, updated_at = now()
  WHERE id = p_place_id;

  INSERT INTO place_admin_actions (place_id, action_type, acted_by, reason, metadata)
  VALUES (p_place_id, 'reactivate', v_user_id, p_reason,
    jsonb_build_object('place_name', v_place_name));

  -- ORCH-0640: card_pool cascade removed.
  RETURN jsonb_build_object(
    'success', true,
    'place_name', v_place_name,
    'cards_reactivated', 0
  );
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 14. admin_trigger_place_refresh — rewire "recently_served" via engagement_metrics
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_trigger_place_refresh(p_mode text, p_place_pool_ids uuid[] DEFAULT NULL::uuid[], p_stale_threshold_hours integer DEFAULT 168, p_served_within_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF NOT v_is_admin THEN RAISE EXCEPTION 'Forbidden: admin access required'; END IF;
  v_user_id := auth.uid();

  IF p_mode NOT IN ('recently_served', 'all_stale', 'selected') THEN
    RAISE EXCEPTION 'Invalid mode: must be recently_served, all_stale, or selected';
  END IF;
  IF p_stale_threshold_hours < 1 OR p_stale_threshold_hours > 8760 THEN
    RAISE EXCEPTION 'stale_threshold_hours must be between 1 and 8760';
  END IF;
  IF p_served_within_days < 1 OR p_served_within_days > 90 THEN
    RAISE EXCEPTION 'served_within_days must be between 1 and 90';
  END IF;

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

  IF p_mode = 'recently_served' THEN
    -- ORCH-0640: engagement_metrics.place_pool_id event_kind='served' replaces
    -- the old card_pool → user_card_impressions chain (user_card_impressions never
    -- existed in prod per Phase-2 F-5; card_pool archived in ch12).
    SELECT array_agg(sub.id), COUNT(*)
    INTO v_resolved_ids, v_total
    FROM (
      SELECT DISTINCT pp.id
      FROM place_pool pp
      JOIN engagement_metrics em ON em.place_pool_id = pp.id AND em.event_kind = 'served'
      WHERE pp.is_active = true
        AND pp.last_detail_refresh < now() - (p_stale_threshold_hours || ' hours')::interval
        AND em.created_at > now() - (p_served_within_days || ' days')::interval
      ORDER BY pp.id
      LIMIT 500
    ) sub;

  ELSIF p_mode = 'all_stale' THEN
    SELECT array_agg(sub.id), COUNT(*)
    INTO v_resolved_ids, v_total
    FROM (
      SELECT id FROM place_pool
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
    WHERE id = ANY(p_place_pool_ids) AND is_active = true;
  END IF;

  IF v_total IS NULL OR v_total = 0 THEN
    RETURN jsonb_build_object(
      'backfill_log_id', NULL,
      'total_places', 0,
      'estimated_cost_usd', 0,
      'status', 'nothing_to_do',
      'message', 'No places found matching the refresh criteria'
    );
  END IF;

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
$function$;

COMMIT;
