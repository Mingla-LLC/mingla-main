-- ORCH-0728 (2026-05-05): ALTER TABLE place_pool ADD COLUMN IF NOT EXISTS claimed_by UUID inserted near the top to neutralize SQLSTATE 42703 ("column pp.claimed_by does not exist") at the matview CREATE. Production has this column (added via Supabase dashboard direct ALTER); fresh-DB replay never had a backfilling migration. IF NOT EXISTS makes the ALTER a no-op on prod. Sibling fixes: ORCH-0721 commit 4e8f784d (CONCURRENTLY) + ORCH-0722 commit cd276c3b (OUT-param × 2) + ORCH-0727 commit 0b706dc3 (slug rename Option B). Forensics: ORCH-0728 schema-drift class — fix unbounded; squash-baseline (ORCH-0729) is the durable structural fix.
-- ============================================================================
-- ORCH-0481: Admin RPC Materialized View Layer (Systemic Fix)
-- ============================================================================
-- Supersedes: ORCH-0480 (partial-index approach — FAIL per QA verdict)
-- Dispatched: 2026-04-17 (DEC-021)
-- Prompt: Mingla_Artifacts/prompts/IMPL_ORCH-0481_ADMIN_MV_LAYER.md
--
-- WHY:
--   ORCH-0480 proved that a partial expression index on place_pool.ai_categories[1]
--   can only accelerate filter-narrowing — not projection of heap-resident columns
--   (stored_photo_urls, rating). All 3 admin Place Pool RPCs still >8s post-ORCH-0480.
--   Pure COUNT runs 53ms via Index-Only Scan but real RPCs cannot reach that path.
--
--   A materialized view flips the architecture: pre-compute the row-level projections
--   once per 10 minutes, then admin aggregates read the MV (small, dense, cached) instead
--   of place_pool (63k heap rows + TOAST'd arrays). Freshness trade: admin stats up to
--   10 min stale — acceptable for a dashboard.
--
-- WHAT THIS MIGRATION DOES:
--   1. Creates admin_place_pool_mv (all columns any admin aggregate needs)
--   2. Creates 5 covering indexes + UNIQUE index for CONCURRENT refresh
--   3. Schedules pg_cron refresh every 10 minutes
--   4. Adds admin_refresh_place_pool_mv() for on-demand refresh
--   5. Rewrites 20 of 22 admin_* RPCs to read from the MV
--      - Signatures byte-identical (admin UI needs zero changes)
--      - Auth checks preserved
--      - Semantic parity target: identical output for same inputs
--   6. Leaves admin_city_picker_data + admin_ai_validation_preview unchanged
--      (former needs empty-cities semantic; latter uses GIN on ai_categories)
--
-- ROLLBACK (single block at end of file, commented):
--   See "-- ROLLBACK:" section at bottom
--
-- DEPLOY:
--   supabase db push  (applies to linked project)
--   Then: SELECT COUNT(*) FROM admin_place_pool_mv;  -- expect ~63239
--   Then: reload admin Place Pool page — should load in <1s.
--
-- NOTE ON TIMESTAMPS:
--   Migration timestamp 20260418000001 — day after ORCH-0480 (20260417300001).
--   Convention: first migration of the day = ...000001.
-- ============================================================================


-- ============================================================================
-- WAVE 0: Raise statement_timeout for this migration
-- ============================================================================
-- Supabase's default statement_timeout (2 min) is not enough for the initial
-- populate of a 63k-row MV with derived expressions + LEFT JOIN. Migration runs
-- as the postgres/supabase_admin role which can raise its own timeout for the
-- duration of this transaction.
SET LOCAL statement_timeout = '15min';


-- ============================================================================
-- WAVE 1: Materialized View + Indexes
-- ============================================================================

-- ORCH-0728 (2026-05-05): Backfill missing claimed_by column before matview CREATE.
-- Production has this column; migration chain never added it. IF NOT EXISTS = no-op on prod.
ALTER TABLE public.place_pool ADD COLUMN IF NOT EXISTS claimed_by UUID;

-- Drop if exists (idempotent re-run safety). CASCADE removes any dependent RPCs
-- that might be recreated later in this same migration — intentional.
DROP MATERIALIZED VIEW IF EXISTS public.admin_place_pool_mv CASCADE;

-- WITH NO DATA creates the MV structure instantly (no scan). The initial
-- populate happens via REFRESH MATERIALIZED VIEW at the end of Wave 2, after
-- indexes exist — faster than building the MV and indexes in one pass.
CREATE MATERIALIZED VIEW public.admin_place_pool_mv AS
SELECT
  -- Identity
  pp.id,
  pp.google_place_id,
  pp.name,

  -- Location (both normalized from seeding_cities AND denormalized from place_pool)
  pp.city_id,
  sc.country_code,
  sc.country  AS country_name,    -- sc.country renamed for clarity in admin output
  sc.name     AS city_name,       -- sc.name renamed to match admin RPC return cols
  sc.status   AS city_status,
  pp.country  AS pp_country,      -- denormalized text; some legacy RPCs filter by this
  pp.city     AS pp_city,         -- denormalized text; some legacy RPCs filter by this

  -- Categorization
  pp.seeding_category,
  pp.ai_categories,
  COALESCE(pp.ai_categories[1], 'uncategorized') AS primary_category,
  pp.types,
  pp.primary_type,

  -- Quality / metadata
  pp.rating,
  pp.review_count,
  pp.price_level,
  pp.is_active,
  pp.ai_approved,                                  -- boolean: NULL = unvalidated, true = approved, false = rejected
  pp.ai_validated_at,
  pp.ai_validated_at IS NOT NULL AS ai_validated,  -- convenience boolean

  -- Photos
  pp.stored_photo_urls,
  (pp.stored_photo_urls IS NOT NULL
    AND array_length(pp.stored_photo_urls, 1) > 0
    AND pp.stored_photo_urls <> ARRAY['__backfill_failed__']::text[]) AS has_photos,
  COALESCE(array_length(pp.stored_photo_urls, 1), 0) AS photo_count,
  pp.photos,
  (pp.photos IS NOT NULL AND pp.photos <> '[]'::jsonb) AS has_photo_refs,

  -- Lifecycle timestamps
  pp.last_detail_refresh,
  pp.updated_at,
  pp.created_at,

  -- Claim status
  pp.claimed_by IS NOT NULL AS is_claimed
FROM public.place_pool pp
LEFT JOIN public.seeding_cities sc ON pp.city_id = sc.id
WITH NO DATA;

COMMENT ON MATERIALIZED VIEW public.admin_place_pool_mv IS
  'ORCH-0481 admin aggregate source. Refreshed every 10 min via pg_cron. '
  'All admin_* RPCs that aggregate place_pool read from here, not from place_pool directly. '
  'See Mingla_Artifacts/prompts/IMPL_ORCH-0481_ADMIN_MV_LAYER.md for rationale.';


-- UNIQUE index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX admin_place_pool_mv_pkey
  ON public.admin_place_pool_mv (id);

-- Covering indexes for the top query shapes (confirmed via function-body audit)

-- City-scoped aggregates (admin_place_pool_overview city branch, admin_place_photo_stats, admin_ai_city_overview)
CREATE INDEX admin_place_pool_mv_city_active_approved
  ON public.admin_place_pool_mv (city_id, is_active, ai_approved);

-- Country-scoped aggregates (admin_place_pool_overview country branch, admin_place_city_overview)
CREATE INDEX admin_place_pool_mv_country_active_approved
  ON public.admin_place_pool_mv (country_code, is_active, ai_approved);

-- Category breakdown (admin_place_category_breakdown GROUP BY primary_category)
CREATE INDEX admin_place_pool_mv_primary_category
  ON public.admin_place_pool_mv (primary_category)
  WHERE is_active = true AND ai_approved = true;

-- Denormalized text-column queries (admin_country_overview, admin_country_city_overview, admin_place_pool_country_list)
CREATE INDEX admin_place_pool_mv_pp_country_city
  ON public.admin_place_pool_mv (pp_country, pp_city)
  WHERE is_active = true;

-- Seeding-category breakdown (admin_pool_category_health)
CREATE INDEX admin_place_pool_mv_seeding_category
  ON public.admin_place_pool_mv (seeding_category)
  WHERE is_active = true AND seeding_category IS NOT NULL;


-- Grant SELECT to authenticated so SECURITY DEFINER functions can read it.
-- RLS on the MV is NOT enabled — all access gates through the RPCs which do admin_users check.
GRANT SELECT ON public.admin_place_pool_mv TO authenticated;
GRANT SELECT ON public.admin_place_pool_mv TO service_role;


-- ============================================================================
-- WAVE 2: Scheduled refresh + manual refresh RPC
-- ============================================================================

-- Unschedule prior job if re-running (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('refresh_admin_place_pool_mv');
EXCEPTION WHEN OTHERS THEN NULL;  -- silent if not scheduled
END $$;

-- Schedule refresh every 10 minutes. CONCURRENTLY means reads don't block.
SELECT cron.schedule(
  'refresh_admin_place_pool_mv',
  '*/10 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_place_pool_mv$$
);

-- Manual refresh RPC — admin can trigger post ai-verify scope=all or major writes
CREATE OR REPLACE FUNCTION public.admin_refresh_place_pool_mv()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION public.admin_refresh_place_pool_mv() TO authenticated;


-- One-shot initial population (before cron's first tick)
REFRESH MATERIALIZED VIEW public.admin_place_pool_mv;


-- ============================================================================
-- WAVE 3: Rewrite admin_* RPCs to read from admin_place_pool_mv
-- ============================================================================
-- All signatures byte-identical to legacy. Auth checks preserved at top of BEGIN.
-- STABLE SECURITY DEFINER + search_path=public preserved.
-- Legacy text "pp" variable name kept in places where it reduces diff noise;
-- source FROM clause swapped to admin_place_pool_mv (aliased as mv or pp for clarity).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. admin_place_pool_overview (unscoped + city-scoped + country-scoped branches)
-- ----------------------------------------------------------------------------
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
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  -- Single unified query — MV handles filter + projection efficiently at every scope.
  -- No branching needed; WHERE predicate handles all three scopes via NULL-short-circuits.
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total_places,
    COUNT(*) FILTER (WHERE mv.is_active)::BIGINT AS active_places,
    COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true)::BIGINT AS ai_approved_places,
    COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true AND mv.has_photos)::BIGINT AS with_photos,
    CASE WHEN COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true AND mv.has_photos) * 100.0
        / COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true)
      )::INTEGER
      ELSE 0
    END AS photo_pct,
    COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved IS NOT NULL)::BIGINT AS ai_validated_count,
    COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = true)::BIGINT AS ai_approved_count,
    COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved = false)::BIGINT AS ai_rejected_count,
    COUNT(*) FILTER (WHERE mv.is_active AND mv.ai_approved IS NULL)::BIGINT AS ai_pending_count,
    COUNT(DISTINCT mv.primary_category) FILTER (
      WHERE mv.is_active AND mv.ai_approved = true AND mv.primary_category <> 'uncategorized'
    )::INTEGER AS distinct_categories
  FROM admin_place_pool_mv mv
  WHERE (p_city_id IS NULL OR mv.city_id = p_city_id)
    AND (p_country_code IS NULL OR mv.country_code = p_country_code);
