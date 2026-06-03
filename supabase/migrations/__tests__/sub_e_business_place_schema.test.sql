-- META-ORCH-1009 Sub-E schema contract checks.
-- Run after applying 20260809000000_meta_orch_1009_sub_e_business_supply_feeder.sql.

DO $$
DECLARE
  v_nullable text;
  v_fetched_check text;
  v_claimed_fk_count int;
BEGIN
  SELECT is_nullable
  INTO v_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'place_pool'
    AND column_name = 'google_place_id';

  IF v_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'SUB-E FAIL: place_pool.google_place_id must be nullable';
  END IF;

  SELECT pg_get_constraintdef(c.oid)
  INTO v_fetched_check
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'place_pool'
    AND c.conname = 'place_pool_fetched_via_check';

  IF v_fetched_check NOT LIKE '%business_authored%' THEN
    RAISE EXCEPTION 'SUB-E FAIL: fetched_via check must allow business_authored';
  END IF;

  PERFORM 1
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'place_pool'
    AND column_name IN (
      'business_author_brand_id',
      'business_authoring_status',
      'business_hero_video_present',
      'photo_analysis',
      'business_authoring_inputs'
    )
  GROUP BY table_schema, table_name
  HAVING count(*) = 5;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUB-E FAIL: one or more business authoring columns missing';
  END IF;

  IF to_regclass('public.brand_place_pipeline_state') IS NULL THEN
    RAISE EXCEPTION 'SUB-E FAIL: brand_place_pipeline_state missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'brand_place_pipeline_state'
      AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'SUB-E FAIL: brand_place_pipeline_state RLS disabled';
  END IF;

  SELECT count(*)
  INTO v_claimed_fk_count
  FROM information_schema.referential_constraints rc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_schema = rc.constraint_schema
   AND kcu.constraint_name = rc.constraint_name
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_schema = rc.unique_constraint_schema
   AND ccu.constraint_name = rc.unique_constraint_name
  WHERE kcu.table_schema = 'public'
    AND kcu.table_name = 'place_pool'
    AND kcu.column_name = 'claimed_by'
    AND ccu.table_schema = 'auth'
    AND ccu.table_name = 'users';

  IF v_claimed_fk_count <> 1 THEN
    RAISE EXCEPTION 'SUB-E FAIL: place_pool.claimed_by must still reference auth.users';
  END IF;

  RAISE NOTICE 'SUB-E PASS: business place schema contract intact';
END $$;
