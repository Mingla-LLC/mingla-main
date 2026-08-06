-- Issue #1647 — the admin place-pool view has served 31-May data for 66 days.
-- Also closes the DATABASE half of #1644's Tier-A1 (~534 MB).
--
-- WHAT IS BROKEN
-- --------------
-- pg_cron job 13 (`refresh_admin_place_pool_mv`, every 10 minutes) has failed
-- 4,320 of 4,320 runs in the last 30 days — 100% — at exactly 120.01 s average,
-- which is the 2-minute `statement_timeout` hit dead on. Last success
-- 2026-05-31 23:01 UTC. Every admin decision taken on the place-pool screen
-- since then was taken against a two-month-old snapshot, with nothing on screen
-- saying so.
--
-- ROOT CAUSE, MEASURED ON PRODUCTION 2026-08-06
-- ---------------------------------------------
-- `REFRESH MATERIALIZED VIEW CONCURRENTLY` diffs old against new by full-joining
-- and comparing EVERY COLUMN OF EVERY ROW (`newdata.* *= mv.*`). Two costs
-- dominate, both measured with EXPLAIN (ANALYZE) against the live database:
--
--   1. the whole-row diff over 88,399 x 2 rows      23,984 ms   (fat)
--                                    same, slimmed     531 ms   (45x faster)
--   2. building the new dataset from place_pool      38,695 ms   (fat)
--                                    same, slimmed   1,552 ms   (25x faster)
--
-- (1) is the TOAST: `photos` averages 4,625 B of a 5,098 B row — 90.7% of the
-- view's bytes — and the diff has to detoast both sides of it.
-- (2) is subtler and is why trimming `photos` alone is NOT enough: the derived
-- column `has_photo_refs` is `pp.photos IS NOT NULL AND pp.photos <> '[]'::jsonb`,
-- and comparing a jsonb against '[]' forces a full detoast of place_pool.photos
-- on EVERY row, EVERY refresh — 1.18 GiB read from disk, 38.7 s, ten times an
-- hour, for a boolean that NOTHING reads. `has_photo_refs` appears in exactly one
-- place in the entire monorepo: the view definition itself.
--
-- NOTE FOR ANYONE TEMPTED BY "just raise the timeout": that was already tried.
-- `cron_refresh_admin_place_pool_mv()` carries `SET statement_timeout TO '15min'`
-- and it is INERT — PostgreSQL arms the statement-timeout timer when the
-- top-level statement begins and a function-local SET never re-arms it. That is
-- why every single failure lands on 120.00 s and not on 15 minutes. The only
-- real fix is to make the refresh finish.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Rebuilds the matview without the four columns no consumer reads:
--   photos, stored_photo_urls, types, has_photo_refs
-- All 10 functions that touch this matview were re-read against the LIVE
-- catalogue (pg_proc.prosrc), not the repo: the 8 consumer RPCs
-- (admin_place_pool_overview, admin_place_photo_stats,
-- admin_place_category_breakdown, admin_pool_category_health,
-- admin_place_pool_city_list, admin_place_pool_country_list,
-- admin_place_city_overview, admin_place_country_overview) plus the two refresh
-- wrappers. NONE reads any of the four. Zero views or matviews depend on it
-- (pg_get_viewdef sweep) and nothing in the monorepo selects from it directly —
-- consumers go through the RPCs.
--
-- `types` is still READ at refresh time by
-- pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types) — it is read
-- from place_pool, which is why the call is retained and the column is not.
--
-- SECURITY FIX RIDING ALONG (deliberate, not incidental)
-- ------------------------------------------------------
-- The matview shipped with `GRANT ALL ... TO anon, authenticated`. RLS does not
-- apply to materialised views, and PostgREST exposes them, so the entire
-- 88,399-row admin place pool was readable by anyone holding the anon key that
-- ships in every app build. Verified on production 2026-08-06:
--   GET /rest/v1/admin_place_pool_mv?select=id,name,google_place_id&limit=2
--   -> HTTP 200, real rows.
-- The rebuilt matview is service_role ONLY. This breaks nothing: all 8 consumer
-- RPCs are SECURITY DEFINER owned by `postgres`, which owns the matview, so they
-- never consult the caller's grants. Rollback, if ever needed, is one line:
--   GRANT SELECT ON public.admin_place_pool_mv TO anon, authenticated;
--
-- CONCURRENCY / BLAST RADIUS
-- --------------------------
-- CREATE MATERIALIZED VIEW takes only ACCESS SHARE on place_pool, so it does NOT
-- collide with the live collage re-encode's UPDATEs of place_pool.
-- photo_collage_url. The only exclusive lock is on the matview itself. The
-- 10-minute refresh cron holds an ExclusiveLock on it for its full doomed 120 s,
-- so this migration first cancels any in-flight refresh — a statement that was
-- going to fail anyway, carrying no data — and then takes the lock with a bounded
-- `lock_timeout` so it fails loudly instead of stalling behind it.
--
-- IDEMPOTENT: re-applying against an already-slimmed matview is a no-op that
-- still re-asserts the indexes, the grants and the contract.
-- FAIL LOUD: the final block RAISEs if the matview is missing, still fat, missing
-- the UNIQUE index that CONCURRENTLY requires, unpopulated, empty, or still
-- readable by anon/authenticated.