END;
$function$;


-- ----------------------------------------------------------------------------
-- 2. admin_place_category_breakdown
-- ----------------------------------------------------------------------------
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
    AND mv.ai_approved = true
    AND mv.primary_category <> 'uncategorized'
    AND (p_city_id IS NULL OR mv.city_id = p_city_id)
    AND (p_country_code IS NULL OR mv.country_code = p_country_code)
  GROUP BY mv.primary_category
  ORDER BY COUNT(*) DESC;
END;
$function$;


-- ----------------------------------------------------------------------------
-- 3. admin_place_country_overview (supersedes ORCH-0480 rewrite; now MV-backed)
-- ----------------------------------------------------------------------------
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

  -- Match legacy semantics: country_code and city_count come from seeding_cities universe
  -- (so countries with 0 places still appear). MV gives per-place stats; join with a
  -- seeding_cities city-count aggregate to preserve the invariant.
  RETURN QUERY
  WITH per_country AS (
    SELECT
      sc.country_code,
      sc.country AS country_name,
      COUNT(mv.*) FILTER (WHERE mv.is_active AND mv.ai_approved = true) AS ai_approved_places,
      COUNT(mv.*) FILTER (WHERE mv.is_active AND mv.ai_approved = true AND mv.has_photos) AS approved_with_photos,
      COUNT(mv.*) FILTER (WHERE mv.is_active AND mv.ai_approved IS NOT NULL) AS ai_validated_count,
      COUNT(mv.*) FILTER (WHERE mv.is_active) AS active_total,
      COUNT(DISTINCT mv.primary_category) FILTER (
        WHERE mv.is_active AND mv.ai_approved = true AND mv.primary_category <> 'uncategorized'
      ) AS category_coverage
    FROM seeding_cities sc
    LEFT JOIN admin_place_pool_mv mv ON mv.city_id = sc.id
    GROUP BY sc.country_code, sc.country
  ),
  city_counts AS (
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
      ELSE 0
    END AS photo_pct,
    CASE WHEN pc.active_total > 0
      THEN ROUND(pc.ai_validated_count * 100.0 / pc.active_total)::INTEGER
      ELSE 0
    END AS ai_validated_pct,
    pc.category_coverage::INTEGER
  FROM per_country pc
  JOIN city_counts cc ON cc.country_code = pc.country_code
  ORDER BY pc.ai_approved_places DESC;
END;
$function$;


-- ----------------------------------------------------------------------------
-- 4. admin_place_city_overview (per-city stats within a country)
-- ----------------------------------------------------------------------------
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

  -- Preserve legacy semantics: ALL seeding_cities for this country appear,
  -- even those with zero places (LEFT JOIN to MV).
  RETURN QUERY
  SELECT
    sc.id AS city_id,
    sc.name AS city_name,
    COUNT(mv.*) FILTER (WHERE mv.is_active AND mv.ai_approved = true)::BIGINT AS ai_approved_places,
    CASE WHEN COUNT(mv.*) FILTER (WHERE mv.is_active AND mv.ai_approved = true) > 0
      THEN ROUND(
        COUNT(mv.*) FILTER (WHERE mv.is_active AND mv.ai_approved = true AND mv.has_photos) * 100.0
        / COUNT(mv.*) FILTER (WHERE mv.is_active AND mv.ai_approved = true)
      )::INTEGER
      ELSE 0
    END AS photo_pct,
    CASE WHEN COUNT(mv.*) FILTER (WHERE mv.is_active) > 0
      THEN ROUND(
        COUNT(mv.*) FILTER (WHERE mv.is_active AND mv.ai_approved IS NOT NULL) * 100.0
        / COUNT(mv.*) FILTER (WHERE mv.is_active)
      )::INTEGER
      ELSE 0
    END AS ai_validated_pct,
    COUNT(DISTINCT mv.primary_category) FILTER (
      WHERE mv.is_active AND mv.ai_approved = true AND mv.primary_category <> 'uncategorized'
    )::INTEGER AS category_coverage,
    ROUND((AVG(mv.rating) FILTER (WHERE mv.is_active AND mv.ai_approved = true AND mv.rating IS NOT NULL))::NUMERIC, 1) AS avg_rating
  FROM seeding_cities sc
  LEFT JOIN admin_place_pool_mv mv ON mv.city_id = sc.id
  WHERE sc.country_code = p_country_code
  GROUP BY sc.id, sc.name
  ORDER BY COUNT(mv.*) FILTER (WHERE mv.is_active AND mv.ai_approved = true) DESC;
END;
$function$;


-- ----------------------------------------------------------------------------
-- 5. admin_place_photo_stats (per-city photo coverage)
-- ----------------------------------------------------------------------------
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

  -- Legacy filtered out __backfill_failed__ sentinel. has_photos in MV already does that.
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total_places,
    COUNT(*) FILTER (WHERE mv.has_photos)::BIGINT AS with_photos,
    COUNT(*) FILTER (WHERE NOT mv.has_photos)::BIGINT AS without_photos
  FROM admin_place_pool_mv mv
  WHERE mv.city_id = p_city_id
    AND mv.is_active
    AND mv.ai_approved = true;
END;
$function$;


-- ----------------------------------------------------------------------------
-- 6. admin_place_pool_city_list (cities within a country, for card-generate workflow)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_place_pool_city_list(p_country text)
RETURNS TABLE(
  city_name text,
  approved_places bigint,
  with_photos bigint,
  existing_cards bigint,
  ready_to_generate bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  -- Legacy used pp.country / pp.city (denormalized text). MV has those as pp_country/pp_city.
  -- existing_cards + ready_to_generate join to card_pool live — card_pool is small (~9k rows).
  RETURN QUERY
  SELECT
    COALESCE(mv.pp_city, 'Unknown City') AS city_name,
    COUNT(*) FILTER (WHERE mv.ai_approved = TRUE) AS approved_places,
    COUNT(*) FILTER (WHERE mv.ai_approved = TRUE AND mv.has_photos) AS with_photos,
    (SELECT COUNT(*) FROM public.card_pool cp
     WHERE cp.city = mv.pp_city AND cp.country = p_country
       AND cp.is_active = TRUE AND cp.card_type = 'single') AS existing_cards,
    COUNT(*) FILTER (
      WHERE mv.ai_approved = TRUE
        AND mv.has_photos
        AND NOT EXISTS (
          SELECT 1 FROM public.card_pool cp
          WHERE cp.google_place_id = mv.google_place_id AND cp.is_active = TRUE
        )
    ) AS ready_to_generate
  FROM admin_place_pool_mv mv
  WHERE mv.is_active = TRUE
    AND mv.pp_country = p_country
  GROUP BY mv.pp_city
  ORDER BY approved_places DESC;
END;
$function$;


-- ----------------------------------------------------------------------------
-- 7. admin_place_pool_country_list
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_place_pool_country_list()
RETURNS TABLE(
  country text,
  approved_places bigint,
  with_photos bigint,
  existing_cards bigint
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
    COALESCE(mv.pp_country, 'Unknown') AS country,
    COUNT(*) FILTER (WHERE mv.ai_approved = TRUE) AS approved_places,
    COUNT(*) FILTER (WHERE mv.ai_approved = TRUE AND mv.has_photos) AS with_photos,
    (SELECT COUNT(*) FROM public.card_pool cp
     WHERE cp.country = mv.pp_country AND cp.is_active = TRUE) AS existing_cards
  FROM admin_place_pool_mv mv
  WHERE mv.is_active = TRUE
  GROUP BY mv.pp_country
  ORDER BY approved_places DESC;
END;
$function$;


-- ----------------------------------------------------------------------------
-- 8. admin_ai_category_health (unnests ai_categories for per-category validation %)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ai_category_health()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  result JSON;
  latest_job_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT id INTO latest_job_id FROM ai_validation_jobs
  WHERE status = 'completed' ORDER BY completed_at DESC NULLS LAST LIMIT 1;

  SELECT json_agg(row_to_json(t)) INTO result FROM (
    SELECT cat.category, cat.total, cat.validated, cat.pct_validated,
           COALESCE(rej.rejected_last_run, 0) AS rejected_last_run
    FROM (
      -- unnest ai_categories from MV (not place_pool)
      SELECT unnest(mv.ai_categories) AS category,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE mv.ai_validated) AS validated,
             ROUND(COUNT(*) FILTER (WHERE mv.ai_validated) * 100.0 / NULLIF(COUNT(*), 0), 1) AS pct_validated
      FROM admin_place_pool_mv mv
      WHERE mv.is_active = true AND mv.ai_categories IS NOT NULL
      GROUP BY unnest(mv.ai_categories)
    ) cat
    LEFT JOIN (
      SELECT unnest(new_categories) AS category, COUNT(*) AS rejected_last_run
      FROM ai_validation_results WHERE job_id = latest_job_id AND decision = 'reject'
      GROUP BY unnest(new_categories)
    ) rej ON rej.category = cat.category
    ORDER BY cat.category
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$function$;


-- ----------------------------------------------------------------------------
-- 9. admin_ai_city_overview (single city AI validation stats)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ai_city_overview(p_city_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  result JSON;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT json_build_object(
    'total_active',  COUNT(*) FILTER (WHERE is_active = true),
    'validated',     COUNT(*) FILTER (WHERE is_active = true AND ai_approved IS NOT NULL),
    'unvalidated',   COUNT(*) FILTER (WHERE is_active = true AND ai_approved IS NULL),
    'approved',      COUNT(*) FILTER (WHERE is_active = true AND ai_approved = true),
    'rejected',      COUNT(*) FILTER (WHERE is_active = true AND ai_approved = false)
  ) INTO result FROM admin_place_pool_mv WHERE city_id = p_city_id;

  RETURN result;
END;
$function$;


-- ----------------------------------------------------------------------------
-- 10. admin_ai_city_stats (all cities, AI validation bucket counts)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ai_city_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
      SELECT
        mv.city_id,
        mv.city_name,
        mv.country_name AS country,
        COUNT(*) AS total_active,
        COUNT(*) FILTER (WHERE mv.ai_approved = true) AS approved,
        COUNT(*) FILTER (WHERE mv.ai_approved = false) AS rejected,
        COUNT(*) FILTER (WHERE mv.ai_approved IS NULL) AS unvalidated
      FROM admin_place_pool_mv mv
      WHERE mv.is_active = true
        AND mv.city_id IS NOT NULL
      GROUP BY mv.city_id, mv.city_name, mv.country_name
      ORDER BY COUNT(*) FILTER (WHERE mv.ai_approved IS NULL) DESC, mv.city_name
    ) t
  );
END;
$function$;


-- ----------------------------------------------------------------------------
-- 11. admin_ai_validation_overview (global AI validation summary)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ai_validation_overview()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  result JSON;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = lower(auth.email()) AND status = 'active') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT json_build_object(
    'total_active',  COUNT(*) FILTER (WHERE is_active = true),
    'validated',     COUNT(*) FILTER (WHERE is_active = true AND ai_approved IS NOT NULL),
    'unvalidated',   COUNT(*) FILTER (WHERE is_active = true AND ai_approved IS NULL),
    'approved',      COUNT(*) FILTER (WHERE is_active = true AND ai_approved = true),
    'rejected',      COUNT(*) FILTER (WHERE is_active = true AND ai_approved = false),
    'failed',        COUNT(*) FILTER (WHERE is_active = true AND ai_validated AND ai_approved IS NULL)
  ) INTO result FROM admin_place_pool_mv;

  RETURN result;
END;
$function$;


-- ----------------------------------------------------------------------------
-- 12. admin_photo_pool_summary (photo coverage + cost monitor)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_photo_pool_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Config lookup (unchanged)
  SELECT COALESCE((SELECT (value)::numeric FROM admin_config WHERE key = 'cost_alert_threshold_monthly_usd'), 50) INTO v_config_threshold;
  SELECT COALESCE((SELECT (value)::numeric FROM admin_config WHERE key = 'avg_impressions_per_place_per_day'), 2.5) INTO v_config_avg_impressions;
  SELECT COALESCE((SELECT (value)::numeric FROM admin_config WHERE key = 'google_photo_cost_per_view'), 0.007) INTO v_config_photo_cost;

  -- Three COUNTs against MV (was three full place_pool scans)
  SELECT COUNT(*) INTO v_total_places FROM admin_place_pool_mv WHERE is_active = true;
  SELECT COUNT(*) INTO v_with_photos FROM admin_place_pool_mv WHERE is_active = true AND has_photos;
  SELECT COUNT(*) INTO v_missing_photos FROM admin_place_pool_mv
    WHERE is_active = true AND NOT has_photos AND has_photo_refs;

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
$function$;


-- ----------------------------------------------------------------------------
-- 13. admin_country_overview (place + card stats by denormalized country text)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_country_overview()
RETURNS TABLE(
  country text,
  total_places bigint,
  active_places bigint,
  with_photos bigint,
  photo_pct integer,
  category_coverage integer,
  total_cards bigint,
  uncategorized_count bigint,
  city_count bigint,
  card_image_pct integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  WITH card_counts AS (
    SELECT
      COALESCE(cp.country, 'Unknown') AS c_country,
      COUNT(*) AS cnt,
      COUNT(*) FILTER (WHERE cp.image_url IS NOT NULL) AS with_images
    FROM public.card_pool cp
    WHERE cp.is_active
    GROUP BY COALESCE(cp.country, 'Unknown')
  )
  SELECT
    COALESCE(mv.pp_country, 'Unknown') AS country,
    COUNT(*) AS total_places,
    COUNT(*) FILTER (WHERE mv.is_active) AS active_places,
    COUNT(*) FILTER (WHERE mv.is_active AND mv.has_photos) AS with_photos,
    CASE WHEN COUNT(*) FILTER (WHERE mv.is_active) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE mv.is_active AND mv.has_photos) * 100.0
        / COUNT(*) FILTER (WHERE mv.is_active)
      )::INTEGER
      ELSE 0
    END AS photo_pct,
    COUNT(DISTINCT mv.seeding_category) FILTER (
      WHERE mv.is_active AND mv.seeding_category IS NOT NULL
    )::INTEGER AS category_coverage,
    COALESCE(cc.cnt, 0) AS total_cards,
    COUNT(*) FILTER (WHERE mv.is_active AND mv.seeding_category IS NULL) AS uncategorized_count,
    COUNT(DISTINCT mv.pp_city) FILTER (WHERE mv.pp_city IS NOT NULL) AS city_count,
    CASE WHEN COALESCE(cc.cnt, 0) > 0
      THEN ROUND(COALESCE(cc.with_images, 0) * 100.0 / cc.cnt)::INTEGER
      ELSE 0
    END AS card_image_pct
  FROM admin_place_pool_mv mv
  LEFT JOIN card_counts cc ON cc.c_country = COALESCE(mv.pp_country, 'Unknown')
  GROUP BY COALESCE(mv.pp_country, 'Unknown'), cc.cnt, cc.with_images
  ORDER BY COUNT(*) FILTER (WHERE mv.is_active) DESC;
