\set ON_ERROR_STOP on
-- #4453 PR 3 (content foundation): the tester's adversarial PostgreSQL 17 proof of
-- 20280723004453 (a different angle from the implementor's happy-path suite).
-- MINGLA-INVARIANT: I-SITES-PLAN-BUILD-NEEDS-APPROVE | issue #4453 | with SITES_PROOF_PART on, Build
-- (authorize_provision / authorize_compose) still needs 'approve', and the optional 'proof' never blocks it.
--
-- A-1  flag on, plan NOT approved, proof skipped: authorize_provision refuses sites_plan_not_ready
--      (the positional "first five parts" check would read proof in approve's place).
-- A-2  flag on, plan approved, proof untouched: the plan check passes (proof is optional).
-- A-3  a non-member and another brand's owner can neither list nor stage nor add a past trip.
-- A-4  anon and authenticated cannot read or write brand_site_setup_content directly.
-- A-5  re-saving a staged review without the tick is refused and the row keeps its confirmer.
-- A-6  a review row cannot lose its confirmer by a direct UPDATE (CHECK 23514).
-- A-7  mark_materialized cannot stamp another brand's staged row (sites_not_found).
-- A-8  an update naming the wrong kind is sites_not_found; a stale delete is PT409.
-- A-9  a past trip ending tomorrow, or ending before it starts, is refused.
-- A-10 a marketing manager cannot save the proof answers through plan_save.
--
-- FAILS-ON-REVERT: A-1/A-2 fail while brand_site_plan_authorize_provision keeps its positional
-- `position <= 5` check (20280216002830) after 'proof' is inserted at index 4.

BEGIN;

CREATE TEMP TABLE t_fail(label text) ON COMMIT DROP;
CREATE OR REPLACE FUNCTION pg_temp.a(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF COALESCE(p_ok, false) THEN RAISE NOTICE 'PASS  %', p_label;
  ELSE INSERT INTO t_fail VALUES (p_label); RAISE NOTICE 'FAIL  %', p_label; END IF;
END
$a$;

DO $t$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_other_owner uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_marketing uuid := gen_random_uuid();
  v_mingla_admin uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_brand2 uuid := gen_random_uuid();
  v_plan jsonb;
  v_rev integer;
  v_row jsonb;
  v_row2 jsonb;
  v_failed text;
  v_state text;
  v_tz text := 'Europe/London';
  v_today date := (now() AT TIME ZONE 'Europe/London')::date;
  v_review jsonb := jsonb_build_object('reviewer', 'Ada', 'quote', 'Loved it.',
    'review_date', '2026-02', 'source', 'Email, Feb 2026');
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'a-owner@4453.invalid'), (v_other_owner, 'a-other@4453.invalid'),
    (v_outsider, 'a-outsider@4453.invalid'), (v_marketing, 'a-mm@4453.invalid'),
    (v_mingla_admin, 'a-mingla@4453.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now()), (v_other_owner, now(), now());
  INSERT INTO public.admin_users(email, role, status, accepted_at) VALUES ('a-mingla@4453.invalid', 'admin', 'active', now());
  INSERT INTO public.brands(id, account_id, name, slug, description, default_currency) VALUES
    (v_brand, v_owner, 'A Proof Brand', 'a-proof-brand', 'Walks for people new to the city.', 'USD'),
    (v_brand2, v_other_owner, 'A Other Brand', 'a-other-brand', 'Another brand.', 'USD');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES (v_brand, v_marketing, 'marketing_manager', now());
  DELETE FROM public.brand_site_service_config;
  INSERT INTO public.brand_site_service_config(config_key, cms_origin, public_runtime_origin, public_host_suffix,
    configured_by, configured_at, updated_by, updated_at)
  VALUES ('sites_v1', 'https://studio.sites.usemingla.com', 'https://www.sites.usemingla.com',
    'sites.usemingla.com', v_mingla_admin, now(), v_mingla_admin, now());
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_mingla_admin)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_mingla_admin::text, true);
  PERFORM public.brand_site_admin_grant(v_brand, 'rollout', NULL);
  PERFORM public.brand_site_admin_grant(v_brand2, 'rollout', NULL);
  UPDATE public.feature_flags SET is_enabled = true WHERE flag_key = 'SITES_PROOF_PART';

  -- The owner answers every required part except approve, and skips look and proof.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_plan := public.brand_site_plan_save(v_brand, 0, jsonb_build_object(
    'offerings_selected', jsonb_build_array('trips'),
    'story', jsonb_build_object('who', 'New arrivals', 'why', 'Cities are lonely', 'main_action', 'Book a walk'),
    'skipped_parts', jsonb_build_array('look', 'proof')));
  v_rev := (v_plan->'plan'->>'revision')::integer;

  -- A-1
  PERFORM pg_temp.a(NOT (SELECT bool_or(p->>'key' = 'approve' AND (p->>'done')::boolean)
      FROM jsonb_array_elements(v_plan->'status'->'parts') p),
    'A-1 precondition: approve is not done');
  v_failed := NULL;
  BEGIN
    PERFORM public.brand_site_plan_authorize_provision(v_brand);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
  PERFORM pg_temp.a(v_failed = 'sites_plan_not_ready',
    'A-1 flag on: an unapproved plan is not ready to build (got ' || COALESCE(v_failed, 'no refusal') || ')');

  -- A-2: approve, un-skip proof (left untouched)
  v_plan := public.brand_site_plan_save(v_brand, v_rev, jsonb_build_object('skipped_parts', jsonb_build_array('look')));
  v_rev := (v_plan->'plan'->>'revision')::integer;
  v_plan := public.brand_site_plan_save(v_brand, v_rev, jsonb_build_object('approve', true, 'approved_plan',
    jsonb_build_object('for', 'New arrivals', 'leads_with', 'Walks', 'main_action', 'Book a walk',
      'look', 'Calm', 'pages', 'Home, Trips', 'wont_do', 'Nightlife')));
  v_rev := (v_plan->'plan'->>'revision')::integer;
  PERFORM pg_temp.a((SELECT bool_or(p->>'key' = 'approve' AND (p->>'done')::boolean)
      AND bool_or(p->>'key' = 'proof' AND NOT (p->>'done')::boolean)
      FROM jsonb_array_elements(v_plan->'status'->'parts') p),
    'A-2 precondition: approve done, proof not done');
  v_failed := NULL;
  BEGIN
    PERFORM public.brand_site_plan_authorize_provision(v_brand);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
  PERFORM pg_temp.a(v_failed IS DISTINCT FROM 'sites_plan_not_ready',
    'A-2 flag on: an approved plan with proof untouched is not refused as not ready (got ' || COALESCE(v_failed, 'no refusal') || ')');

  -- A-3 outsiders
  FOREACH v_row IN ARRAY ARRAY[to_jsonb(v_outsider), to_jsonb(v_other_owner)] LOOP
    v_failed := NULL;
    BEGIN PERFORM public.brand_site_setup_content_list(v_brand, (v_row #>> '{}')::uuid);
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
    PERFORM pg_temp.a(v_failed = 'sites_forbidden', 'A-3a no list for a non-member ' || (v_row #>> '{}'));
    v_failed := NULL;
    BEGIN PERFORM public.brand_site_setup_content_save(v_brand, (v_row #>> '{}')::uuid, 'destination', NULL,
      jsonb_build_object('name', 'Rome'), NULL, NULL);
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
    PERFORM pg_temp.a(v_failed = 'sites_forbidden', 'A-3b no staging for a non-member');
    v_failed := NULL;
    BEGIN PERFORM public.brand_site_setup_add_past_trip(v_brand, (v_row #>> '{}')::uuid, 'X', v_today - 20, v_today - 19, v_tz, 'Rome', NULL);
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
    PERFORM pg_temp.a(v_failed = 'sites_forbidden', 'A-3c no past trip for a non-member');
  END LOOP;

  -- A-5 / A-6
  v_row := public.brand_site_setup_content_save(v_brand, v_owner, 'review', NULL, v_review, true, NULL);
  v_failed := NULL;
  BEGIN PERFORM public.brand_site_setup_content_save(v_brand, v_owner, 'review', (v_row->>'id')::uuid,
    v_review || jsonb_build_object('quote', 'Changed words.'), false, (v_row->>'updated_at')::timestamptz);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
  PERFORM pg_temp.a(v_failed = 'sites_review_not_confirmed'
    AND (SELECT payload->>'quote' FROM public.brand_site_setup_content WHERE id = (v_row->>'id')::uuid) = 'Loved it.',
    'A-5 an edit without the tick is refused and the words are unchanged');
  v_state := NULL;
  BEGIN UPDATE public.brand_site_setup_content SET confirmed_real_by = NULL WHERE id = (v_row->>'id')::uuid;
  EXCEPTION WHEN check_violation THEN v_state := '23514'; END;
  PERFORM pg_temp.a(v_state = '23514', 'A-6 a review cannot lose its confirmer');

  -- A-7
  v_failed := NULL;
  BEGIN PERFORM public.brand_site_setup_content_mark_materialized(v_brand2,
    jsonb_build_array(jsonb_build_object('id', v_row->>'id', 'entry_id', '7')));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
  PERFORM pg_temp.a(v_failed = 'sites_not_found'
    AND (SELECT materialized_at IS NULL FROM public.brand_site_setup_content WHERE id = (v_row->>'id')::uuid),
    'A-7 another brand cannot stamp this row');

  -- A-8
  v_failed := NULL;
  BEGIN PERFORM public.brand_site_setup_content_save(v_brand, v_owner, 'story', (v_row->>'id')::uuid,
    jsonb_build_object('title', 'T', 'story', 'S'), NULL, (v_row->>'updated_at')::timestamptz);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
  PERFORM pg_temp.a(v_failed = 'sites_not_found', 'A-8a the wrong kind is not found');
  v_state := NULL;
  BEGIN PERFORM public.brand_site_setup_content_save(v_brand, v_owner, 'review', (v_row->>'id')::uuid,
    NULL, NULL, (v_row->>'updated_at')::timestamptz - interval '1 second', true);
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.a(v_state = 'PT409' AND EXISTS (SELECT 1 FROM public.brand_site_setup_content WHERE id = (v_row->>'id')::uuid),
    'A-8b a stale delete is PT409 and the row stays');

  -- A-9
  FOREACH v_row2 IN ARRAY ARRAY[
    jsonb_build_object('s', v_today - 2, 'e', v_today + 1),
    jsonb_build_object('s', v_today - 5, 'e', v_today - 10)] LOOP
    v_failed := NULL;
    BEGIN PERFORM public.brand_site_setup_add_past_trip(v_brand, v_owner, 'Bad dates',
      (v_row2->>'s')::date, (v_row2->>'e')::date, v_tz, 'Rome', NULL);
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
    PERFORM pg_temp.a(v_failed IN ('historical_trip_not_ended', 'historical_trip_invalid', 'sites_validation_failed'),
      'A-9 refused ' || v_row2::text || ' (got ' || COALESCE(v_failed, 'no refusal') || ')');
  END LOOP;

  -- A-10
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_marketing)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_marketing::text, true);
  v_failed := NULL;
  BEGIN PERFORM public.brand_site_plan_save(v_brand, v_rev, jsonb_build_object('faq',
    jsonb_build_array(jsonb_build_object('question', 'Q?', 'answer', 'A.'))));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM; END;
  PERFORM pg_temp.a(v_failed = 'sites_forbidden', 'A-10 a marketing manager cannot save the proof answers (got ' || COALESCE(v_failed, 'none') || ')');
END
$t$;

-- A-4 direct table access
SET LOCAL ROLE authenticated;
DO $d$ BEGIN
  BEGIN PERFORM 1 FROM public.brand_site_setup_content LIMIT 1;
    INSERT INTO t_fail VALUES ('A-4a authenticated read the table');
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS  A-4a authenticated cannot read'; END;
END $d$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $d$ BEGIN
  BEGIN INSERT INTO public.brand_site_setup_content(brand_id, kind, payload, created_by)
    VALUES (gen_random_uuid(), 'destination', '{"name":"x"}', gen_random_uuid());
    INSERT INTO t_fail VALUES ('A-4b anon wrote the table');
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS  A-4b anon cannot write'; END;
END $d$;
RESET ROLE;

DO $f$ BEGIN
  IF EXISTS (SELECT 1 FROM t_fail) THEN
    RAISE EXCEPTION 'issue #4453 tester adversarial FAIL: %', (SELECT string_agg(label, ' | ') FROM t_fail);
  END IF;
END $f$;

ROLLBACK;
