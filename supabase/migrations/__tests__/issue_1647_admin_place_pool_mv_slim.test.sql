-- Issue #1647 — contract for the slimmed admin_place_pool_mv.
--
-- NON-VACUITY: CI runs this file against a database with every migration applied
-- EXCEPT 20270222001647. In that state the matview still carries `photos` and is
-- WITH NO DATA, so section 1 raises and `REFRESH ... CONCURRENTLY` in section 4
-- errors outright. If this file ever passes without the migration, the test is
-- not testing anything and CI fails the run on that basis alone.
--
-- These are BEHAVIOURAL assertions, not source greps. Section 4 seeds real
-- place_pool rows, runs the real CONCURRENT refresh, and reads the values the
-- admin RPCs actually consume — so the test survives the definition being
-- reformatted and fails if the derivation changes meaning.

\set ON_ERROR_STOP on

-- ── 1. THE FAT COLUMNS ARE GONE ─────────────────────────────────────────────
DO $$
DECLARE v_fat text[];
BEGIN
  IF to_regclass('public.admin_place_pool_mv') IS NULL THEN
    RAISE EXCEPTION 'admin_place_pool_mv is missing';
  END IF;
  IF (SELECT relkind FROM pg_class WHERE oid='public.admin_place_pool_mv'::regclass) <> 'm' THEN
    RAISE EXCEPTION 'admin_place_pool_mv is no longer a materialised view';
  END IF;

  SELECT array_agg(attname ORDER BY attname) INTO v_fat
  FROM pg_attribute
  WHERE attrelid='public.admin_place_pool_mv'::regclass
    AND NOT attisdropped AND attnum > 0
    AND attname IN ('photos','stored_photo_urls','types','has_photo_refs');
  IF v_fat IS NOT NULL THEN
    RAISE EXCEPTION
      'unread heavy column(s) still materialised: % — REFRESH ... CONCURRENTLY compares every '
      'column of every row, which is what broke job 13 for 66 days', v_fat;
  END IF;
END $$;

-- ── 2. EVERY COLUMN THE 8 CONSUMER RPCs READ IS STILL THERE ─────────────────
-- Derived from re-reading pg_proc.prosrc for admin_place_pool_overview,
-- admin_place_photo_stats, admin_place_category_breakdown,
-- admin_pool_category_health, admin_place_pool_city_list,
-- admin_place_pool_country_list, admin_place_city_overview and
-- admin_place_country_overview against the live catalogue.
DO $$
DECLARE v_missing text[];
BEGIN
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
    WHERE attrelid='public.admin_place_pool_mv'::regclass
      AND NOT attisdropped AND attnum > 0 AND attname = c
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'consumer column(s) missing from admin_place_pool_mv: %', v_missing;
  END IF;
END $$;

-- ── 3. THE INDEXES AND THE GRANTS ───────────────────────────────────────────
DO $$
DECLARE v_acl text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class ix ON ix.oid=i.indexrelid
    WHERE i.indrelid='public.admin_place_pool_mv'::regclass AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'no UNIQUE index on admin_place_pool_mv — REFRESH ... CONCURRENTLY cannot run';
  END IF;

  -- city_id is filtered by admin_place_pool_overview and admin_place_photo_stats.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indrelid='public.admin_place_pool_mv'::regclass AND a.attname='city_id'
  ) THEN
    RAISE EXCEPTION 'admin_place_pool_mv lost its city_id index — two consumer RPCs filter on it';
  END IF;

  SELECT COALESCE(relacl::text,'') INTO v_acl FROM pg_class WHERE oid='public.admin_place_pool_mv'::regclass;
  IF v_acl LIKE '%anon=%' OR v_acl LIKE '%authenticated=%' THEN
    RAISE EXCEPTION
      'admin_place_pool_mv is granted to anon/authenticated (acl=%). RLS does not apply to '
      'materialised views and PostgREST exposes them, so that publishes the whole place pool', v_acl;
  END IF;
  IF v_acl NOT LIKE '%service_role=%' THEN
    RAISE EXCEPTION 'service_role cannot read admin_place_pool_mv (acl=%)', v_acl;
  END IF;