-- The doomed in-flight refresh, if any. Read-only, already destined to abort at
-- 120 s; cancelling it only stops it wasting the rest of its budget.
-- Matched narrowly on the two refresh entry points and on REFRESH itself, so a
-- plain SELECT against the view by another session is never cancelled.
SELECT pg_catalog.pg_cancel_backend(a.pid)
FROM pg_catalog.pg_stat_activity a
WHERE a.pid <> pg_catalog.pg_backend_pid()
  AND a.datname = current_database()
  AND a.state = 'active'
  AND (a.query ILIKE '%cron_refresh_admin_place_pool_mv%'
       OR a.query ILIKE '%admin_refresh_place_pool_mv%'
       OR a.query ILIKE '%REFRESH MATERIALIZED VIEW%admin_place_pool_mv%');

SET lock_timeout = '30s';

DO $migration$
DECLARE
  v_is_fat boolean;
  v_exists boolean;
BEGIN
  SELECT to_regclass('public.admin_place_pool_mv') IS NOT NULL INTO v_exists;

  IF v_exists THEN
    SELECT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = 'public.admin_place_pool_mv'::regclass
        AND NOT attisdropped AND attnum > 0
        AND attname IN ('photos', 'stored_photo_urls', 'types', 'has_photo_refs')
    ) INTO v_is_fat;
  ELSE
    v_is_fat := true;  -- missing counts as "needs building"
  END IF;

  IF v_is_fat THEN
    RAISE NOTICE 'issue #1647: rebuilding admin_place_pool_mv without photos/stored_photo_urls/types/has_photo_refs';
    DROP MATERIALIZED VIEW IF EXISTS public.admin_place_pool_mv;

    CREATE MATERIALIZED VIEW public.admin_place_pool_mv AS
      SELECT pp.id,
             pp.google_place_id,
             pp.name,
             pp.city_id,
             sc.country_code,
             sc.country AS country_name,
             sc.name    AS city_name,
             sc.status  AS city_status,
             pp.country AS pp_country,
             pp.city    AS pp_city,
             COALESCE(
               public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types),
               'uncategorized'::text
             ) AS primary_category,
             -- pp.types is DELIBERATELY not materialised: it is read from
             -- place_pool by the mapping call above, never from this view.
             pp.primary_type,
             pp.rating,
             pp.review_count,
             pp.price_level,
             pp.is_active,
             pp.is_servable,
             pp.bouncer_validated_at,
             pp.bouncer_reason,
             (pp.bouncer_validated_at IS NOT NULL) AS bouncer_validated,
             -- has_photos survives: stored_photo_urls averages 83 B and stays
             -- inline, so this costs nothing to compute and every consumer RPC
             -- reads it. The ARRAY['__backfill_failed__'] guard is preserved
             -- verbatim — it is the sentinel-poisoning defence.
             (pp.stored_photo_urls IS NOT NULL
              AND array_length(pp.stored_photo_urls, 1) > 0
              AND pp.stored_photo_urls <> ARRAY['__backfill_failed__'::text]) AS has_photos,
             COALESCE(array_length(pp.stored_photo_urls, 1), 0) AS photo_count,
             -- has_photo_refs is GONE. It was `pp.photos <> '[]'::jsonb`, which
             -- detoasted 1.18 GiB of place_pool.photos on every refresh — 38.7 s
             -- measured — for a boolean with zero consumers anywhere.
             pp.last_detail_refresh,
             pp.updated_at,
             pp.created_at,
             (pp.claimed_by IS NOT NULL) AS is_claimed
      FROM public.place_pool pp
      LEFT JOIN public.seeding_cities sc ON pp.city_id = sc.id
      WITH DATA;
  END IF;