END;
$function$;


-- ----------------------------------------------------------------------------
-- 14. admin_country_city_overview (per-city stats by denormalized country text)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_country_city_overview(p_country text)
RETURNS TABLE(
  city_name text,
  total_places bigint,
  active_places bigint,
  with_photos bigint,
  photo_pct integer,
  category_coverage integer,
  total_cards bigint,
  avg_rating numeric,
  freshness_pct integer,
  uncategorized_count bigint,
  card_image_pct integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  WITH card_counts AS (
    SELECT
      COALESCE(cp.city, 'Unknown City') AS c_city,
      COUNT(*) AS cnt,
      COUNT(*) FILTER (WHERE cp.image_url IS NOT NULL) AS with_images
    FROM public.card_pool cp
    WHERE cp.country = p_country AND cp.is_active
    GROUP BY COALESCE(cp.city, 'Unknown City')
  )
  SELECT
    COALESCE(mv.pp_city, 'Unknown City') AS city_name,
    COUNT(*) AS total_places,
    COUNT(*) FILTER (WHERE mv.is_active) AS active_places,
    COUNT(*) FILTER (WHERE mv.is_active AND mv.has_photos) AS with_photos,
    CASE WHEN COUNT(*) FILTER (WHERE mv.is_active) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE mv.is_active AND mv.has_photos) * 100.0
        / COUNT(*) FILTER (WHERE mv.is_active)
      )::INTEGER
      ELSE 0
    END AS photo_pct,
    COUNT(DISTINCT mv.seeding_category) FILTER (
      WHERE mv.is_active AND mv.seeding_category IS NOT NULL
    )::INTEGER AS category_coverage,
    COALESCE(cc.cnt, 0) AS total_cards,
    ROUND((AVG(mv.rating) FILTER (WHERE mv.is_active AND mv.rating IS NOT NULL))::NUMERIC, 1) AS avg_rating,
    CASE WHEN COUNT(*) FILTER (WHERE mv.is_active) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE mv.is_active AND mv.last_detail_refresh > NOW() - INTERVAL '7 days') * 100.0
        / COUNT(*) FILTER (WHERE mv.is_active)
      )::INTEGER
      ELSE 0
    END AS freshness_pct,
    COUNT(*) FILTER (WHERE mv.is_active AND mv.seeding_category IS NULL) AS uncategorized_count,
    CASE WHEN COALESCE(cc.cnt, 0) > 0
      THEN ROUND(COALESCE(cc.with_images, 0) * 100.0 / cc.cnt)::INTEGER
      ELSE 0
    END AS card_image_pct
  FROM admin_place_pool_mv mv
  LEFT JOIN card_counts cc ON cc.c_city = COALESCE(mv.pp_city, 'Unknown City')
  WHERE mv.pp_country = p_country
  GROUP BY COALESCE(mv.pp_city, 'Unknown City'), cc.cnt, cc.with_images
  ORDER BY COUNT(*) FILTER (WHERE mv.is_active) DESC;
