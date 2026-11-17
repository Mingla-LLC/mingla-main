\set ON_ERROR_STOP on
-- #4453 PR 3 (content foundation): executable PostgreSQL 17 proof of the Website
-- setup part "What guests say and where you've been" (20280723004453).
-- MINGLA-INVARIANT: I-SITES-SETUP-CONTENT-SERVICE-ONLY | issue #4453 | brand_site_setup_content has no anon or authenticated grants, RLS is forced, and materialised rows are immutable.
-- MINGLA-INVARIANT: I-SITES-NO-INVENTED-PROOF | issue #4453 | a staged review needs the "real review" tick by a brand admin or owner; a past trip must have ended; owner answers are validated, never filled in.
--
-- T-1  grants: the table and every new function are service-role only (plan get/save keep theirs).
-- T-2  RLS enabled and forced on brand_site_setup_content.
-- T-3  SITES_PROOF_PART off: the plan status has the 8 parts, no 'proof' (nothing changes).
-- T-4  flag on: 9 parts, 'proof' at index 4, optional; not done; a skip makes it done.
-- T-5  SC-3.7 value_points: 5 items, markup, a 121-character title are refused (CHECK 23514 and save).
-- T-6  faq / process_steps (3..5) / quick_facts shapes: good values save; bad ones are refused.
-- T-7  an answer makes the proof part done; plan_get returns the answers and proof_enabled.
-- T-8  stale revision: PT409 'sites_revision_conflict'.
-- T-9  SC-3.6 a marketing manager (rank 20-49) cannot stage a review; can stage a destination.
-- T-10 no review without the tick (sites_review_not_confirmed); with it, the confirmer is recorded.
-- T-11 limits: the 25th staged review is refused (sites_setup_limit_reached).
-- T-12 PT409 on a stale update; materialise stamps once, a rerun is a no-op, a different entry is PT409;
--      a materialised row is immutable (update and delete refused).
-- T-13 SC-3.5 once the brand has a site, staging is refused (sites_use_website_content).
-- T-14 SC-3.3 a past trip ending today is refused; a past one becomes a real ended trip (setup:*).
-- T-15 content ranks: review_status and mark_reviewed are rank 20.
-- T-18 P2-1 flag off: plan save refuses value_points/faq/process_steps/quick_facts and a 'proof' skip.
-- T-17 P1-3 flag off: list, staging and past trips are refused (sites_feature_off).
-- T-16 P1-1 Build's plan check is by key: proof skipped/untouched never blocks (flag on or off); unapproved is refused.
--
-- FAILS-ON-REVERT: drop 20280723004453 -> T-1 (table and functions missing); the old
-- plan_status_internal -> T-4; the old plan_save -> T-5/T-6; no confirmed_real CHECK -> T-10.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4453 proof part FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- T-1 grants
SELECT pg_temp.p_assert(
  NOT has_table_privilege('authenticated', 'public.brand_site_setup_content', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.brand_site_setup_content', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.brand_site_setup_content', 'INSERT')
  AND has_table_privilege('service_role', 'public.brand_site_setup_content', 'INSERT'),
  'T-1a setup content table: service role only');
SELECT pg_temp.p_assert(bool_and(NOT has_function_privilege('authenticated', f, 'EXECUTE')
    AND NOT has_function_privilege('anon', f, 'EXECUTE') AND has_function_privilege('service_role', f, 'EXECUTE')),
  'T-1b every new function is service-role only')
FROM unnest(ARRAY[
  'public.brand_site_setup_content_save(uuid,uuid,text,uuid,jsonb,boolean,timestamptz,boolean)',
  'public.brand_site_setup_content_list(uuid,uuid)',
  'public.brand_site_setup_content_pending(uuid)',
  'public.brand_site_setup_content_mark_materialized(uuid,jsonb)',
  'public.brand_site_setup_add_past_trip(uuid,uuid,text,date,date,text,text,text)',
  'public.brand_site_proof_part_enabled()',
  'public.brand_site_plan_value_points_ok(jsonb)']) AS f;
SELECT pg_temp.p_assert(has_function_privilege('authenticated', 'public.brand_site_plan_save(uuid,integer,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.brand_site_plan_get(uuid)', 'EXECUTE'),
  'T-1c plan get/save keep their grants');

-- T-2 RLS
SELECT pg_temp.p_assert(c.relrowsecurity AND c.relforcerowsecurity, 'T-2 RLS enabled and forced')
FROM pg_class c WHERE c.oid = 'public.brand_site_setup_content'::regclass;