END
$migration$;

-- Indexes. The UNIQUE one is not optional: REFRESH ... CONCURRENTLY refuses to
-- run without it, and losing it is how this job would silently go back to
-- non-concurrent refreshes that lock readers out.
-- admin_place_pool_mv_city_id_idx is RETAINED against the #1644 sweep's
-- suggestion to drop it: admin_place_pool_overview and admin_place_photo_stats
-- both filter on city_id and the RPC comments say so explicitly. Its 0 scans in
-- the stats window reflect a view nobody could usefully query for 66 days, not a
-- dead index, and 1.5 MB is not worth a plan regression on the screen we are
-- fixing.
CREATE UNIQUE INDEX IF NOT EXISTS admin_place_pool_mv_id_idx
  ON public.admin_place_pool_mv (id);
CREATE INDEX IF NOT EXISTS admin_place_pool_mv_city_id_idx
  ON public.admin_place_pool_mv (city_id);
CREATE INDEX IF NOT EXISTS admin_place_pool_mv_is_servable_idx
  ON public.admin_place_pool_mv (is_servable);
CREATE INDEX IF NOT EXISTS admin_place_pool_mv_primary_category_idx
  ON public.admin_place_pool_mv (primary_category);

-- Grants: service_role only. See the SECURITY FIX note above.
REVOKE ALL ON TABLE public.admin_place_pool_mv FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_place_pool_mv FROM anon;
REVOKE ALL ON TABLE public.admin_place_pool_mv FROM authenticated;
GRANT SELECT ON TABLE public.admin_place_pool_mv TO service_role;

ANALYZE public.admin_place_pool_mv;

COMMENT ON MATERIALIZED VIEW public.admin_place_pool_mv IS
  'Issue #1647 / #1644-A1. Admin place-pool snapshot, refreshed CONCURRENTLY every '
  '10 minutes by cron_refresh_admin_place_pool_mv(). photos, stored_photo_urls, types '
  'and has_photo_refs are DELIBERATELY absent: no consumer reads them, they were 90.7% '
  'of the view''s bytes, and has_photo_refs forced a 38.7 s detoast of place_pool.photos '
  'on every refresh. Between them they made REFRESH ... CONCURRENTLY exceed the 120 s '
  'statement timeout on every run for 66 days. DO NOT re-add a wide or TOASTed column '
  'here without re-measuring the refresh — CONCURRENTLY compares every column of every '
  'row. service_role only: RLS does not apply to matviews and PostgREST exposes them.';

-- ── FAIL-LOUD CONTRACT ──────────────────────────────────────────────────────
-- A migration that reports success while leaving the refresh broken is worse
-- than one that fails, because the failure would again be invisible.
DO $verify$
DECLARE
  v_fat text[];
  v_missing text[];
  v_rows bigint;
  v_pool bigint;
  v_populated boolean;
  v_acl text;