END;
$function$;


-- ----------------------------------------------------------------------------
-- 15. admin_pool_category_health (places-vs-cards per seeding_category)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_pool_category_health(
  p_country text DEFAULT NULL::text,
  p_city text DEFAULT NULL::text
)
RETURNS TABLE(
  category text,
  total_places bigint,
  active_places bigint,
  with_photos bigint,
  photo_pct integer,
  avg_rating numeric,
  total_cards bigint,
  single_cards bigint,
  curated_cards bigint,
  places_needing_cards bigint,
  health text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users WHERE email = auth.email() AND status = 'active'
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;

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
  ),
  card_stats AS (
    SELECT
      cp.category,
      COUNT(*) AS total_cards,
      COUNT(*) FILTER (WHERE cp.card_type = 'single') AS single_cards,
      COUNT(*) FILTER (WHERE cp.card_type = 'curated') AS curated_cards
    FROM public.card_pool cp
    WHERE cp.is_active
      AND (p_country IS NULL OR cp.country = p_country)
      AND (p_city IS NULL OR cp.city = p_city)
    GROUP BY cp.category
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
    COALESCE(cs.total_cards, 0) AS total_cards,
    COALESCE(cs.single_cards, 0) AS single_cards,
    COALESCE(cs.curated_cards, 0) AS curated_cards,
    GREATEST(ps.active_places - COALESCE(cs.total_cards, 0), 0) AS places_needing_cards,
    CASE
      WHEN COALESCE(cs.total_cards, 0) >= ps.active_places * 0.8 THEN 'green'
      WHEN COALESCE(cs.total_cards, 0) >= ps.active_places * 0.5 THEN 'yellow'
      ELSE 'red'
    END AS health
  FROM place_stats ps
  LEFT JOIN card_stats cs ON cs.category = ps.seeding_category
  ORDER BY ps.active_places DESC;
END;
$function$;


-- ----------------------------------------------------------------------------
-- 16. admin_pool_stats_overview (the 7,425-char monster)
-- ----------------------------------------------------------------------------
-- Partial win: photo_health section reads from MV. location_buckets/missing_places/
-- refresh_health still read card_pool + user_card_impressions live (not place_pool
-- perf risk).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_pool_stats_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_rh_total_active BIGINT;
  v_rh_stale_7d BIGINT;
  v_rh_stale_30d BIGINT;
  v_rh_recently_served_stale BIGINT;
BEGIN
  SELECT is_admin_user() INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: admin access required';
  END IF;

  SELECT COALESCE((SELECT (value)::numeric FROM admin_config WHERE key = 'cost_alert_threshold_monthly_usd'), 50) INTO v_config_threshold;
  SELECT COALESCE((SELECT (value)::numeric FROM admin_config WHERE key = 'avg_impressions_per_place_per_day'), 2.5) INTO v_config_avg_impressions;
  SELECT COALESCE((SELECT (value)::numeric FROM admin_config WHERE key = 'google_photo_cost_per_view'), 0.007) INTO v_config_photo_cost;

  -- Photo health — NOW FROM MV
  SELECT
    COUNT(*) FILTER (WHERE is_active),
    COUNT(*) FILTER (WHERE is_active AND has_photos),
    COUNT(*) FILTER (WHERE is_active AND NOT has_photos AND has_photo_refs)
  INTO v_total_places, v_with_photos, v_missing_photos
  FROM admin_place_pool_mv;

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

  -- Categories (card_pool — unchanged, card_pool is ~9k rows, not a perf risk)
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

  -- Location buckets (card_pool — unchanged)
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

  -- Cost monitor (unchanged)
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

  -- Missing places — NOW reads place identity from MV, joins card_pool + impressions live.
  SELECT COALESCE(jsonb_agg(row_to_json(mp)::jsonb), '[]'::jsonb)
  INTO v_missing_places
  FROM (
    SELECT
      mv.id AS place_pool_id,
      mv.google_place_id,
      mv.name,
      mv.primary_type,
      COALESCE(jsonb_array_length(mv.photos), 0) AS photo_refs_count,
      COUNT(DISTINCT cp.id) AS card_count,
      COALESCE(SUM(imp.impression_count), 0) AS total_impressions
    FROM admin_place_pool_mv mv
    LEFT JOIN card_pool cp ON cp.place_pool_id = mv.id AND cp.is_active = true
    LEFT JOIN (
      SELECT card_pool_id, COUNT(*) AS impression_count
      FROM user_card_impressions
      GROUP BY card_pool_id
    ) imp ON imp.card_pool_id = cp.id
    WHERE mv.is_active = true
      AND NOT mv.has_photos
      AND mv.has_photo_refs
    GROUP BY mv.id, mv.google_place_id, mv.name, mv.primary_type, mv.photos
    ORDER BY COALESCE(SUM(imp.impression_count), 0) DESC
    LIMIT 200
  ) mp;

  -- Refresh health — MV gives the totals; the recently-served-stale join touches card_pool + impressions.
  SELECT
    COUNT(*) FILTER (WHERE is_active),
    COUNT(*) FILTER (WHERE is_active AND last_detail_refresh < now() - interval '7 days'),
    COUNT(*) FILTER (WHERE is_active AND last_detail_refresh < now() - interval '30 days')
  INTO v_rh_total_active, v_rh_stale_7d, v_rh_stale_30d
  FROM admin_place_pool_mv;

  SELECT COUNT(DISTINCT mv.id)
  INTO v_rh_recently_served_stale
  FROM admin_place_pool_mv mv
  JOIN card_pool cp ON cp.place_pool_id = mv.id AND cp.is_active = true
  JOIN user_card_impressions uci ON uci.card_pool_id = cp.id
  WHERE mv.is_active = true
    AND mv.last_detail_refresh < now() - interval '7 days'
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
$function$;


-- ----------------------------------------------------------------------------
-- 17. admin_card_pool_intelligence (card_pool primary; place_pool for orphan/stale checks via MV)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_card_pool_intelligence(
  p_city_id uuid DEFAULT NULL::uuid,
  p_country_code text DEFAULT NULL::text
)
RETURNS TABLE(
  total_cards bigint,
  active_cards bigint,
  inactive_cards bigint,
  single_cards bigint,
  curated_cards bigint,
  with_images bigint,
  image_pct integer,
  orphaned_cards bigint,
  stale_cards bigint,
  total_impressions bigint,
  total_served bigint,
  never_served bigint,
  avg_served_count numeric,
  categories_covered integer,
  by_category jsonb
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
  WITH cards AS (
    SELECT cp.*
    FROM card_pool cp
    WHERE (p_city_id IS NULL OR cp.city_id = p_city_id)
      AND (p_country_code IS NULL OR cp.city_id IN (
        SELECT sc.id FROM seeding_cities sc WHERE sc.country_code = p_country_code
      ))
  ),
  cat_breakdown AS (
    SELECT jsonb_object_agg(
      cat,
      jsonb_build_object('total', cnt, 'active', active_cnt, 'single', single_cnt, 'curated', curated_cnt)
    ) AS by_cat
    FROM (
      SELECT c.category AS cat, COUNT(*) AS cnt,
        COUNT(*) FILTER (WHERE c.is_active) AS active_cnt,
        COUNT(*) FILTER (WHERE c.card_type = 'single') AS single_cnt,
        COUNT(*) FILTER (WHERE c.card_type = 'curated') AS curated_cnt
      FROM cards c WHERE c.category IS NOT NULL GROUP BY c.category
    ) sub
  ),
  impressions AS (
    SELECT COUNT(*) AS total_imp
    FROM user_card_impressions uci
    WHERE EXISTS (SELECT 1 FROM cards c WHERE c.id = uci.card_pool_id)
  )
  SELECT
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE c.is_active)::BIGINT,
    COUNT(*) FILTER (WHERE NOT c.is_active)::BIGINT,
    COUNT(*) FILTER (WHERE c.card_type = 'single')::BIGINT,
    COUNT(*) FILTER (WHERE c.card_type = 'curated')::BIGINT,
    COUNT(*) FILTER (WHERE c.image_url IS NOT NULL)::BIGINT,
    CASE WHEN COUNT(*) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE c.image_url IS NOT NULL) * 100.0 / COUNT(*))::INTEGER
      ELSE 0 END,
    -- Orphaned: active single cards whose place_pool ref is missing or inactive (from MV now)
    COUNT(*) FILTER (WHERE c.is_active AND c.card_type = 'single' AND (
      c.place_pool_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM admin_place_pool_mv mv WHERE mv.id = c.place_pool_id AND mv.is_active
      )
    ))::BIGINT,
    -- Stale: active single cards whose place_pool.updated_at is >30d old (from MV now)
    COUNT(*) FILTER (WHERE c.is_active AND c.card_type = 'single'
      AND c.place_pool_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM admin_place_pool_mv mv WHERE mv.id = c.place_pool_id
          AND mv.updated_at > now() - interval '30 days'
      )
    )::BIGINT,
    COALESCE((SELECT total_imp FROM impressions), 0)::BIGINT,
    COUNT(*) FILTER (WHERE c.is_active AND c.served_count > 0)::BIGINT,
    COUNT(*) FILTER (WHERE c.is_active AND (c.served_count IS NULL OR c.served_count = 0))::BIGINT,
    ROUND((AVG(c.served_count) FILTER (WHERE c.is_active AND c.served_count > 0))::NUMERIC, 1),
    COUNT(DISTINCT c.category) FILTER (WHERE c.is_active AND c.category IS NOT NULL)::INTEGER,
    COALESCE((SELECT by_cat FROM cat_breakdown), '{}'::JSONB)
  FROM cards c;
