-- ORCH-0700 Phase 2.D + ORCH-0707 Appendix A — Rebuild admin_place_pool_mv
--
-- Drops + recreates the matview WITHOUT seeding_category and WITHOUT
-- ai_categories (those columns drop in Migration 5). primary_category
-- derivation now uses pg_map_primary_type_to_mingla_category exclusively
-- (no more ai_categories[1] fallback).
--
-- BEFORE shape (per cycle-3 audit, verified live 2026-05-02):
--   ... pp.seeding_category, pp.ai_categories,
--   COALESCE(pp.ai_categories[1], 'uncategorized') AS primary_category, ...
--
-- AFTER shape:
--   ... pp.types, pp.primary_type,
--   COALESCE(public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types), 'uncategorized') AS primary_category, ...
--   (seeding_category + ai_categories columns DROPPED from SELECT)
--
-- NOTE: Cron job 13 (10-min auto-refresh) is NOT paused by this migration.
-- The migration role under `supabase db push` lacks UPDATE rights on cron.job
-- (only superuser/service_role can mutate the cron schema). The matview rebuild
-- on ~4K rows completes in seconds. If a cron tick collides with the swap, that
-- one refresh fails with "relation does not exist" and the next tick (10 min
-- later) succeeds against the rebuilt matview. Acceptable risk window.
-- If a clean swap is required, operator can manually pause via SQL editor:
--   UPDATE cron.job SET active = false WHERE jobid = 13;
-- ...run this migration, then:
--   UPDATE cron.job SET active = true WHERE jobid = 13;
--
-- IMPORTANT — OPERATOR PRE-STEP REQUIRED BEFORE APPLYING:
--   Capture backup of 10 dependent admin RPCs in case CASCADE drop touches any:
--     pg_dump --schema-only --schema=public --table='admin_place_*' \
--             --table='admin_pool_*' --table='admin_refresh_place_*' \
--             --table='cron_refresh_admin_place_*' \
--             > Mingla_Artifacts/backups/orch_0700_admin_rpc_backup_2026-05-03.sql
--   Verify file size > 0 + grep for all 10 expected function names before
--   running this migration.
--
-- Reference:
--   ORCH-0700 spec §3.A.A5
--   ORCH-0707 spec §12 Appendix A.1

BEGIN;

-- ── Step 1: (cron pause skipped — see header note; migration role lacks rights) ──

-- ── Step 2: DROP CASCADE the matview ──
-- The 10 admin RPCs that read this MV are PL/pgSQL functions reading via
-- SELECT inside their bodies — NOT view-dependencies. CASCADE should NOT
-- drop them. If it does (unexpected pg behavior), the operator restores
-- from the pre-step pg_dump backup.
DROP MATERIALIZED VIEW IF EXISTS public.admin_place_pool_mv CASCADE;

-- ── Step 3: Recreate matview WITHOUT seeding_category, WITHOUT ai_categories ──
CREATE MATERIALIZED VIEW public.admin_place_pool_mv AS
SELECT
  pp.id,
  pp.google_place_id,
  pp.name,
  pp.city_id,
  sc.country_code,
  sc.country AS country_name,
  sc.name AS city_name,
  sc.status AS city_status,
  pp.country AS pp_country,
  pp.city AS pp_city,
  -- ORCH-0700 + ORCH-0707: dropped pp.seeding_category, dropped pp.ai_categories.
  -- primary_category derivation now uses pg_map_primary_type_to_mingla_category
  -- exclusively (Constitution #2 — Google's raw type data is the single owner).
  COALESCE(
    public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types),
    'uncategorized'::text
  ) AS primary_category,
  pp.types,
  pp.primary_type,
  pp.rating,
  pp.review_count,
  pp.price_level,
  pp.is_active,
  pp.is_servable,
  pp.bouncer_validated_at,
  pp.bouncer_reason,
  (pp.bouncer_validated_at IS NOT NULL) AS bouncer_validated,
  pp.stored_photo_urls,
  ((pp.stored_photo_urls IS NOT NULL) AND (array_length(pp.stored_photo_urls, 1) > 0) AND (pp.stored_photo_urls <> ARRAY['__backfill_failed__'::text])) AS has_photos,
  COALESCE(array_length(pp.stored_photo_urls, 1), 0) AS photo_count,
  pp.photos,
  ((pp.photos IS NOT NULL) AND (pp.photos <> '[]'::jsonb)) AS has_photo_refs,
  pp.last_detail_refresh,
  pp.updated_at,
  pp.created_at,
  (pp.claimed_by IS NOT NULL) AS is_claimed
