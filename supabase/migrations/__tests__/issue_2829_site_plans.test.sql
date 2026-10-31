-- MINGLA-INVARIANT: I-PROPOSED-2829-13 | issue #2829 | A website plan part is ticked only from Mingla's own state (server done-checks), plan writes are revision-checked and lock-guarded, and only brand admins and owners change the plan (rank 20-49 may only point Ari at a part).
-- #2829 W9a (AD-11) — the website plan (pg17, BEGIN ... ROLLBACK).
-- Apply every migration through 20280119092829_issue_2829_site_plans.sql
-- first, then run with ON_ERROR_STOP=1. Every fixture rolls back. Neutral
-- fixtures only.
-- Proves: grants (table RPC-only, internals service-only); entitlement and
-- rank gates (scanner refused, finance reads but has no ask, marketing may
-- only set active_part); an empty profile starts with nothing ticked; a
-- brand with live trips starts with "What you'll offer" answered; revision
-- conflict; the lock (save takes it, someone else's live lock refuses,
-- heartbeat leaves it, take-over moves it, an expired lock is free);
-- approval needs the brand's name and one line, and a changed offering
-- un-approves; each of the 8 done-checks; build is recorded only by the
-- service and only covers what was built; a suspended site pauses the plan;
-- "Ask an admin" notifies brand admins and the owner once a day.

\set ON_ERROR_STOP on
BEGIN;

DO $w9$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_marketing uuid := gen_random_uuid();
  v_finance uuid := gen_random_uuid();
  v_events uuid := gen_random_uuid();
  v_scanner uuid := gen_random_uuid();
  v_other_owner uuid := gen_random_uuid();
  v_mingla_admin uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_full uuid := gen_random_uuid();
  v_plain uuid := gen_random_uuid();
  v_site uuid;
  v_pub uuid := gen_random_uuid();
  v_result jsonb;
  v_failed boolean;
  v_text text;
  v_rev integer;
  v_count integer;
  v_probe jsonb := jsonb_build_object(
    'http_ok', true, 'digest_ok', true, 'renderer_ok', true,
    'schema_ok', true, 'canonical_ok', true, 'assets_ok', true,
    'accessibility_ok', true, 'consent_ok', true, 'cta_ok', true,
    'leak_check_ok', true, 'observed_digest', repeat('a', 64),
    'status_code', 200
  );