END;
$function$;


-- ----------------------------------------------------------------------------
-- 18. admin_card_category_health
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_card_category_health(
  p_city_id uuid DEFAULT NULL::uuid,
  p_country_code text DEFAULT NULL::text
)
RETURNS TABLE(
  category text,
  total_cards bigint,
  active_cards bigint,
  single_cards bigint,
  curated_cards bigint,
  with_images bigint,
  card_image_pct integer,
  total_served bigint,
  never_served bigint,
  avg_served_count numeric,
  orphaned_cards bigint,
  health text
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
    cp.category,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE cp.is_active)::BIGINT,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'single')::BIGINT,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'curated')::BIGINT,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.image_url IS NOT NULL)::BIGINT,
    CASE WHEN COUNT(*) FILTER (WHERE cp.is_active) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE cp.is_active AND cp.image_url IS NOT NULL) * 100.0
        / COUNT(*) FILTER (WHERE cp.is_active))::INTEGER ELSE 0 END,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.served_count > 0)::BIGINT,
    COUNT(*) FILTER (WHERE cp.is_active AND (cp.served_count IS NULL OR cp.served_count = 0))::BIGINT,
    ROUND((AVG(cp.served_count) FILTER (WHERE cp.is_active AND cp.served_count > 0))::NUMERIC, 1),
    -- Orphan check now against MV
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'single' AND (
      cp.place_pool_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM admin_place_pool_mv mv WHERE mv.id = cp.place_pool_id AND mv.is_active
      )
    ))::BIGINT,
    CASE
      WHEN COUNT(*) FILTER (WHERE cp.is_active AND cp.served_count > 0)
           >= COUNT(*) FILTER (WHERE cp.is_active) * 0.5 THEN 'green'
      WHEN COUNT(*) FILTER (WHERE cp.is_active AND cp.served_count > 0)
           >= COUNT(*) FILTER (WHERE cp.is_active) * 0.2 THEN 'yellow'
      ELSE 'red'
    END
  FROM card_pool cp
  WHERE cp.category IS NOT NULL
    AND (p_city_id IS NULL OR cp.city_id = p_city_id)
    AND (p_country_code IS NULL OR cp.city_id IN (
      SELECT sc.id FROM seeding_cities sc WHERE sc.country_code = p_country_code
    ))
  GROUP BY cp.category
  ORDER BY COUNT(*) FILTER (WHERE cp.is_active) DESC;