BEGIN
  IF to_regclass('public.admin_place_pool_mv') IS NULL THEN
    RAISE EXCEPTION 'issue #1647: admin_place_pool_mv does not exist after the migration';
  END IF;

  SELECT array_agg(attname ORDER BY attname) INTO v_fat
  FROM pg_attribute
  WHERE attrelid = 'public.admin_place_pool_mv'::regclass
    AND NOT attisdropped AND attnum > 0
    AND attname IN ('photos', 'stored_photo_urls', 'types', 'has_photo_refs');
  IF v_fat IS NOT NULL THEN
    RAISE EXCEPTION 'issue #1647: unread heavy column(s) still materialised: %', v_fat;
  END IF;

  SELECT array_agg(c ORDER BY c) INTO v_missing
  FROM unnest(ARRAY[
    'id','google_place_id','name','city_id','country_code','country_name','city_name',
    'city_status','pp_country','pp_city','primary_category','primary_type','rating',
    'review_count','price_level','is_active','is_servable','bouncer_validated_at',
    'bouncer_reason','bouncer_validated','has_photos','photo_count','last_detail_refresh',
    'updated_at','created_at','is_claimed'
  ]) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.admin_place_pool_mv'::regclass
      AND NOT attisdropped AND attnum > 0 AND attname = c
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'issue #1647: consumer column(s) missing from admin_place_pool_mv: %', v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = 'public.admin_place_pool_mv'::regclass
      AND i.indisunique
  ) THEN
    RAISE EXCEPTION
      'issue #1647: admin_place_pool_mv has no UNIQUE index — REFRESH ... CONCURRENTLY cannot run';
  END IF;

  SELECT relispopulated INTO v_populated
  FROM pg_class WHERE oid = 'public.admin_place_pool_mv'::regclass;
  IF NOT v_populated THEN
    RAISE EXCEPTION 'issue #1647: admin_place_pool_mv was left WITH NO DATA';
  END IF;

  EXECUTE 'SELECT count(*) FROM public.admin_place_pool_mv' INTO v_rows;
  EXECUTE 'SELECT count(*) FROM public.place_pool' INTO v_pool;
  IF v_rows = 0 AND v_pool > 0 THEN
    RAISE EXCEPTION
      'issue #1647: admin_place_pool_mv is EMPTY while place_pool holds % rows', v_pool;
  END IF;
  -- The view is 1:1 with place_pool (LEFT JOIN on seeding_cities' primary key),
  -- so the counts must agree. A tolerance of 100 absorbs rows inserted between
  -- the CREATE's snapshot and this one under READ COMMITTED; place_pool took 25
  -- inserts in the whole 53-day stats window, so 100 is generous, not slack.
  IF v_rows > v_pool OR (v_pool - v_rows) > 100 THEN
    RAISE EXCEPTION
      'issue #1647: admin_place_pool_mv has % rows against place_pool''s % — the rebuild '
      'did not reproduce the pool 1:1', v_rows, v_pool;
  END IF;

  SELECT COALESCE(relacl::text, '') INTO v_acl
  FROM pg_class WHERE oid = 'public.admin_place_pool_mv'::regclass;
  IF v_acl LIKE '%anon=%' OR v_acl LIKE '%authenticated=%' THEN
    RAISE EXCEPTION
      'issue #1647: admin_place_pool_mv is still granted to anon/authenticated (acl=%) — '
      'RLS does not apply to matviews, so that is a public read of the whole place pool',
      v_acl;
  END IF;
  IF v_acl NOT LIKE '%service_role=%' THEN
    RAISE EXCEPTION
      'issue #1647: service_role cannot read admin_place_pool_mv (acl=%) — the admin RPCs '
      'would break', v_acl;
  END IF;
END
$verify$;

RESET lock_timeout;