DO $t$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_marketing uuid := gen_random_uuid();
  v_mingla_admin uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_plan jsonb;
  v_rev integer;
  v_row jsonb;
  v_row2 jsonb;
  v_failed text;
  v_state text;
  v_count integer;
  v_tz text := 'Europe/London';
  v_today date := (now() AT TIME ZONE 'Europe/London')::date;
  v_review jsonb := jsonb_build_object('reviewer', 'Tolu A.', 'quote', 'Best week of my year.',
    'review_date', '2026-03', 'source', 'Google, March 2026');
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'p-owner@4453.invalid'), (v_marketing, 'p-marketing@4453.invalid'),
    (v_mingla_admin, 'p-mingla@4453.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now());
  INSERT INTO public.admin_users(email, role, status, accepted_at)
  VALUES ('p-mingla@4453.invalid', 'admin', 'active', now());
  INSERT INTO public.brands(id, account_id, name, slug, description, default_currency)
  VALUES (v_brand, v_owner, 'P Proof Brand', 'p-proof-brand', 'Trips for people who travel alone.', 'USD');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at)
  VALUES (v_brand, v_marketing, 'marketing_manager', now());
  DELETE FROM public.brand_site_service_config;
  INSERT INTO public.brand_site_service_config(config_key, cms_origin, public_runtime_origin, public_host_suffix,
    configured_by, configured_at, updated_by, updated_at)
  VALUES ('sites_v1', 'https://studio.sites.usemingla.com', 'https://www.sites.usemingla.com',
    'sites.usemingla.com', v_mingla_admin, now(), v_mingla_admin, now());
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_mingla_admin)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_mingla_admin::text, true);
  PERFORM public.brand_site_admin_grant(v_brand, 'rollout', NULL);

  -- T-3 flag off
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'SITES_PROOF_PART';
  PERFORM pg_temp.p_assert((SELECT count(*) FROM public.feature_flags WHERE flag_key = 'SITES_PROOF_PART') = 1,
    'T-3a the SITES_PROOF_PART flag exists');
  v_plan := public.brand_site_plan_status_internal(v_brand);
  PERFORM pg_temp.p_assert(jsonb_array_length(v_plan->'parts') = 8
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan->'parts') p WHERE p->>'key' = 'proof'),
    'T-3b flag off: 8 parts, no proof');

  -- T-4 flag on
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'SITES_PROOF_PART';
  v_plan := public.brand_site_plan_status_internal(v_brand);
  PERFORM pg_temp.p_assert(jsonb_array_length(v_plan->'parts') = 9
    AND v_plan->'parts'->4->>'key' = 'proof' AND (v_plan->'parts'->4->>'optional')::boolean
    AND NOT (v_plan->'parts'->4->>'done')::boolean
    AND v_plan->'parts'->1->>'key' = 'brand',
    'T-4a flag on: proof at index 4, optional, not done; brand stays at index 1');

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_plan := public.brand_site_plan_save(v_brand, 0, jsonb_build_object('skipped_parts', jsonb_build_array('proof')));
  v_rev := (v_plan->'plan'->>'revision')::integer;
  PERFORM pg_temp.p_assert((v_plan->'status'->'parts'->4->>'done')::boolean
    AND (v_plan->'status'->'parts'->4->>'skipped')::boolean, 'T-4b a skip makes proof done');
  v_plan := public.brand_site_plan_save(v_brand, v_rev, jsonb_build_object('skipped_parts', '[]'::jsonb));
  v_rev := (v_plan->'plan'->>'revision')::integer;

  -- T-5 value points (SC-3.7)
  FOREACH v_row IN ARRAY ARRAY[
    (SELECT jsonb_agg(jsonb_build_object('title', 'Point ' || g, 'sentence', 'Real words.')) FROM generate_series(1, 5) g),
    jsonb_build_array(jsonb_build_object('title', '<b>Bold</b>', 'sentence', 'x')),
    jsonb_build_array(jsonb_build_object('title', repeat('a', 121), 'sentence', 'x')),
    jsonb_build_array(jsonb_build_object('title', 'No sentence')),
    jsonb_build_array(jsonb_build_object('title', 'x', 'sentence', 'y', 'extra', 'z'))
  ] LOOP
    v_failed := NULL;
    BEGIN
      PERFORM public.brand_site_plan_save(v_brand, v_rev, jsonb_build_object('value_points', v_row));
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
    PERFORM pg_temp.p_assert(v_failed LIKE '%sites_validation_failed%', 'T-5a save refuses value_points ' || left(v_row::text, 40));
    v_state := NULL;
    BEGIN
      UPDATE public.brand_site_plans SET value_points = v_row WHERE brand_id = v_brand;
    EXCEPTION WHEN check_violation THEN v_state := '23514'; END;
    PERFORM pg_temp.p_assert(v_state = '23514', 'T-5b CHECK refuses value_points ' || left(v_row::text, 40));
  END LOOP;

  -- T-6 the other answers
  v_plan := public.brand_site_plan_save(v_brand, v_rev, jsonb_build_object(
    'value_points', jsonb_build_array(jsonb_build_object('title', 'Small groups', 'sentence', 'Never more than twelve.'),
                                      jsonb_build_object('title', 'Local guides', 'sentence', 'People who live there.')),
    'faq', jsonb_build_array(jsonb_build_object('question', 'Can I come alone?', 'answer', 'Most guests do.')),
    'process_steps', jsonb_build_array(
      jsonb_build_object('title', 'Arrive', 'text', 'Tea first.', 'time', '10:00'),
      jsonb_build_object('title', 'Make', 'text', 'Hands in clay.'),
      jsonb_build_object('title', 'Take home', 'text', 'Fired and posted.', 'time', '2 weeks')),
    'quick_facts', jsonb_build_object('facts', jsonb_build_array(jsonb_build_object('big', '90°C', 'small', 'Sauna heat')),
      'use_in_ticker', true, 'ticker', jsonb_build_array('Open late', 'By the sea'))));
  v_rev := (v_plan->'plan'->>'revision')::integer;
  PERFORM pg_temp.p_assert(jsonb_array_length(v_plan->'plan'->'value_points') = 2
    AND v_plan->'plan'->'faq'->0->>'question' = 'Can I come alone?'
    AND jsonb_array_length(v_plan->'plan'->'process_steps') = 3
    AND (v_plan->'plan'->'quick_facts'->>'use_in_ticker')::boolean,
    'T-6a good answers save verbatim and plan_get returns them');
  FOREACH v_row IN ARRAY ARRAY[
    jsonb_build_object('process_steps', jsonb_build_array(jsonb_build_object('title', 'One', 'text', 'Only two'),
      jsonb_build_object('title', 'Two', 'text', 'steps'))),
    jsonb_build_object('process_steps', jsonb_build_array(jsonb_build_object('title', 'a', 'text', 'b', 'time', repeat('9', 25)),
      jsonb_build_object('title', 'c', 'text', 'd'), jsonb_build_object('title', 'e', 'text', 'f'))),
    jsonb_build_object('quick_facts', jsonb_build_object('facts', jsonb_build_array(jsonb_build_object('big', repeat('x', 13), 'small', 'y')),
      'use_in_ticker', false, 'ticker', '[]'::jsonb)),
    jsonb_build_object('quick_facts', jsonb_build_object('facts', '[]'::jsonb, 'use_in_ticker', false)),
    jsonb_build_object('faq', jsonb_build_array(jsonb_build_object('question', 'Q only')))
  ] LOOP
    v_failed := NULL;
    BEGIN
      PERFORM public.brand_site_plan_save(v_brand, v_rev, v_row);
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
    PERFORM pg_temp.p_assert(v_failed LIKE '%sites_validation_failed%', 'T-6b refused ' || left(v_row::text, 50));
  END LOOP;

  -- T-7 an answer makes proof done; proof_enabled is read
  PERFORM pg_temp.p_assert((v_plan->'status'->'parts'->4->>'done')::boolean AND (v_plan->>'proof_enabled')::boolean,
    'T-7 an answer makes proof done; plan_get says proof_enabled');

  -- T-8 PT409
  v_state := NULL;
  BEGIN
    PERFORM public.brand_site_plan_save(v_brand, v_rev - 1, jsonb_build_object('faq', NULL::jsonb));
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_failed := SQLERRM; END;
  PERFORM pg_temp.p_assert(v_state = 'PT409' AND v_failed = 'sites_revision_conflict', 'T-8 stale revision is PT409');

  -- T-9 marketing manager
  v_failed := NULL;
  BEGIN
    PERFORM public.brand_site_setup_content_save(v_brand, v_marketing, 'review', NULL, v_review, true, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
  PERFORM pg_temp.p_assert(v_failed = 'sites_forbidden', 'T-9a a marketing manager cannot stage a review');
  v_row := public.brand_site_setup_content_save(v_brand, v_marketing, 'destination', NULL,
    jsonb_build_object('name', 'Lisbon', 'country', 'Portugal'), NULL, NULL);
  PERFORM pg_temp.p_assert(v_row->>'kind' = 'destination', 'T-9b a marketing manager stages a destination');

  -- T-10 the tick
  v_failed := NULL;
  BEGIN
    PERFORM public.brand_site_setup_content_save(v_brand, v_owner, 'review', NULL, v_review, false, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
  PERFORM pg_temp.p_assert(v_failed = 'sites_review_not_confirmed', 'T-10a no review without the real-review tick');
  v_row := public.brand_site_setup_content_save(v_brand, v_owner, 'review', NULL, v_review, true, NULL);
  PERFORM pg_temp.p_assert((v_row->>'confirmed_real')::boolean
    AND (SELECT confirmed_real_by FROM public.brand_site_setup_content WHERE id = (v_row->>'id')::uuid) = v_owner,
    'T-10b a ticked review records who confirmed it');
  v_state := NULL;
  BEGIN
    INSERT INTO public.brand_site_setup_content(brand_id, kind, payload, created_by)
    VALUES (v_brand, 'review', v_review, v_owner);
  EXCEPTION WHEN check_violation THEN v_state := '23514'; END;
  PERFORM pg_temp.p_assert(v_state = '23514', 'T-10c the table refuses an unconfirmed review row');
  v_failed := NULL;
  BEGIN
    PERFORM public.brand_site_setup_content_save(v_brand, v_owner, 'review', NULL,
      v_review || jsonb_build_object('quote', '<script>x</script>'), true, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
  PERFORM pg_temp.p_assert(v_failed = 'sites_validation_failed', 'T-10d markup in a quote is refused');

  -- T-11 limits
  FOR v_count IN 2..24 LOOP
    PERFORM public.brand_site_setup_content_save(v_brand, v_owner, 'review', NULL, v_review, true, NULL);
  END LOOP;
  v_failed := NULL;
  BEGIN
    PERFORM public.brand_site_setup_content_save(v_brand, v_owner, 'review', NULL, v_review, true, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
  PERFORM pg_temp.p_assert(v_failed = 'sites_setup_limit_reached', 'T-11 the 25th review is refused');

  -- T-12 PT409 and materialisation
  v_state := NULL;
  BEGIN
    PERFORM public.brand_site_setup_content_save(v_brand, v_owner, 'review', (v_row->>'id')::uuid, v_review, true,
      (v_row->>'updated_at')::timestamptz - interval '1 second');
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.p_assert(v_state = 'PT409', 'T-12a a stale update is PT409');
  PERFORM pg_temp.p_assert(jsonb_array_length(public.brand_site_setup_content_pending(v_brand)) = 25,
    'T-12b pending lists every unmaterialised row');
  PERFORM pg_temp.p_assert(public.brand_site_setup_content_mark_materialized(v_brand,
    jsonb_build_array(jsonb_build_object('id', v_row->>'id', 'entry_id', '41'))) = 1, 'T-12c stamped once');
  PERFORM pg_temp.p_assert(public.brand_site_setup_content_mark_materialized(v_brand,
    jsonb_build_array(jsonb_build_object('id', v_row->>'id', 'entry_id', '41'))) = 0, 'T-12d a rerun is a no-op');
  v_state := NULL;
  BEGIN
    PERFORM public.brand_site_setup_content_mark_materialized(v_brand,
      jsonb_build_array(jsonb_build_object('id', v_row->>'id', 'entry_id', '42')));
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.p_assert(v_state = 'PT409', 'T-12e a different entry is PT409');
  v_state := NULL;
  BEGIN
    UPDATE public.brand_site_setup_content SET payload = v_review WHERE id = (v_row->>'id')::uuid;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.p_assert(v_state = 'PT409', 'T-12f a materialised row is immutable (update)');
  v_state := NULL;
  BEGIN
    DELETE FROM public.brand_site_setup_content WHERE id = (v_row->>'id')::uuid;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.p_assert(v_state = 'PT409', 'T-12g a materialised row is immutable (delete)');
  v_row2 := public.brand_site_setup_content_list(v_brand, v_marketing);
  PERFORM pg_temp.p_assert(jsonb_array_length(v_row2->'items') = 25 AND NOT (v_row2->>'can_confirm_reviews')::boolean
    AND NOT (v_row2->>'has_site')::boolean, 'T-12h list for rank 20, without confirm rights');

  -- T-14 past trips (before a site exists; works after too)
  v_failed := NULL;
  BEGIN
    PERFORM public.brand_site_setup_add_past_trip(v_brand, v_owner, 'Not over yet', v_today - 3, v_today, v_tz, 'Lisbon', NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
  PERFORM pg_temp.p_assert(v_failed = 'historical_trip_not_ended', 'T-14a a trip ending today is refused');
  v_failed := NULL;
  BEGIN
    PERFORM public.brand_site_setup_add_past_trip(v_brand, v_marketing, 'Old trip', v_today - 30, v_today - 25, v_tz, 'Lisbon', NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
  PERFORM pg_temp.p_assert(v_failed = 'sites_forbidden', 'T-14b a marketing manager cannot add a past trip');
  v_row2 := public.brand_site_setup_add_past_trip(v_brand, v_owner, 'Porto in spring', v_today - 30, v_today - 25, v_tz, 'Porto', 'Six of us.');
  PERFORM pg_temp.p_assert(v_row2 ? 'event_id' AND EXISTS (
      SELECT 1 FROM public.brand_site_historical_trip_imports i
      WHERE i.brand_id = v_brand AND i.import_key LIKE 'setup:%' AND i.event_id = (v_row2->>'event_id')::uuid),
    'T-14c a past trip becomes a real ended Mingla trip (setup:*)');
  v_plan := public.brand_site_plan_get(v_brand);
  PERFORM pg_temp.p_assert((v_plan->'proof_counts'->>'past_trips')::integer = 1
    AND (v_plan->'proof_counts'->>'reviews')::integer = 24
    AND (v_plan->'proof_counts'->>'destinations')::integer = 1, 'T-14d proof_counts');

  -- T-16 Build's plan check reads the required parts by key (P1-1): proof
  -- skipped or untouched never blocks; an unapproved plan is always refused.
  v_plan := public.brand_site_plan_get(v_brand);
  v_rev := (v_plan->'plan'->>'revision')::integer;
  v_plan := public.brand_site_plan_save(v_brand, v_rev, jsonb_build_object(
    'offerings_selected', jsonb_build_array('trips'),
    'story', jsonb_build_object('who', 'People new to the city', 'why', 'We know it well', 'main_action', 'Reserve the next trip'),
    'skipped_parts', jsonb_build_array('look', 'proof')));
  v_rev := (v_plan->'plan'->>'revision')::integer;
  v_plan := public.brand_site_plan_save(v_brand, v_rev, jsonb_build_object('approve', true, 'approved_plan',
    jsonb_build_object('for', 'New arrivals', 'leads_with', 'Walks', 'main_action', 'Book a walk',
      'look', 'Calm', 'pages', 'Home, Trips', 'wont_do', 'Nightlife')));
  v_rev := (v_plan->'plan'->>'revision')::integer;
  FOREACH v_state IN ARRAY ARRAY['on', 'off'] LOOP
    UPDATE public.feature_flags SET is_enabled = (v_state = 'on') WHERE flag_key = 'SITES_PROOF_PART';
    v_failed := NULL;
    BEGIN PERFORM public.brand_site_plan_authorize_provision(v_brand);
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
    PERFORM pg_temp.p_assert(v_failed IS DISTINCT FROM 'sites_plan_not_ready',
      'T-16a flag ' || v_state || ': approved, proof skipped: the plan check passes (got ' || COALESCE(v_failed, 'none') || ')');
  END LOOP;
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'SITES_PROOF_PART';
  v_plan := public.brand_site_plan_save(v_brand, v_rev, jsonb_build_object('skipped_parts', jsonb_build_array('look')));
  v_rev := (v_plan->'plan'->>'revision')::integer;
  v_failed := NULL;
  BEGIN PERFORM public.brand_site_plan_authorize_provision(v_brand);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
  PERFORM pg_temp.p_assert(v_failed IS DISTINCT FROM 'sites_plan_not_ready',
    'T-16b flag on: approved, proof untouched: the plan check passes (got ' || COALESCE(v_failed, 'none') || ')');
  v_plan := public.brand_site_plan_save(v_brand, v_rev, jsonb_build_object('approve', false));
  v_rev := (v_plan->'plan'->>'revision')::integer;
  FOREACH v_state IN ARRAY ARRAY['on', 'off'] LOOP
    UPDATE public.feature_flags SET is_enabled = (v_state = 'on') WHERE flag_key = 'SITES_PROOF_PART';
    v_failed := NULL;
    BEGIN PERFORM public.brand_site_plan_authorize_provision(v_brand);
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
    PERFORM pg_temp.p_assert(v_failed = 'sites_plan_not_ready', 'T-16c flag ' || v_state || ': an unapproved plan is refused (got ' || COALESCE(v_failed, 'none') || ')');
    v_failed := NULL;
    BEGIN PERFORM public.brand_site_plan_authorize_compose(v_brand);
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
    PERFORM pg_temp.p_assert(v_failed = 'sites_plan_not_ready', 'T-16d flag ' || v_state || ': compose refuses an unapproved plan (got ' || COALESCE(v_failed, 'none') || ')');
  END LOOP;
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'SITES_PROOF_PART';
  PERFORM pg_temp.p_assert(NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('brand_site_plan_authorize_provision','brand_site_plan_authorize_compose')
      AND pronamespace = 'public'::regnamespace AND (prosrc LIKE '%position <=%' OR prosrc NOT LIKE '%brand_site_plan_build_required_parts()%')),
    'T-16e both Build checks read the required parts by key, never by position');

  -- T-13 a site exists → the workspace is the home
  INSERT INTO public.brand_sites(brand_id, status, created_by)
  VALUES (v_brand, 'provisioning', v_owner);
  v_failed := NULL;
  BEGIN
    PERFORM public.brand_site_setup_content_save(v_brand, v_owner, 'story', NULL,
      jsonb_build_object('title', 'Our first trip', 'story', 'It rained.'), NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
  PERFORM pg_temp.p_assert(v_failed = 'sites_use_website_content', 'T-13 staging after a site exists is refused');

  -- T-17 P1-3 with the flag off every setup-part function refuses (server-side).
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key = 'SITES_PROOF_PART';
  -- T-18 the plan save refuses the proof answers and the proof skip while the flag is off.
  v_plan := public.brand_site_plan_get(v_brand);
  v_rev := (v_plan->'plan'->>'revision')::integer;
  FOREACH v_row IN ARRAY ARRAY[
    jsonb_build_object('faq', jsonb_build_array(jsonb_build_object('question', 'Q?', 'answer', 'A.'))),
    jsonb_build_object('value_points', NULL::jsonb),
    jsonb_build_object('process_steps', NULL::jsonb),
    jsonb_build_object('quick_facts', NULL::jsonb),
    jsonb_build_object('skipped_parts', jsonb_build_array('look', 'proof'))
  ] LOOP
    v_failed := NULL;
    BEGIN PERFORM public.brand_site_plan_save(v_brand, v_rev, v_row);
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
    PERFORM pg_temp.p_assert(v_failed = 'sites_feature_off', 'T-18a flag off: plan save refuses ' || v_row::text);
  END LOOP;
  v_plan := public.brand_site_plan_save(v_brand, v_rev, jsonb_build_object('skipped_parts', jsonb_build_array('look')));
  PERFORM pg_temp.p_assert((v_plan->'plan'->>'revision')::integer = v_rev + 1, 'T-18b flag off: an ordinary plan save still works');
  v_failed := NULL;
  BEGIN PERFORM public.brand_site_setup_content_list(v_brand, v_owner);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
  PERFORM pg_temp.p_assert(v_failed = 'sites_feature_off', 'T-17a flag off: list refused');
  v_failed := NULL;
  BEGIN PERFORM public.brand_site_setup_content_save(v_brand, v_owner, 'destination', NULL, jsonb_build_object('name', 'Rome'), NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
  PERFORM pg_temp.p_assert(v_failed = 'sites_feature_off', 'T-17b flag off: staging refused');
  v_failed := NULL;
  BEGIN PERFORM public.brand_site_setup_add_past_trip(v_brand, v_owner, 'Old trip', v_today - 30, v_today - 25, v_tz, 'Lisbon', NULL);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
  PERFORM pg_temp.p_assert(v_failed = 'sites_feature_off', 'T-17c flag off: past trip refused');
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'SITES_PROOF_PART';

  -- T-15 content ranks
  PERFORM pg_temp.p_assert(public.brand_site_content_min_rank('review_status') = 20
    AND public.brand_site_content_min_rank('mark_reviewed') = 20
    AND public.brand_site_content_min_rank('confirm_review') = 50, 'T-15 review actions are rank 20');
END
$t$;

ROLLBACK;
