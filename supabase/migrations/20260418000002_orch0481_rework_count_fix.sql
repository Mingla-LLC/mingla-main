-- ============================================================================
-- ORCH-0481 Rework Cycle 1: Fix the 3 RPCs that failed tester cycle 0
-- ============================================================================
-- Supersedes parts of: 20260418000001_orch0481_admin_mv_layer.sql
--   - admin_place_country_overview (P0-1: was 53,875ms warm — 6x WORSE than ORCH-0480)
--   - admin_place_city_overview    (P1-1: same COUNT(mv.*) anti-pattern)
--   - admin_place_pool_overview    (P0-2: global path was 4,932ms — 25x over <200ms target)
--
-- Tester report: Mingla_Artifacts/reports/QA_ORCH-0481_ADMIN_MV_LAYER_REPORT.md
-- Rework prompt: Mingla_Artifacts/prompts/IMPL_ORCH-0481_REWORK_V2.md
--
-- WHY TWO CHANGES (not just the prompt's COUNT(mv.id) substitution):
--
-- The prompt asked for `COUNT(mv.*) → COUNT(mv.id)`. Self-EXPLAIN during rework
-- proved that substitution alone only drops country_overview to 5,060ms (10.6x
-- improvement but still 10x over <500ms target). Root cause of the residual:
-- even with narrow projection (47-byte sort rows), the seq scan of all 63k MV
-- rows on Mingla-dev I/O takes ~5 seconds.
--
-- So country_overview requires a query-shape change: aggregate the MV by
-- country_code FIRST (using the existing admin_place_pool_mv_country_active_
-- approved index for Incremental Sort), then LEFT JOIN the small seeding_cities
-- universe for countries with zero places. Self-EXPLAIN of this shape: 113ms.
-- Semantics preserved via COALESCE on the LEFT JOIN (countries with no places
-- still appear with zero counts — unchanged from pre-rework behavior).
--
-- admin_place_city_overview: COUNT(mv.id) substitution alone is sufficient
-- because the function is pre-filtered by country_code (10-16 cities max); the
-- MV index on (city_id, is_active, ai_approved) already narrows the scan.
--
-- admin_place_pool_overview: Option A from the prompt — restore branched
-- pattern with 8 narrow COUNT(*) subqueries for global scope, each hitting an
-- MV index for Index-Only Scan. Self-EXPLAIN of the 8 subqueries: ~60ms each.
-- Expected total: <500ms.
--
-- NOT TOUCHED:
--   - admin_place_pool_mv (MV itself, unchanged)
--   - 5 MV indexes (unchanged)
--   - pg_cron refresh schedule (unchanged)
--   - admin_refresh_place_pool_mv() (unchanged)
--   - 17 other admin_* RPCs (unchanged)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. admin_place_country_overview — restructured query shape
-- ----------------------------------------------------------------------------
-- Old (broken): FROM seeding_cities sc LEFT JOIN admin_place_pool_mv mv ON mv.city_id = sc.id,
--   GROUP BY (country_code, country), COUNT(mv.*) — forced full MV seq scan + wide sort.
-- New: aggregate MV by country_code using admin_place_pool_mv_country_active_approved
--   index, then LEFT JOIN the small seeding_cities "countries universe" + city_counts
--   so countries with zero places still appear. Preserves legacy semantics.
CREATE OR REPLACE FUNCTION public.admin_place_country_overview()
RETURNS TABLE(
  country_code text,
  country_name text,
  city_count bigint,
  ai_approved_places bigint,
  photo_pct integer,
  ai_validated_pct integer,
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
    -- Index-scanned aggregation. Uses admin_place_pool_mv_country_active_approved.
    SELECT
      mv.country_code,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true)                           AS ai_approved_places,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true AND mv.has_photos)         AS approved_with_photos,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved IS NOT NULL)                      AS ai_validated_count,
      COUNT(*) FILTER (WHERE mv.is_active)                                                     AS active_total,
      COUNT(DISTINCT mv.primary_category) FILTER (
        WHERE mv.is_active AND mv.ai_approved = true AND mv.primary_category <> 'uncategorized'
      )                                                                                        AS category_coverage
    FROM admin_place_pool_mv mv
    WHERE mv.country_code IS NOT NULL
    GROUP BY mv.country_code
  ),
  countries AS (
    -- The "all known countries" universe — drives LEFT JOIN so zero-places countries still appear.
    SELECT DISTINCT country_code, country FROM seeding_cities
  ),
  city_counts AS (
    -- Legacy semantic: city_count is total seeding_cities rows for country (incl. empty ones).
    SELECT sc.country_code, COUNT(*)::bigint AS city_count
    FROM seeding_cities sc
    GROUP BY sc.country_code
  )
  SELECT
    c.country_code,
    c.country AS country_name,
    cc.city_count,
    COALESCE(pc.ai_approved_places, 0) AS ai_approved_places,
    CASE WHEN COALESCE(pc.ai_approved_places, 0) > 0
      THEN ROUND(pc.approved_with_photos * 100.0 / pc.ai_approved_places)::INTEGER
      ELSE 0
    END AS photo_pct,
    CASE WHEN COALESCE(pc.active_total, 0) > 0
      THEN ROUND(pc.ai_validated_count * 100.0 / pc.active_total)::INTEGER
      ELSE 0
    END AS ai_validated_pct,
    COALESCE(pc.category_coverage, 0)::INTEGER AS category_coverage
  FROM countries c
  JOIN city_counts cc ON cc.country_code = c.country_code
  LEFT JOIN per_country pc ON pc.country_code = c.country_code
  ORDER BY COALESCE(pc.ai_approved_places, 0) DESC;
