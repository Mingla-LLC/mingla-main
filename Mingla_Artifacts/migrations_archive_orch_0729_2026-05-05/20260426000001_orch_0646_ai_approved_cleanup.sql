-- ORCH-0646 — Rewrite 6 admin RPCs that still reference dropped ai_approved column.
-- Root cause: ORCH-0640 ch03 rebuilt admin_place_pool_mv without ai_approved, and ch13
-- dropped place_pool.ai_approved. Rewrite migration ch05 (20260425000014) covered 14
-- RPCs but these 6 were missed — still reference mv.ai_approved (4) or pp.ai_approved (1).
-- This migration completes the cleanup by DROP+CREATE with renamed return fields.
--
-- See Mingla_Artifacts/specs/SPEC_ORCH-0646_AI_APPROVED_LEFTOVERS.md for full rationale.
-- Orchestrator-locked decisions: Direction B (clean rename), D-3 read-only viewer.
--
-- Prerequisites (verified via pre-flight gates — see spec §2):
--   - place_pool.ai_approved column dropped (by 20260425000004)
--   - admin_place_pool_mv rebuilt without ai_approved, with is_servable (by 20260425000003)
--   - ORCH-0640 cutover applied end-to-end (confirmed live 2026-04-23 evening)
--
-- 3-state semantics preserved: `is_servable` is BOOLEAN NULLable.
--   TRUE  = Bouncer judged servable (replaces ai_approved=true)
--   FALSE = Bouncer judged excluded (replaces ai_approved=false)
--   NULL  = Not yet judged by Bouncer (replaces ai_approved=null)
--
-- Return-field renames:
--   ai_approved_places / ai_approved_count → is_servable_places / is_servable_count
--   ai_validated_count → bouncer_judged_count
--   ai_rejected_count  → bouncer_excluded_count
--   ai_pending_count   → bouncer_pending_count
--   ai_validated_pct   → bounced_pct

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. admin_city_picker_data — pp.ai_approved → pp.is_servable
-- Return-field rename: ai_approved_places → is_servable_places
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.admin_city_picker_data();
CREATE OR REPLACE FUNCTION public.admin_city_picker_data()
RETURNS TABLE (
  city_id UUID,
  city_name TEXT,
  country_name TEXT,
  country_code TEXT,
  city_status TEXT,
  is_servable_places BIGINT,
  total_active_places BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users au WHERE au.email = auth.email() AND au.status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT
    sc.id AS city_id,
    sc.name AS city_name,
    sc.country AS country_name,
    sc.country_code,
    sc.status AS city_status,
    (SELECT COUNT(*) FROM place_pool pp
     WHERE pp.city_id = sc.id AND pp.is_active AND pp.is_servable = true
    ) AS is_servable_places,
    (SELECT COUNT(*) FROM place_pool pp
     WHERE pp.city_id = sc.id AND pp.is_active
    ) AS total_active_places
  FROM seeding_cities sc
  ORDER BY sc.country, sc.name;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. admin_place_pool_overview — mv.ai_approved × 21 → mv.is_servable
-- Return-field renames: ai_approved_places/count/ai_validated_count/ai_rejected_count/ai_pending_count
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.admin_place_pool_overview(uuid, text);
CREATE OR REPLACE FUNCTION public.admin_place_pool_overview(
  p_city_id uuid DEFAULT NULL::uuid,
  p_country_code text DEFAULT NULL::text
)
RETURNS TABLE(
  total_places bigint,
  active_places bigint,
  is_servable_places bigint,
  with_photos bigint,
  photo_pct integer,
  bouncer_judged_count bigint,
  is_servable_count bigint,
  bouncer_excluded_count bigint,
  bouncer_pending_count bigint,
  distinct_categories integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. admin_place_country_overview — mv.ai_approved × 7 → mv.is_servable
-- Return-field renames: ai_approved_places → is_servable_places; ai_validated_pct → bounced_pct
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.admin_place_country_overview();
CREATE OR REPLACE FUNCTION public.admin_place_country_overview()
RETURNS TABLE(
  country_code text,
  country_name text,
  city_count bigint,
  is_servable_places bigint,
  photo_pct integer,
  bounced_pct integer,
  category_coverage integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. admin_place_city_overview — mv.ai_approved × 8 → mv.is_servable
-- Return-field renames: ai_approved_places → is_servable_places; ai_validated_pct → bounced_pct
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.admin_place_city_overview(text);
CREATE OR REPLACE FUNCTION public.admin_place_city_overview(p_country_code text)
RETURNS TABLE(
  city_id uuid,
  city_name text,
  is_servable_places bigint,
  photo_pct integer,
  bounced_pct integer,
  category_coverage integer,
  avg_rating numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. admin_place_category_breakdown — single mv.ai_approved → mv.is_servable (body only)
-- Return shape unchanged. Using CREATE OR REPLACE since signature unchanged.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_place_category_breakdown(
  p_city_id uuid DEFAULT NULL::uuid,
  p_country_code text DEFAULT NULL::text
)
RETURNS TABLE(
  category text,
  place_count bigint,
  photo_pct integer,
  avg_rating numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. admin_place_photo_stats — single mv.ai_approved → mv.is_servable (body only)
-- Return shape unchanged. Using CREATE OR REPLACE since signature unchanged.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_place_photo_stats(p_city_id uuid)
RETURNS TABLE(
  total_places bigint,
  with_photos bigint,
  without_photos bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- POST-APPLY verification (run manually after `supabase db push`):
-- ═══════════════════════════════════════════════════════════════════════════
--   -- Confirm no stale refs remain
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('admin_city_picker_data','admin_place_pool_overview',
--                     'admin_place_country_overview','admin_place_city_overview',
--                     'admin_place_category_breakdown','admin_place_photo_stats')
--     AND pg_get_functiondef(oid) ~ 'ai_approved';
--   -- Expected: 0 rows
--
--   -- Smoke-test each function succeeds on prod data
--   SELECT * FROM admin_city_picker_data() LIMIT 1;
--   SELECT * FROM admin_place_pool_overview(NULL, NULL);
--   SELECT * FROM admin_place_country_overview() LIMIT 1;
--   SELECT * FROM admin_place_city_overview('US') LIMIT 1;
--   SELECT * FROM admin_place_category_breakdown(NULL, 'US') LIMIT 1;
--   SELECT * FROM admin_place_photo_stats(
--     (SELECT id FROM seeding_cities WHERE country_code='US' LIMIT 1)
--   );
-- ═══════════════════════════════════════════════════════════════════════════
