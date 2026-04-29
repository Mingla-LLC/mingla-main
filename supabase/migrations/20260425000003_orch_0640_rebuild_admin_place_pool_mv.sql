-- ORCH-0640 ch03 — Rebuild admin_place_pool_mv without ai_approved (DEC-043)
-- MV originally built on ai_approved. We replace those projections with is_servable
-- and bouncer_validated_at. Preserves the existing has_photos computed column.
-- MUST run BEFORE place_pool.ai_approved column drop (ch13 / migration 20260425000004).
-- Cron job #13 refreshes this MV every 10 min via cron_refresh_admin_place_pool_mv().

BEGIN;

-- ORCH-0640 rework v2.1: MV rebuild scans 65k+ place_pool rows; Supabase's
-- default statement_timeout (8 min) killed the initial push. Disable the
-- timeout for this transaction only — the MV build and its REFRESH need
-- as long as they need.
SET LOCAL statement_timeout = 0;
-- Second retry: cron job #13 (cron_refresh_admin_place_pool_mv, every 10 min)
-- held the MV's ACCESS EXCLUSIVE lock when we tried to DROP. Disable lock
-- timeout so this transaction queues behind any in-flight refresh, then
-- pause the cron inside the transaction so a new refresh can't start
-- mid-rebuild. Cron is re-enabled before COMMIT.
SET LOCAL lock_timeout = 0;

-- Pause the refresh cron for the duration of this transaction.
DO $$
BEGIN
  UPDATE cron.job
     SET active = false
   WHERE jobname = 'cron_refresh_admin_place_pool_mv' OR jobid = 13;
EXCEPTION WHEN OTHERS THEN
  -- cron schema or job may not exist in test environments; safe to ignore.
  NULL;
END $$;

DROP MATERIALIZED VIEW IF EXISTS public.admin_place_pool_mv CASCADE;

CREATE MATERIALIZED VIEW public.admin_place_pool_mv AS
SELECT
  pp.id,
  pp.google_place_id,
  pp.name,
  pp.city_id,
  sc.country_code,
  sc.country                AS country_name,
  sc.name                   AS city_name,
  sc.status                 AS city_status,
  pp.country                AS pp_country,
  pp.city                   AS pp_city,
  pp.seeding_category,
  pp.ai_categories,
  COALESCE(pp.ai_categories[1], 'uncategorized') AS primary_category,
  pp.types,
  pp.primary_type,
  pp.rating,
  pp.review_count,
  pp.price_level,
  pp.is_active,
  -- ORCH-0640: replaces pp.ai_approved / pp.ai_validated_at / ai_validated
  pp.is_servable,
  pp.bouncer_validated_at,
  pp.bouncer_reason,
  (pp.bouncer_validated_at IS NOT NULL) AS bouncer_validated,
  pp.stored_photo_urls,
  (
    pp.stored_photo_urls IS NOT NULL
    AND array_length(pp.stored_photo_urls, 1) > 0
    AND pp.stored_photo_urls <> ARRAY['__backfill_failed__']::text[]
  ) AS has_photos,
  COALESCE(array_length(pp.stored_photo_urls, 1), 0) AS photo_count,
  pp.photos,
  (pp.photos IS NOT NULL AND pp.photos <> '[]'::jsonb) AS has_photo_refs,
  pp.last_detail_refresh,
  pp.updated_at,
  pp.created_at,
  (pp.claimed_by IS NOT NULL) AS is_claimed
FROM public.place_pool pp
LEFT JOIN public.seeding_cities sc ON pp.city_id = sc.id;

-- Unique index enables concurrent REFRESH
CREATE UNIQUE INDEX admin_place_pool_mv_id_uk
  ON public.admin_place_pool_mv (id);

-- Replacement indexes with is_servable predicate (replaces the ai_approved ones)
CREATE INDEX admin_place_pool_mv_city_active_servable
  ON public.admin_place_pool_mv (city_id, is_active, is_servable);

CREATE INDEX admin_place_pool_mv_country_active_servable
  ON public.admin_place_pool_mv (country_code, is_active, is_servable);

CREATE INDEX admin_place_pool_mv_primary_category_servable
  ON public.admin_place_pool_mv (primary_category)
  WHERE (is_active = true) AND (is_servable = true);

COMMENT ON MATERIALIZED VIEW public.admin_place_pool_mv IS
  'ORCH-0640: rebuilt without ai_approved / ai_validated_at. Projects is_servable +
   bouncer_validated_at + bouncer_reason. has_photos computed column matches the
   3-gate serving contract (I-THREE-GATE-SERVING). Refreshed every 10 min by cron job
   refresh_admin_place_pool_mv.';

-- Re-enable the MV refresh cron that was paused at the top of this transaction.
DO $$
BEGIN
  UPDATE cron.job
     SET active = true
   WHERE jobname = 'cron_refresh_admin_place_pool_mv' OR jobid = 13;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

COMMIT;