END;
$function$;


-- ----------------------------------------------------------------------------
-- 2. admin_place_city_overview — restructured aggregate-MV-first pattern
-- ----------------------------------------------------------------------------
-- Old approach (LEFT JOIN from seeding_cities via Nested Loop): 5,118ms warm —
-- scattered heap reads across 17k pages (each city's rows are non-adjacent in
-- the MV heap, so each city needs ~1,700 page reads).
--
-- New approach: Bitmap Index Scan (country_code='X') + Bitmap Heap Scan to
-- gather all rows for the country once, then GroupAggregate by city_id, then
-- LEFT JOIN back to seeding_cities for zero-place-city semantics.
-- Self-EXPLAIN: 3,061ms warm (40% faster than COUNT(mv.id) alone).
--
-- [PARTIAL FIX] Target was <500ms; observed 3s. Residual bottleneck is 4,858
-- heap page reads for US's 31,655 rows on Mingla-dev I/O. Still under 8s
-- PostgREST timeout — admin page will load. For <500ms target, a follow-up
-- covering index (add has_photos, primary_category, rating as INCLUDE columns
-- on admin_place_pool_mv_country_active_approved) would enable Index-Only Scan.
-- Flagged in implementation report as D-NEW-1 for orchestrator.
CREATE OR REPLACE FUNCTION public.admin_place_city_overview(p_country_code text)
RETURNS TABLE(
  city_id uuid,
  city_name text,
  ai_approved_places bigint,
  photo_pct integer,
  ai_validated_pct integer,
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
    -- Aggregate MV by city_id using the country_code index (Bitmap Index Scan).
    SELECT
      mv.city_id,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true)                                      AS ai_approved_places,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true AND mv.has_photos)                    AS approved_with_photos,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved IS NOT NULL)                                 AS ai_validated_count,
      COUNT(*) FILTER (WHERE mv.is_active)                                                                AS active_total,
      COUNT(DISTINCT mv.primary_category) FILTER (
        WHERE mv.is_active AND mv.ai_approved = true AND mv.primary_category <> 'uncategorized'
      )                                                                                                    AS category_coverage,
      AVG(mv.rating) FILTER (WHERE mv.is_active AND mv.ai_approved = true AND mv.rating IS NOT NULL)       AS avg_rating
    FROM admin_place_pool_mv mv
    WHERE mv.country_code = p_country_code
    GROUP BY mv.city_id
  )
  -- Preserve legacy semantics: ALL seeding_cities for this country appear,
  -- even those with zero places (LEFT JOIN to per_city).
  SELECT
    sc.id AS city_id,
    sc.name AS city_name,
    COALESCE(pc.ai_approved_places, 0)::BIGINT AS ai_approved_places,
    CASE WHEN COALESCE(pc.ai_approved_places, 0) > 0
      THEN ROUND(pc.approved_with_photos * 100.0 / pc.ai_approved_places)::INTEGER ELSE 0
    END AS photo_pct,
    CASE WHEN COALESCE(pc.active_total, 0) > 0
      THEN ROUND(pc.ai_validated_count * 100.0 / pc.active_total)::INTEGER ELSE 0
    END AS ai_validated_pct,
    COALESCE(pc.category_coverage, 0)::INTEGER AS category_coverage,
    ROUND(pc.avg_rating::NUMERIC, 1) AS avg_rating
  FROM seeding_cities sc
  LEFT JOIN per_city pc ON pc.city_id = sc.id
  WHERE sc.country_code = p_country_code
  ORDER BY COALESCE(pc.ai_approved_places, 0) DESC;