END;
$function$;


-- ----------------------------------------------------------------------------
-- 19. admin_card_city_overview
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_card_city_overview(p_country_code text)
RETURNS TABLE(
  city_id uuid,
  city_name text,
  total_cards bigint,
  active_cards bigint,
  card_image_pct integer,
  single_cards bigint,
  curated_cards bigint,
  served_pct integer,
  never_served bigint,
  orphaned_cards bigint,
  categories_covered integer
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
    sc.id AS city_id,
    sc.name AS city_name,
    COUNT(*)::BIGINT AS total_cards,
    COUNT(*) FILTER (WHERE cp.is_active)::BIGINT AS active_cards,
    CASE WHEN COUNT(*) FILTER (WHERE cp.is_active) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE cp.is_active AND cp.image_url IS NOT NULL) * 100.0
        / COUNT(*) FILTER (WHERE cp.is_active))::INTEGER ELSE 0 END AS card_image_pct,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'single')::BIGINT AS single_cards,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'curated')::BIGINT AS curated_cards,
    CASE WHEN COUNT(*) FILTER (WHERE cp.is_active) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE cp.is_active AND cp.served_count > 0) * 100.0
        / COUNT(*) FILTER (WHERE cp.is_active))::INTEGER ELSE 0 END AS served_pct,
    COUNT(*) FILTER (WHERE cp.is_active AND (cp.served_count IS NULL OR cp.served_count = 0))::BIGINT AS never_served,
    -- Orphan check against MV
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'single' AND (
      cp.place_pool_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM admin_place_pool_mv mv WHERE mv.id = cp.place_pool_id AND mv.is_active
      )
    ))::BIGINT AS orphaned_cards,
    COUNT(DISTINCT cp.category) FILTER (WHERE cp.is_active AND cp.category IS NOT NULL)::INTEGER AS categories_covered
  FROM card_pool cp
  JOIN seeding_cities sc ON cp.city_id = sc.id
  WHERE sc.country_code = p_country_code
  GROUP BY sc.id, sc.name
  ORDER BY COUNT(*) FILTER (WHERE cp.is_active) DESC;