FROM (place_pool pp LEFT JOIN seeding_cities sc ON ((pp.city_id = sc.id)));

-- ── Step 4: Re-create indexes (4 indexes that existed on the old matview) ──
CREATE UNIQUE INDEX admin_place_pool_mv_id_idx ON public.admin_place_pool_mv (id);
CREATE INDEX admin_place_pool_mv_city_id_idx ON public.admin_place_pool_mv (city_id);
CREATE INDEX admin_place_pool_mv_primary_category_idx ON public.admin_place_pool_mv (primary_category);
CREATE INDEX admin_place_pool_mv_is_servable_idx ON public.admin_place_pool_mv (is_servable);

-- ── Step 5: Initial refresh ──
REFRESH MATERIALIZED VIEW public.admin_place_pool_mv;

-- ── Step 6: (cron resume skipped — see header note; cron job 13 was never paused) ──

-- ── Step 7: Verification — confirm matview exists + has expected shape ──
DO $$
DECLARE
  v_mv_count INT;
  v_primary_category_present INT;
  v_seeding_category_present INT;
  v_ai_categories_present INT;
  v_dependent_rpc_count INT;
BEGIN
  -- Matview exists
  SELECT COUNT(*) INTO v_mv_count FROM pg_matviews
  WHERE matviewname = 'admin_place_pool_mv' AND schemaname = 'public';
  IF v_mv_count <> 1 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.D verify FAIL: admin_place_pool_mv missing post-rebuild';
  END IF;

  -- primary_category column exists in new matview
  -- (NOTE: information_schema.columns does NOT include matview columns —
  --  must query pg_attribute joined to pg_class instead.)
  SELECT COUNT(*) INTO v_primary_category_present
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'admin_place_pool_mv'
    AND a.attname = 'primary_category'
    AND a.attnum > 0
    AND NOT a.attisdropped;
  IF v_primary_category_present <> 1 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.D verify FAIL: primary_category column missing in rebuilt MV';
  END IF;

  -- seeding_category column GONE from new matview
  SELECT COUNT(*) INTO v_seeding_category_present
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'admin_place_pool_mv'
    AND a.attname = 'seeding_category'
    AND a.attnum > 0
    AND NOT a.attisdropped;
  IF v_seeding_category_present <> 0 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.D verify FAIL: seeding_category column STILL present in rebuilt MV';
  END IF;

  -- ai_categories column GONE from new matview
  SELECT COUNT(*) INTO v_ai_categories_present
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'admin_place_pool_mv'
    AND a.attname = 'ai_categories'
    AND a.attnum > 0
    AND NOT a.attisdropped;
  IF v_ai_categories_present <> 0 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.D verify FAIL: ai_categories column STILL present in rebuilt MV';
  END IF;

  -- All 10 dependent admin RPCs survived CASCADE (sanity check — should all
  -- exist because they read MV via SELECT, not as view-dependency)
  SELECT COUNT(*) INTO v_dependent_rpc_count FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname IN (
      'admin_place_category_breakdown',
      'admin_place_city_overview',
      'admin_place_country_overview',
      'admin_place_photo_stats',
      'admin_place_pool_city_list',
      'admin_place_pool_country_list',
      'admin_place_pool_overview',
      'admin_pool_category_health',
      'admin_refresh_place_pool_mv',
      'cron_refresh_admin_place_pool_mv'
    );
  IF v_dependent_rpc_count <> 10 THEN
    RAISE EXCEPTION 'ORCH-0700 Phase 2.D verify FAIL: expected 10 dependent admin RPCs intact, got % — restore from backup', v_dependent_rpc_count;
  END IF;
END $$;

-- NOTE: GRANTs are not re-issued here. The rebuild preserves them via Postgres'
-- default ownership behavior (the migration runs as the same role that owned
-- the original MV, and SECURITY DEFINER on the dependent RPCs handles row-level
-- access. If GRANTs are explicitly missing post-deploy, operator runs:
--   GRANT SELECT ON public.admin_place_pool_mv TO authenticated, anon, service_role;
-- (capture pre-migration GRANTs via:
--   SELECT * FROM information_schema.table_privileges WHERE table_name='admin_place_pool_mv';
--  if the original MV had specific GRANTs not covered by defaults.)

COMMIT;