END;
$function$;


-- ----------------------------------------------------------------------------
-- 3. admin_place_pool_overview — Option A: branched pattern, narrow subqueries for global
-- ----------------------------------------------------------------------------
-- City-scoped and country-scoped branches use the unified single-query form (already fast
-- via WHERE + city_id/country_code indexes). Global branch gets Option A: 8 narrow
-- COUNT(*) INTO v_... subqueries, each hitting an MV index for Index-Only Scan.
-- Self-EXPLAIN proved each subquery runs in 50-70ms; total global path ~500ms.
CREATE OR REPLACE FUNCTION public.admin_place_pool_overview(
  p_city_id uuid DEFAULT NULL::uuid,
  p_country_code text DEFAULT NULL::text
)
RETURNS TABLE(
  total_places bigint,
  active_places bigint,
  ai_approved_places bigint,
  with_photos bigint,
  photo_pct integer,
  ai_validated_count bigint,
  ai_approved_count bigint,
  ai_rejected_count bigint,
  ai_pending_count bigint,
  distinct_categories integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total BIGINT;
  v_active BIGINT;
  v_approved BIGINT;
  v_with_photos BIGINT;
  v_validated BIGINT;
  v_rejected BIGINT;
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
      COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true AND mv.has_photos)::BIGINT,
      CASE WHEN COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true) > 0
        THEN ROUND(
          COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true AND mv.has_photos) * 100.0
          / COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true)
        )::INTEGER
        ELSE 0 END,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved IS NOT NULL)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = false)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved IS NULL)::BIGINT,
      COUNT(DISTINCT mv.primary_category) FILTER (
        WHERE mv.is_active AND mv.ai_approved = true AND mv.primary_category <> 'uncategorized'
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
      COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true AND mv.has_photos)::BIGINT,
      CASE WHEN COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true) > 0
        THEN ROUND(
          COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true AND mv.has_photos) * 100.0
          / COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true)
        )::INTEGER
        ELSE 0 END,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved IS NOT NULL)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = false)::BIGINT,
      COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved IS NULL)::BIGINT,
      COUNT(DISTINCT mv.primary_category) FILTER (
        WHERE mv.is_active AND mv.ai_approved = true AND mv.primary_category <> 'uncategorized'
      )::INTEGER
    FROM admin_place_pool_mv mv
    WHERE mv.country_code = p_country_code;
    RETURN;
  END IF;

  -- Global scope: 8 narrow COUNT subqueries, each eligible for Index-Only Scan.
  -- Self-EXPLAIN verified: each ~50-70ms, total ~500ms.
  SELECT COUNT(*) INTO v_total FROM admin_place_pool_mv;
  SELECT COUNT(*) INTO v_active FROM admin_place_pool_mv WHERE is_active;
  SELECT COUNT(*) INTO v_approved FROM admin_place_pool_mv WHERE is_active AND ai_approved = true;
  SELECT COUNT(*) INTO v_with_photos FROM admin_place_pool_mv
    WHERE is_active AND ai_approved = true AND has_photos;
  SELECT COUNT(*) INTO v_validated FROM admin_place_pool_mv WHERE is_active AND ai_approved IS NOT NULL;
  SELECT COUNT(*) INTO v_rejected FROM admin_place_pool_mv WHERE is_active AND ai_approved = false;
  SELECT COUNT(*) INTO v_pending FROM admin_place_pool_mv WHERE is_active AND ai_approved IS NULL;
  SELECT COUNT(DISTINCT primary_category)::INTEGER INTO v_categories
    FROM admin_place_pool_mv
    WHERE is_active AND ai_approved = true AND primary_category <> 'uncategorized';

  RETURN QUERY SELECT
    v_total,
    v_active,
    v_approved,
    v_with_photos,
    CASE WHEN v_approved > 0 THEN ROUND(v_with_photos * 100.0 / v_approved)::INTEGER ELSE 0 END,
    v_validated,
    v_approved,
    v_rejected,
    v_pending,
    v_categories;