END;
$function$;


-- ----------------------------------------------------------------------------
-- 20. admin_card_country_overview
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_card_country_overview()
RETURNS TABLE(
  country_code text,
  country_name text,
  total_cards bigint,
  active_cards bigint,
  card_image_pct integer,
  single_cards bigint,
  curated_cards bigint,
  served_pct integer,
  never_served bigint,
  orphaned_cards bigint,
  categories_covered integer
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
    sc.country_code,
    sc.country AS country_name,
    COUNT(*)::BIGINT AS total_cards,
    COUNT(*) FILTER (WHERE cp.is_active)::BIGINT AS active_cards,
    CASE WHEN COUNT(*) FILTER (WHERE cp.is_active) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE cp.is_active AND cp.image_url IS NOT NULL) * 100.0
        / COUNT(*) FILTER (WHERE cp.is_active))::INTEGER ELSE 0 END AS card_image_pct,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'single')::BIGINT AS single_cards,
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'curated')::BIGINT AS curated_cards,
    CASE WHEN COUNT(*) FILTER (WHERE cp.is_active) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE cp.is_active AND cp.served_count > 0) * 100.0
        / COUNT(*) FILTER (WHERE cp.is_active))::INTEGER ELSE 0 END AS served_pct,
    COUNT(*) FILTER (WHERE cp.is_active AND (cp.served_count IS NULL OR cp.served_count = 0))::BIGINT AS never_served,
    -- Orphan check against MV
    COUNT(*) FILTER (WHERE cp.is_active AND cp.card_type = 'single' AND (
      cp.place_pool_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM admin_place_pool_mv mv WHERE mv.id = cp.place_pool_id AND mv.is_active
      )
    ))::BIGINT AS orphaned_cards,
    COUNT(DISTINCT cp.category) FILTER (WHERE cp.is_active AND cp.category IS NOT NULL)::INTEGER AS categories_covered
  FROM card_pool cp
  JOIN seeding_cities sc ON cp.city_id = sc.id
  GROUP BY sc.country_code, sc.country
  ORDER BY COUNT(*) FILTER (WHERE cp.is_active) DESC;