BEGIN
  -- ── fixtures ────────────────────────────────────────────────────────────
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'w9-owner@2829.invalid'), (v_admin, 'w9-admin@2829.invalid'),
    (v_marketing, 'w9-marketing@2829.invalid'), (v_finance, 'w9-finance@2829.invalid'),
    (v_events, 'w9-events@2829.invalid'), (v_scanner, 'w9-scanner@2829.invalid'),
    (v_other_owner, 'w9-other@2829.invalid'), (v_mingla_admin, 'w9-mingla-admin@2829.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES
    (v_owner, now(), now()), (v_other_owner, now(), now());
  INSERT INTO public.admin_users(email, role, status, accepted_at)
  VALUES ('w9-mingla-admin@2829.invalid', 'admin', 'active', now());
  -- An empty profile: a name, no description, no logo, no offerings.
  INSERT INTO public.brands(id, account_id, name, slug) VALUES
    (v_brand, v_owner, 'W9 Empty Brand', 'w9-empty-brand'),
    (v_full, v_other_owner, 'W9 Full Brand', 'w9-full-brand'),
    (v_plain, v_other_owner, 'W9 Explicitly Revoked', 'w9-not-granted');
  UPDATE public.brands SET description = 'Trips for people who travel alone.'
  WHERE id = v_full;
  UPDATE public.brands SET default_currency = 'USD' WHERE id IN (v_brand, v_full, v_plain);
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES
    (v_brand, v_admin, 'brand_admin', now()),
    (v_brand, v_marketing, 'marketing_manager', now()),
    (v_brand, v_finance, 'finance_manager', now()),
    (v_brand, v_events, 'event_manager', now()),
    (v_brand, v_scanner, 'scanner', now());
  UPDATE public.profiles SET display_name = 'Ama' WHERE id = v_owner;
  IF NOT FOUND THEN
    INSERT INTO public.profiles(id, display_name) VALUES (v_owner, 'Ama')
    ON CONFLICT (id) DO UPDATE SET display_name = 'Ama';
  END IF;
  DELETE FROM public.brand_site_service_config;
  INSERT INTO public.brand_site_service_config(
    config_key, cms_origin, public_runtime_origin, public_host_suffix,
    configured_by, configured_at, updated_by, updated_at
  ) VALUES ('sites_v1', 'https://studio.sites.usemingla.com',
    'https://www.sites.usemingla.com', 'sites.usemingla.com',
    v_mingla_admin, now(), v_mingla_admin, now());
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_mingla_admin)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_mingla_admin::text, true);
  PERFORM public.brand_site_admin_grant(v_brand, 'rollout', NULL);
  PERFORM public.brand_site_admin_grant(v_full, 'rollout', NULL);
  PERFORM public.brand_site_admin_revoke(v_plain, 'support', 'W9 negative fixture');

  -- ── grants ──────────────────────────────────────────────────────────────
  IF has_table_privilege('authenticated', 'public.brand_site_plans', 'SELECT')
    OR has_table_privilege('anon', 'public.brand_site_plans', 'SELECT')
    OR has_table_privilege('authenticated', 'public.brand_site_plans', 'UPDATE') THEN
    RAISE EXCEPTION 'plans table readable or writable outside RPCs';
  END IF;
  IF has_function_privilege('authenticated', 'public.brand_site_plan_record_build(uuid,uuid,uuid,text[])', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.brand_site_record_look_saved(uuid,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.brand_site_plan_status_internal(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.brand_site_plan_get(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.brand_site_plan_save(uuid,integer,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a plan internal is reachable by anon or authenticated';
  END IF;

  -- ── explicitly revoked: honest answer, no writes ────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_other_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_other_owner::text, true);
  v_result := public.brand_site_plan_get(v_plain);
  IF (v_result->>'entitled')::boolean IS NOT FALSE OR v_result ? 'plan' THEN
    RAISE EXCEPTION 'an explicitly revoked brand saw a plan';
  END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_site_plan_save(v_plain, 0, '{"offerings_selected":[]}');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_not_entitled'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an explicitly revoked brand saved a plan'; END IF;

  -- ── full profile + live trips: opens at "Your look" ─────────────────────
  INSERT INTO public.events(id, brand_id, created_by, title, slug, visibility, status,
    published_at, timezone, event_type, currency)
  VALUES (gen_random_uuid(), v_full, v_other_owner, 'W9 Coast Week', 'w9-coast-week',
    'public', 'scheduled', now(), 'UTC', 'trip', 'USD');
  v_result := public.brand_site_plan_get(v_full);
  IF v_result->'status'->>'next_part' <> 'look'
    OR v_result->'prefill_offerings' <> '["trips"]'::jsonb
    OR (v_result->'status'->>'done_count')::int <> 3 THEN
    RAISE EXCEPTION 'a full brand with live trips did not open at look: %', v_result->'status';
  END IF;

  -- ── rank gates ──────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_scanner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_scanner::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_plan_get(v_brand);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a scanner read the plan'; END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_site_plan_get(v_full);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'another brand''s plan was readable'; END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_result := public.brand_site_plan_get(v_brand);
  IF (v_result->'status'->>'done_count')::int <> 0 OR v_result->'status'->>'next_part' <> 'offer'
    OR v_result->'plan' <> 'null'::jsonb OR v_result->'prefill_offerings' <> 'null'::jsonb
    OR (v_result->>'can_manage')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'an empty profile did not start with nothing ticked: %', v_result;
  END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_marketing)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_marketing::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_plan_save(v_brand, 0, '{"offerings_selected":["trips"]}');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a marketing manager changed the plan'; END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_site_plan_take_over(v_brand);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a marketing manager took the plan over'; END IF;
  -- "Do it with Ari" is open to rank 20 (and never takes the lock).
  v_result := public.brand_site_plan_save(v_brand, 0, '{"active_part":"offer"}');
  IF v_result->'plan'->>'active_part' <> 'offer' OR (v_result->'lock'->>'active')::boolean THEN
    RAISE EXCEPTION 'a marketing manager could not point Ari at a part, or took the lock';
  END IF;

  -- ── the owner works: revision + lock ────────────────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_plan_save(v_brand, 0, '{"offerings_selected":[]}');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_revision_conflict'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a stale revision saved'; END IF;
  -- Tick nothing: part 1 is done (an empty list means "nothing yet").
  v_result := public.brand_site_plan_save(v_brand, 1, '{"offerings_selected":[]}');
  IF NOT (v_result->'status'->'parts'->0->>'done')::boolean
    OR (v_result->'plan'->>'revision')::int <> 2
    OR NOT (v_result->'lock'->>'held_by_me')::boolean THEN
    RAISE EXCEPTION 'ticking nothing did not finish part 1, or the save did not take the lock: %', v_result;
  END IF;
  v_result := public.brand_site_plan_save(v_brand, 2,
    '{"offerings_selected":["trips","events"],"venue_descriptor":"Group trips"}');
  v_rev := (v_result->'plan'->>'revision')::int;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_admin)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_plan_save(v_brand, v_rev, '{"skipped_parts":["look"]}');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_plan_locked'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a second admin wrote over a live lock'; END IF;
  v_result := public.brand_site_plan_heartbeat(v_brand);
  IF (v_result->'lock'->>'held_by_me')::boolean OR v_result->'lock'->>'holder_name' <> 'Ama'
    OR (v_result->'plan'->>'started_by_me')::boolean OR NOT (v_result->'plan' ? 'started_by_name')
    -- the marketing manager who started the plan has no name on file: NULL.
    OR v_result->'plan'->>'started_by_name' IS NOT NULL THEN
    RAISE EXCEPTION 'heartbeat stole the lock or the banner lacks the holder: %', v_result->'lock';
  END IF;
  -- #2829 W11 (A24): a holder with no name on file reads as NULL (the app
  -- owns the wording), never a made-up label.
  UPDATE public.profiles SET display_name = NULL, first_name = NULL, last_name = NULL WHERE id = v_owner;
  v_result := public.brand_site_plan_heartbeat(v_brand);
  IF v_result->'lock'->>'holder_name' IS NOT NULL OR NOT (v_result->'lock'->>'active')::boolean THEN
    RAISE EXCEPTION 'a nameless lock holder was given a name: %', v_result->'lock';
  END IF;
  UPDATE public.profiles SET display_name = 'Ama' WHERE id = v_owner;
  v_result := public.brand_site_plan_take_over(v_brand);
  IF NOT (v_result->'lock'->>'held_by_me')::boolean THEN RAISE EXCEPTION 'take-over did not move the lock'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brand_site_audit_log WHERE brand_id = v_brand
    AND action = 'plan.taken_over' AND actor_user_id = v_admin) THEN
    RAISE EXCEPTION 'take-over not audited';
  END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_plan_save(v_brand, v_rev, '{"skipped_parts":[]}');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_plan_locked'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'the owner wrote after being taken over'; END IF;
  -- An expired lock is free again.
  UPDATE public.brand_site_plans SET lock_expires_at = now() - interval '1 second' WHERE brand_id = v_brand;
  v_result := public.brand_site_plan_heartbeat(v_brand);
  IF NOT (v_result->'lock'->>'held_by_me')::boolean THEN RAISE EXCEPTION 'an expired lock was not free'; END IF;

  -- ── approve needs the name and one line ─────────────────────────────────
  v_failed := false;
  BEGIN PERFORM public.brand_site_plan_save(v_brand, v_rev, jsonb_build_object('approve', true,
    'approved_plan', jsonb_build_object('pages', 'Home · Trips · Events · About · Contact')));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_plan_not_ready'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a plan was approved without one line about the brand'; END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_site_plan_save(v_brand, v_rev, jsonb_build_object('approve', true,
    'approved_plan', jsonb_build_object('pages', repeat('x', 301))));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_validation_failed'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an over-long plan line was accepted'; END IF;
  UPDATE public.brands SET description = 'Group trips for first-time solo travellers.' WHERE id = v_brand;
  -- #2829 W11 (design contract: "They skip every question"): the brand's name
  -- and one line are all approval needs; every story question may be skipped.
  -- (Probed in a sub-transaction that is rolled back, so the walk below goes on.)
  BEGIN
    v_result := public.brand_site_plan_save(v_brand, v_rev, jsonb_build_object('approve', true,
      'approved_plan', jsonb_build_object('pages', 'Home · About · Contact')));
    IF v_result->'plan'->>'approved_at' IS NULL THEN
      RAISE EXCEPTION 'a plan with every question skipped could not be approved: %', v_result->'plan';
    END IF;
    RAISE EXCEPTION 'w11_probe_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'w11_probe_rollback' THEN RAISE; END IF;
  END;
  v_result := public.brand_site_plan_save(v_brand, v_rev, jsonb_build_object('story',
    jsonb_build_object('who', 'First-time solo travellers', 'why', 'You leave with a group')));
  IF (v_result->'status'->'parts'->3->>'done')::boolean THEN
    RAISE EXCEPTION 'two story answers ticked the story';
  END IF;
  v_rev := (v_result->'plan'->>'revision')::int;
  v_result := public.brand_site_plan_save(v_brand, v_rev, jsonb_build_object('story',
    jsonb_build_object('who', 'First-time solo travellers', 'why', 'You leave with a group',
      'main_action', 'Reserve the next trip')));
  v_rev := (v_result->'plan'->>'revision')::int;
  v_result := public.brand_site_plan_save(v_brand, v_rev, jsonb_build_object('approve', true,
    'approved_plan', jsonb_build_object('for', 'First-time solo travellers',
      'pages', 'Home · Trips · Events · About · Contact', 'wont_do', 'Invent reviews, numbers or history')));
  IF NOT (v_result->'status'->'parts'->1->>'done')::boolean
    OR NOT (v_result->'status'->'parts'->3->>'done')::boolean
    OR NOT (v_result->'status'->'parts'->4->>'done')::boolean THEN
    RAISE EXCEPTION 'brand/story/approve not ticked: %', v_result->'status';
  END IF;
  v_rev := (v_result->'plan'->>'revision')::int;
  -- Changing what the brand offers un-approves the plan.
  v_result := public.brand_site_plan_save(v_brand, v_rev, '{"offerings_selected":["trips"]}');
  IF (v_result->'status'->'parts'->4->>'done')::boolean THEN
    RAISE EXCEPTION 'a changed offering kept the old approval';
  END IF;
  v_rev := (v_result->'plan'->>'revision')::int;
  -- #2830: choose the design on the setup plan before any site row exists.
  v_result := public.brand_site_plan_save_design(v_brand,v_rev,'voyage','owner',NULL);
  v_rev := (v_result->'plan'->>'revision')::int;
  v_result := public.brand_site_plan_save(v_brand, v_rev, jsonb_build_object('approve', true,
    'approved_plan', jsonb_build_object('pages', 'Home · Trips · About · Contact')));
  v_rev := (v_result->'plan'->>'revision')::int;

  -- #2830: every recommended context field is resolved before the first
  -- brand_sites row can be provisioned.
  UPDATE public.brands SET
    contact_email='hello@w9.example',contact_phone='+12125550100',
    address='10 Orchard Street',city='Brooklyn',country_code='US',
    social_links='{"website":"https://w9.example"}'::jsonb,
    profile_photo_url='https://cdn.w9.example/logo.png',
    cover_media_url='https://cdn.w9.example/cover.jpg',cover_media_type='image',
    theme_color='#EA7825',theme_font='inter',theme_animation='none'
  WHERE id=v_brand;

  -- ── build: needs a site; recorded only by the service ───────────────────
  v_failed := false;
  BEGIN PERFORM public.brand_site_plan_authorize_compose(v_brand);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_invalid_state'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'compose authorized without a site'; END IF;
  v_result := public.brand_site_provision(v_brand, gen_random_uuid(), repeat('1', 64));
  v_site := (v_result->>'site_id')::uuid;
  PERFORM public.brand_site_complete_provision(v_site,
    (SELECT operation_id FROM public.brand_site_operation_receipts
     WHERE site_id = v_site AND kind = 'provision'), gen_random_uuid()::text);
  v_result := public.brand_site_plan_authorize_compose(v_brand);
  IF (v_result->>'site_id')::uuid <> v_site OR v_result->'offerings_selected' <> '["trips"]'::jsonb
    OR v_result->'brand'->>'description' IS NULL THEN
    RAISE EXCEPTION 'compose inputs wrong: %', v_result;
  END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_marketing)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_marketing::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_plan_authorize_compose(v_brand);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a marketing manager created the website draft'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  -- Studio built only the fixed pages: the Trips page is missing, so not done.
  PERFORM public.brand_site_plan_record_build(v_brand, v_site, v_owner, ARRAY['home','about','contact']);
  v_result := public.brand_site_plan_get(v_brand);
  IF (v_result->'status'->'parts'->5->>'done')::boolean THEN
    RAISE EXCEPTION 'build ticked without the Trips page';
  END IF;
  PERFORM public.brand_site_plan_record_build(v_brand, v_site, v_owner,
    ARRAY['home','trips','about','contact']);
  v_result := public.brand_site_plan_get(v_brand);
  IF NOT (v_result->'status'->'parts'->5->>'done')::boolean THEN
    RAISE EXCEPTION 'build not ticked with every page';
  END IF;
  v_rev := (v_result->'plan'->>'revision')::int;

  -- ── look: pre-draft choice, then Studio's persisted mirror ───────────────
  IF NOT (v_result->'status'->'parts'->2->>'done')::boolean
    OR v_result->'plan'->>'design_key' <> 'voyage' THEN
    RAISE EXCEPTION 'pre-draft design did not tick the look step';
  END IF;
  PERFORM public.brand_site_record_look_saved(v_site, 'voyage');
  v_result := public.brand_site_plan_get(v_brand);
  IF NOT (v_result->'status'->'parts'->2->>'done')::boolean OR v_result->'site'->>'design_key' <> 'voyage' THEN
    RAISE EXCEPTION 'look not ticked after Studio reported a save';
  END IF;

  -- ── first offering: a public trip, or skipped ───────────────────────────
  IF (v_result->'status'->'parts'->6->>'done')::boolean THEN RAISE EXCEPTION 'first offering ticked with no trip'; END IF;
  v_result := public.brand_site_plan_save(v_brand, v_rev, '{"skipped_parts":["first_offering"]}');
  IF NOT (v_result->'status'->'parts'->6->>'done')::boolean OR NOT (v_result->'status'->'parts'->6->>'optional')::boolean THEN
    RAISE EXCEPTION 'skipping the optional part did not tick it';
  END IF;
  v_rev := (v_result->'plan'->>'revision')::int;
  v_result := public.brand_site_plan_save(v_brand, v_rev, '{"skipped_parts":[]}');
  v_rev := (v_result->'plan'->>'revision')::int;
  INSERT INTO public.events(id, brand_id, created_by, title, slug, visibility, status,
    published_at, timezone, event_type, currency)
  VALUES (gen_random_uuid(), v_brand, v_owner, 'W9 Private Trip', 'w9-private-trip',
    'private', 'scheduled', now(), 'UTC', 'trip', 'USD');
  v_result := public.brand_site_plan_get(v_brand);
  IF (v_result->'status'->'parts'->6->>'done')::boolean OR (v_result->'live_counts'->>'trips')::int <> 0 THEN
    RAISE EXCEPTION 'a private trip counted as the first offering';
  END IF;
  INSERT INTO public.events(id, brand_id, created_by, title, slug, visibility, status,
    published_at, timezone, event_type, currency)
  VALUES (gen_random_uuid(), v_brand, v_owner, 'W9 Public Trip', 'w9-public-trip',
    'public', 'scheduled', now(), 'UTC', 'trip', 'USD');
  v_result := public.brand_site_plan_get(v_brand);
  IF NOT (v_result->'status'->'parts'->6->>'done')::boolean OR (v_result->'live_counts'->>'trips')::int <> 1 THEN
    RAISE EXCEPTION 'a public trip did not tick the first offering';
  END IF;

  -- ── publish: the site's first successful publication ────────────────────
  IF (v_result->'status'->'parts'->7->>'done')::boolean THEN RAISE EXCEPTION 'publish ticked before publishing'; END IF;
  INSERT INTO public.brand_site_publications(id, site_id, operation_id,
    source_revision_id, source_digest, artifact_key, artifact_digest, status,
    requested_by, completed_at, probe_summary)
  VALUES (v_pub, v_site, gen_random_uuid(), 'w9-1', repeat('b', 64),
    'publications/' || v_site || '/' || v_pub || '/' || repeat('a', 64) || '.json',
    repeat('a', 64), 'published', v_owner, clock_timestamp(), v_probe);
  UPDATE public.brand_sites SET status = 'published', active_publication_id = v_pub,
    last_successful_publication_id = v_pub WHERE id = v_site;
  v_result := public.brand_site_plan_get(v_brand);
  IF NOT (v_result->'status'->'parts'->7->>'done')::boolean
    OR (v_result->'status'->>'done_count')::int <> 8 OR v_result->'status'->>'next_part' IS NOT NULL THEN
    RAISE EXCEPTION 'a published site did not finish the plan: %', v_result->'status';
  END IF;

  -- ── a suspended site pauses the plan ────────────────────────────────────
  UPDATE public.brand_sites SET status = 'suspended', suspended_at = now(), suspended_by = v_mingla_admin,
    suspension_reason_code = 'support' WHERE id = v_site;
  v_result := public.brand_site_plan_get(v_brand);
  IF NOT (v_result->'site'->>'paused')::boolean THEN RAISE EXCEPTION 'suspension not shown on the plan'; END IF;
  v_failed := false;
  BEGIN PERFORM public.brand_site_plan_save(v_brand, (v_result->'plan'->>'revision')::int, '{"active_part":"look"}');
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_plan_paused'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a suspended site''s plan was written'; END IF;
  -- #2829 W11 (design contract: "Admin suspends the brand ... resuming
  -- restores it"): once resumed, the plan is no longer paused and saves again.
  UPDATE public.brand_sites SET status = 'published', suspended_at = NULL, suspended_by = NULL,
    suspension_reason_code = NULL WHERE id = v_site;
  v_result := public.brand_site_plan_get(v_brand);
  IF (v_result->'site'->>'paused')::boolean THEN RAISE EXCEPTION 'a resumed site still pauses the plan'; END IF;
  v_result := public.brand_site_plan_save(v_brand, (v_result->'plan'->>'revision')::int, '{"active_part":"look"}');
  IF v_result->'plan'->>'active_part' <> 'look' THEN RAISE EXCEPTION 'a resumed site''s plan could not be saved'; END IF;

  -- ── "Ask an admin to start it" ──────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_finance)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_finance::text, true);
  v_failed := false;
  BEGIN PERFORM public.brand_site_request_start(v_brand);
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM = 'sites_forbidden'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a finance manager could ask to start the website'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_marketing)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_marketing::text, true);
  v_result := public.brand_site_request_start(v_brand);
  IF (v_result->>'notified')::int <> 2 OR (v_result->>'already_asked')::boolean THEN
    RAISE EXCEPTION 'owner and brand admin were not both notified: %', v_result;
  END IF;
  SELECT count(*) INTO v_count FROM public.notification_outbox
  WHERE brand_id = v_brand AND category_key = 'business.site_start_requested'
    AND user_id IN (v_owner, v_admin);
  IF v_count <> 2 THEN RAISE EXCEPTION 'start-request outbox rows: %', v_count; END IF;
  -- #2829 W11: Core's own sentence words a nameless member ("A teammate"),
  -- never an empty body.
  IF EXISTS (SELECT 1 FROM public.notification_outbox
    WHERE brand_id = v_brand AND category_key = 'business.site_start_requested'
      AND (payload->>'body' IS NULL OR payload->>'body' NOT LIKE 'A teammate asked you to start %')) THEN
    RAISE EXCEPTION 'a nameless member''s start request has no readable sentence';
  END IF;
  v_result := public.brand_site_request_start(v_brand);
  IF (v_result->>'notified')::int <> 0 OR NOT (v_result->>'already_asked')::boolean THEN
    RAISE EXCEPTION 'asking twice in a day notified again';
  END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_events)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_events::text, true);
  v_result := public.brand_site_request_start(v_brand);
  IF (v_result->>'notified')::int <> 2 THEN RAISE EXCEPTION 'an event manager could not ask'; END IF;

  RAISE NOTICE 'ISSUE_2829_W9A_SITE_PLANS_OK';
END;
$w9$;

ROLLBACK;
