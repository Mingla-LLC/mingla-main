-- ORCH-1017 — Intelligence Trial "Couldn't load coverage" / HTTP 546 compute-limit fix.
--
-- ROOT CAUSE: the `intelligence_coverage` action in the edge fn
-- `run-place-intelligence-trial` (handleIntelligenceCoverage, index.ts) ran 6
-- unaggregated SELECTs via Promise.all and aggregated per-city IN JAVASCRIPT.
-- It pulled the ENTIRE place_pool (~79k rows) for the seed-window, the servable
-- set (~13.6k) TWICE — one copy dragging generative_summary + editorial_summary
-- + the full reviews jsonb array per row — plus ~2.6k completed-run rows, into
-- the edge function's memory on every request. That intermittently exceeded the
-- Supabase Edge Function WORKER_LIMIT (CPU/wall-clock/memory), returning HTTP 546
-- ("Function failed due to not having enough compute resources"). Warm/cold +
-- GC timing decided whether a given request squeaked under the limit, so it
-- failed intermittently and worsened as place_pool grew.
--
-- FIX: push the entire aggregation into Postgres as ONE GROUP BY query exposed as
-- a SECURITY DEFINER RPC. The edge fn now calls this and returns the ~17 city
-- rows verbatim — payload + compute drop by ~3 orders of magnitude. Output shape
-- is byte-for-byte identical to the prior JS handler (verified field-by-field
-- against handleIntelligenceCoverage's row builder).
--
-- The two operator-chosen constants are inlined exactly as in the edge fn:
--   * stale-refresh threshold = 90 days   (ORCH_1014_STALE_THRESHOLD_MS)
--   * details-refresh cutover = 2026-03-19 (ORCH_1015_REFRESH_CUTOVER_DATE_MS)
--
-- Gemini pricing / external-API references unchanged (COMMS-0003 — none touched).
--
-- SECURITY: SECURITY DEFINER, EXECUTE granted to service_role ONLY. The edge fn
-- gates admin (admin_users.status='active') BEFORE calling this and invokes it
-- with the service-role client, so this RPC is never reachable by anon/auth users.

CREATE OR REPLACE FUNCTION public.pg_intelligence_coverage()
RETURNS TABLE (
  city_id               uuid,
  city_name             text,
  country               text,
  servable_count        integer,
  evaluated_count       integer,
  remaining_count       integer,
  coverage_pct          numeric,
  last_run_id           uuid,
  last_run_at           timestamptz,
  last_run_status       text,
  last_run_cost_usd     numeric,
  last_run_mode         text,
  first_seeded_at       timestamptz,
  last_seeded_at        timestamptz,
  refresh_oldest_at     timestamptz,
  refresh_newest_at     timestamptz,
  stale_refresh_count   integer,
  missing_fields_count  integer,
  regeocoded            boolean,
  refreshed_new_fields  boolean,
  needs_refresh_count   integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH
  -- (1) ALL place_pool rows per city → seed window (servable + non-servable).
  seed_window AS (
    SELECT pp.city_id,
           MIN(pp.created_at) AS first_seeded_at,
           MAX(pp.created_at) AS last_seeded_at
    FROM place_pool pp
    WHERE pp.city_id IS NOT NULL
    GROUP BY pp.city_id
  ),
  -- (2) Servable rows per city → count + refresh window + stale + missing-fields
  --     + needs-refresh-since-cutover. Scoped to is_servable=true (mirrors the
  --     edge fn's servableRes + servableDetailsRes, collapsed into one scan).
  servable AS (
    SELECT pp.city_id,
           COUNT(*)::int AS servable_count,
           MIN(pp.last_detail_refresh) FILTER (WHERE pp.last_detail_refresh IS NOT NULL) AS refresh_oldest_at,
           MAX(pp.last_detail_refresh) FILTER (WHERE pp.last_detail_refresh IS NOT NULL) AS refresh_newest_at,
           COUNT(*) FILTER (
             WHERE pp.last_detail_refresh IS NULL
                OR pp.last_detail_refresh < (now() - interval '90 days')
           )::int AS stale_refresh_count,
           COUNT(*) FILTER (
             WHERE pp.generative_summary IS NULL
                OR pp.editorial_summary IS NULL
                OR pp.reviews IS NULL
                OR jsonb_typeof(pp.reviews) <> 'array'
                OR jsonb_array_length(pp.reviews) = 0
           )::int AS missing_fields_count,
           COUNT(*) FILTER (
             WHERE pp.last_detail_refresh IS NULL
                OR pp.last_detail_refresh < timestamptz '2026-03-19 00:00:00+00'
           )::int AS needs_refresh_count
    FROM place_pool pp
    WHERE pp.is_servable = true
      AND pp.city_id IS NOT NULL
    GROUP BY pp.city_id
  ),
  -- (3) Distinct currently-servable evaluated places per city (ORCH-1013 Finding A:
  --     the is_servable join prevents drifted rows inflating coverage).
  evaluated AS (
    SELECT tr.city_id,
           COUNT(DISTINCT tr.place_pool_id)::int AS evaluated_count
    FROM place_intelligence_trial_runs tr
    JOIN place_pool pp ON pp.id = tr.place_pool_id
    WHERE tr.status = 'completed'
      AND pp.is_servable = true
      AND tr.city_id IS NOT NULL
    GROUP BY tr.city_id
  ),
  -- (4) Most-recent terminal parent run per city (completed_at desc, nulls last).
  latest_run AS (
    SELECT DISTINCT ON (r.city_id)
           r.city_id,
           r.id   AS last_run_id,
           COALESCE(r.completed_at, r.started_at) AS last_run_at,
           r.status AS last_run_status,
           r.cost_so_far_usd AS last_run_cost_usd,
           r.mode AS last_run_mode
    FROM place_intelligence_runs r
    WHERE r.status IN ('complete', 'failed', 'cancelled')
      AND r.city_id IS NOT NULL
    ORDER BY r.city_id, r.completed_at DESC NULLS LAST
  )
  SELECT
    c.id AS city_id,
    c.name AS city_name,
    c.country,
    s.servable_count,
    LEAST(COALESCE(e.evaluated_count, 0), s.servable_count) AS evaluated_count,
    GREATEST(0, s.servable_count - COALESCE(e.evaluated_count, 0)) AS remaining_count,
    CASE
      WHEN s.servable_count = 0 THEN 0
      ELSE LEAST(100, ROUND((COALESCE(e.evaluated_count, 0)::numeric / s.servable_count) * 100, 1))
    END AS coverage_pct,
    lr.last_run_id,
    lr.last_run_at,
    lr.last_run_status,
    lr.last_run_cost_usd,
    lr.last_run_mode,
    sw.first_seeded_at,
    sw.last_seeded_at,
    s.refresh_oldest_at,
    s.refresh_newest_at,
    s.stale_refresh_count,
    s.missing_fields_count,
    COALESCE(c.coverage_radius_km = 0, false) AS regeocoded,
    (s.servable_count > 0 AND s.needs_refresh_count = 0) AS refreshed_new_fields,
    s.needs_refresh_count
  FROM seeding_cities c
  JOIN servable s   ON s.city_id = c.id          -- INNER JOIN drops servable_count=0 cities
  LEFT JOIN seed_window sw ON sw.city_id = c.id
  LEFT JOIN evaluated e    ON e.city_id = c.id
  LEFT JOIN latest_run lr  ON lr.city_id = c.id
  WHERE s.servable_count > 0
  ORDER BY s.servable_count DESC;
$$;

REVOKE ALL ON FUNCTION public.pg_intelligence_coverage() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pg_intelligence_coverage() FROM anon;
REVOKE ALL ON FUNCTION public.pg_intelligence_coverage() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pg_intelligence_coverage() TO service_role;

COMMENT ON FUNCTION public.pg_intelligence_coverage() IS
  'ORCH-1017 — per-city Intelligence Trial coverage aggregated in Postgres (replaces the JS-side 6-query aggregation in run-place-intelligence-trial that hit Edge WORKER_LIMIT / HTTP 546). service_role only; edge fn admin-gates before calling.';