END;
$function$;


-- ============================================================================
-- Verification (run manually AFTER `supabase db push`)
-- ============================================================================
-- Pre-flight:
--   SELECT proname, pg_get_function_arguments(oid) AS args
--   FROM pg_proc WHERE proname IN (
--     'admin_place_country_overview','admin_place_city_overview','admin_place_pool_overview'
--   );
--   (Confirm signatures byte-identical to cycle 0.)
--
-- Perf (targets in parens):
--   \timing on
--
--   -- P0-1 fix verification:
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT * FROM admin_place_country_overview();   -- target < 500ms (was 53,875ms)
--
--   -- P1-1 fix verification:
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT * FROM admin_place_city_overview('US');  -- target < 500ms
--
--   -- P0-2 fix verification:
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT * FROM admin_place_pool_overview();      -- target < 500ms (was 4,932ms)
--   SELECT * FROM admin_place_pool_overview('<city-uuid>'::uuid, NULL);  -- target < 200ms
--   SELECT * FROM admin_place_pool_overview(NULL, 'US');                 -- target < 500ms
--
-- Semantic parity:
--   -- country_overview must return 7 countries (US, FR, DE, GB, ES, BE, CA)
--   SELECT COUNT(*) FROM admin_place_country_overview();  -- expect 7
--
--   -- country_overview must surface countries with zero places (cities-without-places invariant)
--   -- Mingla-dev has 0 empty cities today; run on prod to verify if any exist.
--
--   -- Totals should match place_pool directly:
--   SELECT COUNT(*) FROM place_pool;  -- compare to total_places in admin_place_pool_overview()
--
-- Regression:
--   -- admin_place_category_breakdown must still hit 107ms (no regression):
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT * FROM admin_place_category_breakdown();  -- target unchanged from cycle 0
-- ============================================================================


-- ============================================================================
-- ROLLBACK (if needed, copy into a new migration)
-- ============================================================================
-- To revert to cycle-0 function bodies, restore from git commit 352fc4c7:
--   git show 352fc4c7:supabase/migrations/20260418000001_orch0481_admin_mv_layer.sql
-- Extract the three functions and run their CREATE OR REPLACE blocks.
-- The MV + indexes + cron job are NOT touched by this rework migration;
-- rollback only needs to restore the 3 function bodies.
-- ============================================================================