END $$;

-- ── 4. THE REFRESH ACTUALLY WORKS, AND THE DERIVED VALUES ARE RIGHT ─────────
-- This is the section that would have caught #1647. It does not inspect the
-- definition; it drives the real CONCURRENT refresh and reads the result.
DO $$
DECLARE
  v_a uuid := '16470000-0000-4000-8000-000000000001';
  v_b uuid := '16470000-0000-4000-8000-000000000002';
  v_has_photos boolean;
  v_photo_count integer;
  v_name text;
BEGIN
  DELETE FROM public.place_pool WHERE id IN (v_a, v_b);

  INSERT INTO public.place_pool
    (id, name, lat, lng, primary_type, types, stored_photo_urls, photos, is_active, is_servable)
  VALUES
    (v_a, 'Issue 1647 fixture WITH photos', 51.5, -0.12, 'restaurant', ARRAY['restaurant'],
     ARRAY['a.jpg','b.jpg','c.jpg'], '[{"name":"places/x/photos/y"}]'::jsonb, true, true),
    -- 61 production rows carry this sentinel inside stored_photo_urls. A naive
    -- array_length() counts it as a real photo; has_photos must not.
    (v_b, 'Issue 1647 fixture SENTINEL only', 51.5, -0.12, 'restaurant', ARRAY['restaurant'],
     ARRAY['__backfill_failed__'], '[]'::jsonb, true, true);

  REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_place_pool_mv;

  SELECT has_photos, photo_count INTO v_has_photos, v_photo_count
  FROM public.admin_place_pool_mv WHERE id = v_a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the concurrent refresh did not pick up a newly inserted place';
  END IF;
  IF v_has_photos IS NOT TRUE OR v_photo_count <> 3 THEN
    RAISE EXCEPTION 'expected has_photos=true photo_count=3, got has_photos=% photo_count=%',
      v_has_photos, v_photo_count;
  END IF;

  SELECT has_photos, photo_count INTO v_has_photos, v_photo_count
  FROM public.admin_place_pool_mv WHERE id = v_b;
  IF v_has_photos IS NOT FALSE THEN
    RAISE EXCEPTION
      'sentinel-poisoning guard lost: a place whose only stored_photo_url is the '
      '__backfill_failed__ sentinel reported has_photos=%', v_has_photos;
  END IF;
  IF v_photo_count <> 1 THEN
    RAISE EXCEPTION 'photo_count must stay array_length()-faithful (expected 1, got %)', v_photo_count;
  END IF;

  -- A SECOND refresh must propagate an UPDATE. This is the exact behaviour that
  -- was dead for 66 days: the job ran, failed, and the view kept serving stale
  -- rows with nothing saying so.
  UPDATE public.place_pool SET name = 'Issue 1647 fixture RENAMED' WHERE id = v_a;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_place_pool_mv;
  SELECT name INTO v_name FROM public.admin_place_pool_mv WHERE id = v_a;
  IF v_name <> 'Issue 1647 fixture RENAMED' THEN
    RAISE EXCEPTION 'the concurrent refresh served a STALE row: got %', v_name;
  END IF;

  -- The whole row must not carry the dropped keys under any name.
  IF EXISTS (
    SELECT 1 FROM public.admin_place_pool_mv mv
    WHERE mv.id = v_a
      AND (to_jsonb(mv) ? 'photos' OR to_jsonb(mv) ? 'stored_photo_urls'
           OR to_jsonb(mv) ? 'types' OR to_jsonb(mv) ? 'has_photo_refs')
  ) THEN
    RAISE EXCEPTION 'a materialised row still carries one of the dropped keys';
  END IF;

  DELETE FROM public.place_pool WHERE id IN (v_a, v_b);
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_place_pool_mv;
END $$;

SELECT 'issue #1647 admin_place_pool_mv contract: PASS' AS result;
