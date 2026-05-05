-- ORCH-0480: Admin Place Pool RPC performance fix
-- ============================================================================
-- Context:
--   3 admin RPCs (admin_place_pool_overview, admin_place_category_breakdown,
--   admin_place_country_overview) started timing out after place_pool grew to
--   63,239 active rows. PostgREST statement_timeout ≈ 8s.
--
-- Root causes:
--   1. admin_place_category_breakdown: 16.8s — GROUP BY on expression
--      `ai_categories[1]` with no matching index. Index scan + per-row array
--      access.
--   2. admin_place_country_overview: 7 SELECT subqueries × 7 countries =
--      49 full table scans per call. Correlated subquery anti-pattern.
--   3. admin_place_pool_overview global path: 8 COUNT subqueries; the final
--      DISTINCT on ai_categories[1] has no matching index (same as #1).
--
-- Fix:
--   - Add expression index on (ai_categories[1]) where is_active=true AND
--     ai_approved=true AND ai_categories IS NOT NULL AND array_length>0.
--     This accelerates the GROUP BY and DISTINCT patterns used by functions
--     #1 and #3. Expected: 16.8s → <500ms.
--   - Rewrite admin_place_country_overview to a single-pass CTE aggregate.
--     1 scan instead of 49. Expected: ~1-2s → <500ms.
--   - Leave admin_place_pool_overview as-is; the new index covers its slow
--     DISTINCT. If EXPLAIN post-deploy shows it still slow, apply the same
--     single-pass pattern as a follow-up.
--
-- Rollback:
--   - DROP the index; harmless removal.
--   - Re-apply previous admin_place_country_overview definition from git
--     history or pg_get_functiondef snapshot.
--
-- Systemic follow-up (ORCH-0481):
--   - This migration is the emergency narrow fix. 19 more admin RPCs have
--     the same pattern lurking. Proper fix is a materialized view layer.
--   - See prompts/IMPL_ORCH-0481_ADMIN_MV_LAYER.md.
-- ============================================================================

-- (No explicit BEGIN/COMMIT — Supabase CLI wraps migration in implicit txn.)

-- ----------------------------------------------------------------------------
-- Intervention 1: Expression index on ai_categories[1]
-- ----------------------------------------------------------------------------
-- CONCURRENTLY omitted because Supabase migrations wrap in a transaction.
-- Table is 63k rows; brief AccessExclusiveLock is acceptable.
-- Partial index mirrors the WHERE predicate used in the RPCs so the planner
-- can both filter AND group from the index alone.

CREATE INDEX IF NOT EXISTS idx_place_pool_ai_category_first
  ON public.place_pool ((ai_categories[1]))
  WHERE is_active = true
    AND ai_approved = true
    AND ai_categories IS NOT NULL
    AND array_length(ai_categories, 1) > 0;

-- ----------------------------------------------------------------------------
-- Intervention 2: Rewrite admin_place_country_overview to single-pass CTE
-- ----------------------------------------------------------------------------
-- Signature identical to the existing function (verified against
-- pg_get_functiondef 2026-04-17). Admin UI parses by column position/name
-- and will not break.
--
-- Correctness: the old function counted cities via per-country subquery;
-- the new version uses a separate CTE (`city_counts`) to count cities
-- independent of whether each city has any places. This preserves the
-- semantics of "how many cities in this country do we have configured",
-- not "how many cities in this country have seeded places".

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
  WITH place_stats AS (
    -- Single pass: join place_pool to its city's country.
    -- is_active filter applied in the join so non-active rows don't pollute
    -- aggregates. LEFT JOIN ensures countries with zero places still appear.
    SELECT
      sc.country_code,
      sc.country,
      pp.city_id,
      pp.ai_approved,
      pp.ai_categories,
      pp.stored_photo_urls
    FROM seeding_cities sc
    LEFT JOIN place_pool pp
      ON pp.city_id = sc.id
     AND pp.is_active = true
  ),
  per_country AS (
    SELECT
      ps.country_code,
      ps.country AS country_name,
      COUNT(*) FILTER (WHERE ps.ai_approved = true) AS ai_approved_places,
      COUNT(*) FILTER (
        WHERE ps.ai_approved = true
          AND ps.stored_photo_urls IS NOT NULL
          AND array_length(ps.stored_photo_urls, 1) > 0
      ) AS approved_with_photos,
      COUNT(*) FILTER (WHERE ps.ai_approved IS NOT NULL) AS ai_validated_count,
      COUNT(*) FILTER (WHERE ps.city_id IS NOT NULL) AS active_total,
      COUNT(DISTINCT ps.ai_categories[1]) FILTER (
        WHERE ps.ai_approved = true
          AND ps.ai_categories IS NOT NULL
          AND array_length(ps.ai_categories, 1) > 0
      ) AS category_coverage_stub
    FROM place_stats ps
    GROUP BY ps.country_code, ps.country
  ),
  city_counts AS (
    -- Count cities per country independently. Matches legacy semantics
    -- (COUNT DISTINCT on seeding_cities.id across all cities configured
    -- for the country, regardless of whether they have places yet).
    SELECT sc.country_code, COUNT(*)::bigint AS city_count
    FROM seeding_cities sc
    GROUP BY sc.country_code
  )
  SELECT
    pc.country_code,
    pc.country_name,
    cc.city_count,
    pc.ai_approved_places,
    CASE WHEN pc.ai_approved_places > 0
      THEN ROUND(pc.approved_with_photos * 100.0 / pc.ai_approved_places)::INTEGER
      ELSE 0 END AS photo_pct,
    CASE WHEN pc.active_total > 0
      THEN ROUND(pc.ai_validated_count * 100.0 / pc.active_total)::INTEGER
      ELSE 0 END AS ai_validated_pct,
    pc.category_coverage_stub::INTEGER AS category_coverage
  FROM per_country pc
  JOIN city_counts cc ON cc.country_code = pc.country_code
  ORDER BY pc.ai_approved_places DESC;
END;
$function$;

-- ----------------------------------------------------------------------------
-- Verification (run manually after deploy):
-- ----------------------------------------------------------------------------
-- 1. Index exists and is used:
--    EXPLAIN (ANALYZE)
--    SELECT ai_categories[1], COUNT(*) FROM place_pool
--    WHERE is_active AND ai_approved=true
--      AND ai_categories IS NOT NULL AND array_length(ai_categories,1) > 0
--    GROUP BY ai_categories[1];
--    Expect: "Index Scan using idx_place_pool_ai_category_first"
--
-- 2. admin_place_category_breakdown:
--    \timing
--    SELECT * FROM admin_place_category_breakdown();
--    Target: < 500ms (was 16.8s)
--
-- 3. admin_place_country_overview:
--    \timing
--    SELECT * FROM admin_place_country_overview();
--    Target: < 500ms. Compare row count + column values against a saved
--    snapshot of the legacy function output for semantic parity.
--
-- 4. admin_place_pool_overview:
--    \timing
--    SELECT * FROM admin_place_pool_overview();
--    Target: < 2s. If still > 3s, apply single-pass rewrite pattern to this
--    function as a follow-up.