END;
$function$;


-- ============================================================================
-- VERIFICATION (run manually AFTER `supabase db push`)
-- ============================================================================
-- Prerequisites:
--   SELECT indexname FROM pg_indexes
--     WHERE tablename = 'admin_place_pool_mv';            -- expect 5 indexes
--   SELECT COUNT(*) FROM admin_place_pool_mv;             -- expect ~63,239
--   SELECT * FROM cron.job WHERE jobname = 'refresh_admin_place_pool_mv';
--                                                          -- expect: */10 * * * * ACTIVE
--
-- Perf (target < 200ms per function, except admin_pool_stats_overview which is OK up to 1s
-- due to card_pool + impression joins; still a massive improvement from broken state):
--   \timing on
--   SELECT * FROM admin_place_pool_overview();
--   SELECT * FROM admin_place_category_breakdown();
--   SELECT * FROM admin_place_country_overview();
--   SELECT * FROM admin_place_city_overview('US');
--   SELECT * FROM admin_place_photo_stats('<city-uuid>');
--   SELECT * FROM admin_place_pool_city_list('United States');
--   SELECT * FROM admin_place_pool_country_list();
--   SELECT admin_ai_category_health();
--   SELECT admin_ai_city_overview('<city-uuid>');
--   SELECT admin_ai_city_stats();
--   SELECT admin_ai_validation_overview();
--   SELECT admin_photo_pool_summary();
--   SELECT admin_country_overview();
--   SELECT admin_country_city_overview('United States');
--   SELECT * FROM admin_pool_category_health();
--   SELECT admin_pool_stats_overview();
--   SELECT * FROM admin_card_pool_intelligence();
--   SELECT * FROM admin_card_category_health();
--   SELECT * FROM admin_card_city_overview('US');
--   SELECT * FROM admin_card_country_overview();
--   SELECT admin_refresh_place_pool_mv();                  -- on-demand refresh
--
-- Semantic parity:
--   For each rewritten RPC, the output structure (RETURNS TABLE columns and types) is
--   byte-identical to the pre-migration version. Row-level diffs from MV staleness
--   are acceptable (MV refresh window = 10 min).
--
-- Freshness:
--   Insert a test place: INSERT INTO place_pool (name, ...) VALUES ('TEST ORCH-0481', ...);
--   Wait 11 min, then: SELECT id, name FROM admin_place_pool_mv WHERE name = 'TEST ORCH-0481';
--   Should return the test row.
-- ============================================================================


-- ============================================================================
-- ROLLBACK (if rollback needed, copy the block below into a new migration)
-- ============================================================================
-- SELECT cron.unschedule('refresh_admin_place_pool_mv');
-- DROP MATERIALIZED VIEW IF EXISTS public.admin_place_pool_mv CASCADE;
-- DROP FUNCTION IF EXISTS public.admin_refresh_place_pool_mv();
-- -- The 20 rewritten admin_* RPCs will need to be restored from git history at
-- -- commit 82d94aef (pre-ORCH-0481 state).
-- ============================================================================
