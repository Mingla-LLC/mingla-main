-- Issue #1431 implementor regression: additive Stay ad schema, dark rollout,
-- deterministic lifecycle projection, currency-safe Admin rollup and ACLs.
BEGIN;

DO $test$
DECLARE
  v_definition text;
  v_result boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ad_campaigns'
      AND column_name = 'dest_venue_id'
  ) THEN RAISE EXCEPTION 'T-1 dest_venue_id missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ad_conversions'
      AND column_name = 'stay_group_id'
  ) THEN RAISE EXCEPTION 'T-1 stay_group_id missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stay_reservation_groups'
      AND column_name = 'attribution_click_id'
  ) THEN RAISE EXCEPTION 'T-1 attribution_click_id missing'; END IF;
  IF to_regclass('public.stay_ad_lifecycle_events') IS NULL THEN
    RAISE EXCEPTION 'T-1 lifecycle table missing';
  END IF;
  IF to_regclass('public.ad_public_stay_destinations_view') IS NULL THEN
    RAISE EXCEPTION 'T-1 Stay destination view missing';
  END IF;

  SELECT pg_get_functiondef(
    'public.issue_1431_project_stay_ad_event(uuid)'::regprocedure
  ) INTO v_definition;
  IF v_definition NOT LIKE '%stay:%:submitted%'
     OR v_definition NOT LIKE '%stay:%:approved%'
     OR v_definition NOT LIKE '%stay:%:confirmed%'
     OR v_definition NOT LIKE '%stay:%:cancel:%'
     OR v_definition NOT LIKE '%stay:%:refund:%'
     OR v_definition NOT LIKE '%GREATEST(0,%'
  THEN
    RAISE EXCEPTION 'T-2 deterministic lifecycle/refund source contract missing';
  END IF;

  IF has_function_privilege(
    'anon', 'public.admin_stay_ad_campaign_rollup(uuid)', 'EXECUTE'
  ) THEN RAISE EXCEPTION 'T-3 anon can execute Admin Stay rollup'; END IF;
  IF has_function_privilege(
    'anon', 'public.issue_1431_attach_stay_attribution(uuid,text)', 'EXECUTE'
  ) THEN RAISE EXCEPTION 'T-3 anon can attach Stay attribution'; END IF;
  IF has_function_privilege(
    'authenticated', 'public.issue_1431_attach_stay_attribution(uuid,text)', 'EXECUTE'
  ) THEN RAISE EXCEPTION 'T-3 direct authenticated attach is exposed'; END IF;

  SELECT public.issue_1431_attach_stay_attribution(
    gen_random_uuid(), 'missing-click-id'
  ) INTO v_result;
  IF v_result IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'T-4 missing attribution did not fail open';
  END IF;

  IF EXISTS (SELECT 1 FROM public.ad_public_stay_destinations_view) THEN
    RAISE EXCEPTION 'T-5 dark Stay flags exposed an ad destination';
  END IF;
END;
$test$;

SET LOCAL ROLE anon;
DO $test$
BEGIN
  BEGIN
    PERFORM count(*) FROM public.stay_ad_lifecycle_events;
    RAISE EXCEPTION 'T-6 anon read Stay ad lifecycle rows';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  BEGIN
    PERFORM public.admin_stay_ad_campaign_rollup(gen_random_uuid());
    RAISE EXCEPTION 'T-7 non-admin reached Admin Stay rollup';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$test$;
RESET ROLE;

ROLLBACK;
