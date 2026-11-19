\set ON_ERROR_STOP on

-- Issue #4226 Phase 2 — TESTER ADVERSARIAL suite (independent of the
-- implementor's J-01..J-10). Run after the full migration chain on PG17.
--
--   T-01  Every existing client writer of profiles, creator_accounts and
--         appsflyer_devices still works as a signed-in user after the guard
--         trigger, including on rows that already hold tracking values: the
--         Explorer onboarding_step save, profile edits, the Host
--         ensureCreatorAccount upsert (ON CONFLICT DO NOTHING), creator account
--         edits, the apps' appsflyer_devices upsert (ON CONFLICT DO UPDATE) and
--         the opt-out update; and the upsert never wipes stored attribution.
--   T-02  Every tracking column is refused to a signed-in client on INSERT and
--         UPDATE, on all three tables; service-side writers are not refused.
--   T-03  anon cannot execute any new function; a signed-in non-admin is
--         refused by every admin read (not_authorized); the helpers are not
--         executable by signed-in users at all.
--   T-04  Tracking RPC input is rejected when it is junk (allow-list is exact,
--         case-sensitive, no padding; detail must be a small object; kind,
--         step, app, id, payload validated); an RPC never touches a row that
--         is not the caller's (other user, other app, other AppsFlyer id).
--   T-05  p_detail never reaches an admin read beyond the 120-char label; the
--         raw detail and the AppsFlyer payload are not in the journey row.
--   T-06  Source precedence (spec D3 + D10): a person who bought a web ticket
--         or was a host contact before signing up keeps that history as their
--         source even when the app later records "organic" / AppsFlyer
--         organic (organic is not a known channel).
--   T-07  Every facet option's count equals the filter count for that option,
--         including brand and bank on the trackless (Email builder) filter.
--   T-08  Filters are case- and space-insensitive for country and city.
-- MINGLA-INVARIANT: I-4226-JOURNEY-GUARD-KEEPS-CLIENT-WRITES | issue #4226 | the journey guard trigger refuses only the tracking columns; every existing signed-in writer of profiles, creator_accounts and appsflyer_devices keeps working and never clears stored attribution.

CREATE TEMP TABLE t4226x_result(label text, ok boolean, detail text);
GRANT ALL ON t4226x_result TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.t4226x_check(p_ok boolean, p_label text, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  INSERT INTO t4226x_result VALUES (p_label, COALESCE(p_ok, false), p_detail);
  IF COALESCE(p_ok, false) THEN RAISE NOTICE 'PASS  %', p_label;
  ELSE RAISE NOTICE 'FAIL  % %', p_label, COALESCE(p_detail, ''); END IF;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.t4226x_as(p_uid uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', CASE WHEN p_uid IS NULL THEN 'anon' ELSE 'authenticated' END)::text, true);
END
$f$;

BEGIN;
DO $t$
DECLARE
  v_admin  constant uuid := '42263000-0000-4000-a000-000000000001';
  v_u1     constant uuid := '42263000-0000-4000-a000-000000000011'; -- Explorer, tracking already recorded
  v_u2     constant uuid := '42263000-0000-4000-a000-000000000012'; -- Host, tracking already recorded
  v_u3     constant uuid := '42263000-0000-4000-a000-000000000013'; -- web ticket first, app later says organic
  v_u4     constant uuid := '42263000-0000-4000-a000-000000000014'; -- host contact first, AppsFlyer organic
  v_u5     constant uuid := '42263000-0000-4000-a000-000000000015'; -- closed Host account, still owns a banked brand (stays a host via the owner's team row)
  v_u6     constant uuid := '42263000-0000-4000-a000-000000000016'; -- brand new Host (ensureCreatorAccount insert)
  v_u7     constant uuid := '42263000-0000-4000-a000-000000000017'; -- signing up, no step recorded
  v_hb     constant uuid := '42263000-0000-4000-a000-000000000101'; -- host brand (contacts)
  v_b5     constant uuid := '42263000-0000-4000-a000-000000000105';
  v_ev     constant uuid := '42263000-0000-4000-a000-000000000201';
  v_raised boolean;
  v_msg    text;
  v_r      record;
  v_n      bigint;
  v_f      jsonb;
  v_facets jsonb;
  v_key    text;
  v_opt    jsonb;
  v_bad    text := '';
  v_fn     text;
BEGIN
  INSERT INTO auth.users(id, email, created_at)
  SELECT x.id, x.email, now() - interval '20 days' FROM (VALUES
    (v_admin, 't4226x-admin@mingla-fixture.org'), (v_u1, 't4226x-u1@mingla-fixture.org'),
    (v_u2, 't4226x-u2@mingla-fixture.org'), (v_u3, 't4226x-u3@mingla-fixture.org'),
    (v_u4, 't4226x-u4@mingla-fixture.org'), (v_u5, 't4226x-u5@mingla-fixture.org'),
    (v_u6, 't4226x-u6@mingla-fixture.org'), (v_u7, 't4226x-u7@mingla-fixture.org')) x(id, email);
  INSERT INTO public.admin_users(email, role, status) VALUES ('t4226x-admin@mingla-fixture.org', 'admin', 'active');
  INSERT INTO public.profiles(id, email, display_name, has_completed_onboarding, is_seed, country, created_at, onboarding_step) VALUES
    (v_admin, 't4226x-admin@mingla-fixture.org', 'X Admin', true, true, NULL, now(), NULL),
    (v_u1, 't4226x-u1@mingla-fixture.org', 'X One', false, false, NULL, now() - interval '20 days', 1),
    (v_u2, 't4226x-u2@mingla-fixture.org', 'X Two', true, false, NULL, now() - interval '20 days', NULL),
    (v_u3, 't4226x-u3@mingla-fixture.org', 'X Three', true, false, ' ng ', now() - interval '10 days', NULL),
    (v_u4, 't4226x-u4@mingla-fixture.org', 'X Four', true, false, NULL, now() - interval '10 days', NULL),
    (v_u5, 't4226x-u5@mingla-fixture.org', 'X Five', true, false, NULL, now() - interval '20 days', NULL),
    (v_u6, 't4226x-u6@mingla-fixture.org', 'X Six', false, false, NULL, now() - interval '1 day', NULL),
    -- Signed up, never onboarded, no step recorded anywhere (legacy unfinished sign-up).
    (v_u7, 't4226x-u7@mingla-fixture.org', 'X Seven', false, false, NULL, now() - interval '3 days', NULL);
  INSERT INTO public.creator_accounts(id, email, created_at) VALUES (v_u2, 't4226x-u2@mingla-fixture.org', now() - interval '19 days');
  INSERT INTO public.creator_accounts(id, email, created_at, deleted_at) VALUES (v_u5, 't4226x-u5@mingla-fixture.org', now() - interval '19 days', now() - interval '2 days');
  INSERT INTO public.preferences(profile_id, discover_city_name) VALUES (v_u3, '  lagos ')
    ON CONFLICT (profile_id) DO UPDATE SET discover_city_name = EXCLUDED.discover_city_name;
  INSERT INTO public.appsflyer_devices(user_id, appsflyer_uid, platform, app_id, app) VALUES
    (v_u1, 'af-x1', 'ios', 'id1', 'consumer'), (v_u2, 'af-x2', 'android', 'com.x', 'business'),
    (v_u3, 'af-x3', 'ios', 'id1', 'consumer'), (v_u4, 'af-x4', 'ios', 'id1', 'consumer');

  -- Brands: a host brand with u4 as a contact added before u4 signed up; a
  -- banked brand still owned by u5, whose Host account was closed.
  INSERT INTO public.creator_accounts(id, email, created_at) VALUES (v_admin, 't4226x-admin@mingla-fixture.org', now() - interval '30 days');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payout_country, city, created_at) VALUES
    (v_hb, v_admin, 'X Host Brand', 'x-host-brand-' || v_hb, 'NGN', 'NG', 'Lagos', now() - interval '30 days'),
    (v_b5, v_u5, 'X Closed Brand', 'x-closed-brand-' || v_b5, 'NGN', 'NG', 'Lagos', now() - interval '18 days');
  INSERT INTO public.brand_paystack_recipients(brand_id, recipient_code, bank_code, account_fingerprint, account_number_masked, account_name, is_active)
  VALUES (v_b5, 'RCP_x5', '058', 'hmac-sha256:' || repeat('d', 64), '••••9876', 'X Account', true);
  -- u4 was added by hand to the host's contacts 5 days before signing up.
  DECLARE v_person uuid; v_link uuid; v_cm uuid; BEGIN
    INSERT INTO public.brand_people(brand_id, display_name) VALUES (v_hb, 'X Four') RETURNING id INTO v_person;
    INSERT INTO public.brand_person_source_links(brand_id, brand_person_id, source_kind, source_id, link_method, source_occurred_at)
    VALUES (v_hb, v_person, 'manual', gen_random_uuid(), 'manual_resolution', now() - interval '15 days') RETURNING id INTO v_link;
    INSERT INTO public.brand_person_contact_methods(brand_id, brand_person_id, channel, normalized_value, provenance_scope, is_exportable, is_primary)
    VALUES (v_hb, v_person, 'email', 't4226x-u4@mingla-fixture.org', 'brand_owned', true, true) RETURNING id INTO v_cm;
    INSERT INTO public.brand_person_contact_method_sources(contact_method_id, source_link_id, provenance_kind, exportable)
    VALUES (v_cm, v_link, 'manual', true);
  END;

  -- u3 bought a web ticket 5 days before signing up.
  INSERT INTO public.events(id, brand_id, title, slug, status, currency, created_by, city, event_type, published_at, created_at)
  VALUES (v_ev, v_hb, 'X Event', 'x-event-' || v_ev, 'scheduled', 'NGN', v_admin, 'Lagos', 'event', now() - interval '25 days', now() - interval '26 days');
  INSERT INTO public.orders(event_id, buyer_email, buyer_name, total_cents, buyer_total_cents, net_subtotal_cents, currency,
      payment_status, payment_method, source, created_at, confirmed_at, list_subtotal_cents, discount_cents, buyer_fees_cents,
      tax_cents, pricing_source, metadata, buyer_user_id)
  VALUES (v_ev, 't4226x-u3@mingla-fixture.org', 'X Three', 1000, 1000, 1000, 'NGN', 'paid', 'online_card', 'legacy',
      now() - interval '15 days', now() - interval '15 days', 1000, 0, 0, 0, 'computed_at_checkout', '{}'::jsonb, NULL);

  ------------------------------------------------------------------------------
  -- Tracking values recorded first (through the RPCs, as each person).
  ------------------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4226x_as(v_u1);
  PERFORM public.record_journey_mark('explorer_onboarding', 2::smallint, 'value_prop');
  PERFORM public.record_signup_source('friend_invite', '{"label":"from a friend"}'::jsonb, 'explorer_app');
  PERFORM public.record_install_attribution('af-x1', 'consumer', '{"af_status":"Non-organic","media_source":"tiktok_int","campaign":"c1"}'::jsonb);
  PERFORM pg_temp.t4226x_as(v_u2);
  PERFORM public.record_journey_mark('host_brand_setup', 2::smallint, 'country');
  PERFORM public.record_install_attribution('af-x2', 'business', '{"af_status":"Non-organic","media_source":"Facebook Ads"}'::jsonb);
  PERFORM pg_temp.t4226x_as(v_u3);
  PERFORM public.record_signup_source('organic', '{"af_status":"Organic"}'::jsonb, 'explorer_app');
  PERFORM pg_temp.t4226x_as(v_u4);
  PERFORM public.record_install_attribution('af-x4', 'consumer', '{"af_status":"Organic"}'::jsonb);
  RESET ROLE;
  PERFORM pg_temp.t4226x_check(
    (SELECT onboarding_furthest_step = 2 AND signup_source = 'friend_invite' FROM public.person_journey WHERE user_id = v_u1)
    AND (SELECT media_source = 'tiktok_int' FROM public.appsflyer_devices WHERE appsflyer_uid = 'af-x1')
    AND (SELECT brand_setup_furthest_step = 2 FROM public.person_journey WHERE user_id = v_u2),
    'T-00 fixtures: tracking recorded through the RPCs');

  ------------------------------------------------------------------------------
  -- T-01 Existing client writers still work as the signed-in owner.
  ------------------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4226x_as(v_u1);
  -- app-mobile OnboardingFlow.tsx:1441 — the onboarding_step save path.
  BEGIN
    UPDATE public.profiles SET onboarding_step = 3 WHERE id = v_u1;
    PERFORM pg_temp.t4226x_check(true, 'T-01 Explorer onboarding_step save (OnboardingFlow) still works');
  EXCEPTION WHEN others THEN PERFORM pg_temp.t4226x_check(false, 'T-01 Explorer onboarding_step save (OnboardingFlow) still works', SQLERRM);
  END;
  -- OnboardingFlow / PreferencesService.updateUserProfile / authService.updateUserProfile: partial profile edits.
  BEGIN
    UPDATE public.profiles SET first_name = 'X', last_name = 'One', display_name = 'X One', updated_at = now(),
                               has_completed_onboarding = true, onboarding_step = 7, coach_mark_step = 1, timezone = 'Africa/Lagos'
     WHERE id = v_u1;
    PERFORM pg_temp.t4226x_check(true, 'T-01 Explorer profile edits (names, onboarding complete, coach mark, timezone) still work');
  EXCEPTION WHEN others THEN PERFORM pg_temp.t4226x_check(false, 'T-01 Explorer profile edits still work', SQLERRM);
  END;
  -- A whole-row write-back of the row as read (unchanged tracking values) is not refused.
  BEGIN
    UPDATE public.appsflyer_devices d SET af_status = d.af_status, media_source = d.media_source, campaign = d.campaign,
           install_time = d.install_time, conversion_payload = d.conversion_payload,
           attribution_received_at = d.attribution_received_at
     WHERE d.user_id = v_u1 AND d.appsflyer_uid = 'af-x1';
    PERFORM pg_temp.t4226x_check(true, 'T-01 writing back unchanged tracking values is allowed');
  EXCEPTION WHEN others THEN PERFORM pg_temp.t4226x_check(false, 'T-01 writing back unchanged tracking values is allowed', SQLERRM);
  END;
  -- appsflyer_devices: the apps' registerAppsFlyerDevice upsert (supabase-js ON CONFLICT DO UPDATE).
  BEGIN
    INSERT INTO public.appsflyer_devices(user_id, appsflyer_uid, platform, app_id, app, updated_at, tracking_opt_out)
    VALUES (v_u1, 'af-x1', 'ios', 'id1', 'consumer', now(), false)
    ON CONFLICT (user_id, app, appsflyer_uid) DO UPDATE SET user_id = EXCLUDED.user_id, appsflyer_uid = EXCLUDED.appsflyer_uid,
      platform = EXCLUDED.platform, app_id = EXCLUDED.app_id, app = EXCLUDED.app, updated_at = EXCLUDED.updated_at,
      tracking_opt_out = EXCLUDED.tracking_opt_out;
    PERFORM pg_temp.t4226x_check(true, 'T-01 Explorer appsflyer_devices upsert on an attributed row still works');
  EXCEPTION WHEN others THEN PERFORM pg_temp.t4226x_check(false, 'T-01 Explorer appsflyer_devices upsert on an attributed row still works', SQLERRM);
  END;
  BEGIN
    INSERT INTO public.appsflyer_devices(user_id, appsflyer_uid, platform, app_id, app, updated_at, tracking_opt_out)
    VALUES (v_u1, 'af-x1-new-phone', 'ios', 'id1', 'consumer', now(), false)
    ON CONFLICT (user_id, app, appsflyer_uid) DO UPDATE SET updated_at = EXCLUDED.updated_at;
    PERFORM pg_temp.t4226x_check(true, 'T-01 Explorer appsflyer_devices first registration (insert) still works');
  EXCEPTION WHEN others THEN PERFORM pg_temp.t4226x_check(false, 'T-01 Explorer appsflyer_devices first registration (insert) still works', SQLERRM);
  END;
  BEGIN
    UPDATE public.appsflyer_devices SET app = 'consumer', tracking_opt_out = true
     WHERE user_id = v_u1 AND app = 'consumer' AND appsflyer_uid = 'af-x1';
    PERFORM pg_temp.t4226x_check(true, 'T-01 Explorer device opt-out update still works');
  EXCEPTION WHEN others THEN PERFORM pg_temp.t4226x_check(false, 'T-01 Explorer device opt-out update still works', SQLERRM);
  END;
  PERFORM pg_temp.t4226x_as(v_u2);
  BEGIN
    INSERT INTO public.appsflyer_devices(user_id, appsflyer_uid, platform, app_id, app, updated_at, tracking_opt_out)
    VALUES (v_u2, 'af-x2', 'android', 'com.x', 'business', now(), true)
    ON CONFLICT (user_id, app, appsflyer_uid) DO UPDATE SET user_id = EXCLUDED.user_id, appsflyer_uid = EXCLUDED.appsflyer_uid,
      platform = EXCLUDED.platform, app_id = EXCLUDED.app_id, app = EXCLUDED.app, updated_at = EXCLUDED.updated_at,
      tracking_opt_out = EXCLUDED.tracking_opt_out;
    UPDATE public.appsflyer_devices SET app = 'business', tracking_opt_out = false
     WHERE user_id = v_u2 AND app = 'business' AND appsflyer_uid = 'af-x2';
    PERFORM pg_temp.t4226x_check(true, 'T-01 Host appsflyer_devices upsert and opt-out update still work');
  EXCEPTION WHEN others THEN PERFORM pg_temp.t4226x_check(false, 'T-01 Host appsflyer_devices upsert and opt-out update still work', SQLERRM);
  END;
  -- mingla-business creatorAccount.ts: ensureCreatorAccount (ON CONFLICT DO NOTHING) on an existing row, then edits.
  BEGIN
    INSERT INTO public.creator_accounts(id, email, display_name, avatar_url) VALUES (v_u2, 't4226x-u2@mingla-fixture.org', 'X Two', NULL)
    ON CONFLICT (id) DO NOTHING;
    UPDATE public.creator_accounts SET display_name = 'X Two Edited' WHERE id = v_u2;
    UPDATE public.creator_accounts SET default_brand_id = NULL WHERE id = v_u2;
    PERFORM pg_temp.t4226x_check(true, 'T-01 Host ensureCreatorAccount upsert and account edits still work');
  EXCEPTION WHEN others THEN PERFORM pg_temp.t4226x_check(false, 'T-01 Host ensureCreatorAccount upsert and account edits still work', SQLERRM);
  END;
  PERFORM pg_temp.t4226x_as(v_u6);
  BEGIN
    INSERT INTO public.creator_accounts(id, email, display_name, avatar_url) VALUES (v_u6, 't4226x-u6@mingla-fixture.org', 'X Six', NULL)
    ON CONFLICT (id) DO NOTHING;
    PERFORM pg_temp.t4226x_check((SELECT count(*) FROM public.creator_accounts WHERE id = v_u6) = 1,
      'T-01 a brand-new Host account is created by ensureCreatorAccount');
  EXCEPTION WHEN others THEN PERFORM pg_temp.t4226x_check(false, 'T-01 a brand-new Host account is created by ensureCreatorAccount', SQLERRM);
  END;
  RESET ROLE;
  PERFORM pg_temp.t4226x_check(
    (SELECT media_source = 'tiktok_int' AND campaign = 'c1' AND conversion_payload IS NOT NULL FROM public.appsflyer_devices WHERE appsflyer_uid = 'af-x1')
    AND (SELECT media_source = 'Facebook Ads' FROM public.appsflyer_devices WHERE appsflyer_uid = 'af-x2')
    AND (SELECT onboarding_furthest_step = 2 AND signup_source = 'friend_invite' FROM public.person_journey WHERE user_id = v_u1)
    AND (SELECT brand_setup_furthest_step = 2 FROM public.person_journey WHERE user_id = v_u2),
    'T-01 the device upsert and profile edits keep every stored tracking value');

  ------------------------------------------------------------------------------
  -- T-02 Tracking columns refused to a signed-in client; service writers pass.
  ------------------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4226x_as(v_u1);
  FOR v_fn IN SELECT unnest(ARRAY[
      'UPDATE public.appsflyer_devices SET media_source = NULL WHERE appsflyer_uid = ''af-x1''',
      'UPDATE public.appsflyer_devices SET af_status = ''Organic'' WHERE appsflyer_uid = ''af-x1''',
      'UPDATE public.appsflyer_devices SET campaign = ''x'' WHERE appsflyer_uid = ''af-x1''',
      'UPDATE public.appsflyer_devices SET install_time = now() WHERE appsflyer_uid = ''af-x1''',
      'UPDATE public.appsflyer_devices SET conversion_payload = ''{}'' WHERE appsflyer_uid = ''af-x1''',
      'UPDATE public.appsflyer_devices SET attribution_received_at = NULL WHERE appsflyer_uid = ''af-x1''',
      'INSERT INTO public.appsflyer_devices(user_id, appsflyer_uid, platform, app_id, app, media_source) VALUES (''' || v_u1 || ''', ''af-x1-forged'', ''ios'', ''id1'', ''consumer'', ''forged'')',
      'INSERT INTO public.appsflyer_devices(user_id, appsflyer_uid, platform, app_id, app) VALUES (''' || v_u1 || ''', ''af-x1'', ''ios'', ''id1'', ''consumer'') ON CONFLICT (user_id, app, appsflyer_uid) DO UPDATE SET media_source = ''forged'''])
  LOOP
    v_raised := false; v_msg := NULL;
    BEGIN
      EXECUTE v_fn;
    EXCEPTION WHEN others THEN v_raised := true; v_msg := SQLERRM;
    END;
    PERFORM pg_temp.t4226x_check(v_raised AND v_msg = 'journey_fields_server_owned', 'T-02 refused: ' || left(v_fn, 90), v_msg);
  END LOOP;
  -- The sign-up source and the steps are not columns of profiles / creator_accounts
  -- any more: they live in the private person_journey table. A signed-in client
  -- has no access to it at all (read, insert, update or delete).
  FOR v_fn IN SELECT unnest(ARRAY[
      'UPDATE public.person_journey SET signup_source = ''paid_ad'' WHERE user_id = ''' || v_u1 || '''',
      'UPDATE public.person_journey SET signup_source_detail = ''{"label":"x"}'' WHERE user_id = ''' || v_u1 || '''',
      'UPDATE public.person_journey SET signup_surface = ''web'' WHERE user_id = ''' || v_u1 || '''',
      'UPDATE public.person_journey SET onboarding_furthest_step = 1 WHERE user_id = ''' || v_u1 || '''',
      'UPDATE public.person_journey SET onboarding_furthest_step_key = ''x'' WHERE user_id = ''' || v_u1 || '''',
      'UPDATE public.person_journey SET onboarding_furthest_step_at = NULL WHERE user_id = ''' || v_u1 || '''',
      'UPDATE public.person_journey SET brand_setup_furthest_step = 4 WHERE user_id = ''' || v_u2 || '''',
      'UPDATE public.person_journey SET brand_setup_furthest_step_key = ''done'' WHERE user_id = ''' || v_u2 || '''',
      'INSERT INTO public.person_journey(user_id, signup_source) VALUES (''' || v_u6 || ''', ''paid_ad'')',
      'DELETE FROM public.person_journey WHERE user_id = ''' || v_u1 || '''',
      'SELECT count(*) FROM public.person_journey'])
  LOOP
    v_raised := false; v_msg := NULL;
    BEGIN
      EXECUTE v_fn;
    EXCEPTION WHEN others THEN v_raised := true; v_msg := SQLERRM;
    END;
    PERFORM pg_temp.t4226x_check(v_raised AND v_msg LIKE 'permission denied%', 'T-02 refused: ' || left(v_fn, 90), v_msg);
  END LOOP;
  RESET ROLE;
  SET LOCAL ROLE service_role;
  BEGIN
    UPDATE public.person_journey SET onboarding_furthest_step_key = 'svc' WHERE user_id = v_u1;
    UPDATE public.appsflyer_devices SET campaign = 'svc' WHERE appsflyer_uid = 'af-x1';
    PERFORM pg_temp.t4226x_check(true, 'T-02 service_role (edge functions) is not refused');
  EXCEPTION WHEN others THEN PERFORM pg_temp.t4226x_check(false, 'T-02 service_role (edge functions) is not refused', SQLERRM);
  END;
  RESET ROLE;

  ------------------------------------------------------------------------------
  -- T-03 anon and non-admin.
  ------------------------------------------------------------------------------
  FOREACH v_fn IN ARRAY ARRAY['public.admin_people_directory()', 'public.admin_people_filter(jsonb)',
      'public.admin_people_filter_counts(jsonb)', 'public.admin_people_facets(jsonb)', 'public.admin_person_journey(text)',
      'public.admin_people_lookup(uuid[],text)', 'public.admin_get_person(uuid)', 'public.admin_people_journey_rows()',
      'public.admin_people_row_matches(public.admin_people_journey_row,jsonb,text)',
      'public.record_journey_mark(text,smallint,text)', 'public.record_signup_source(text,jsonb,text)',
      'public.record_install_attribution(text,text,jsonb)', 'public.issue_4226_guard_journey_columns()'] LOOP
    PERFORM pg_temp.t4226x_check(NOT has_function_privilege('anon', v_fn, 'EXECUTE'), 'T-03 anon cannot execute ' || v_fn);
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY['public.admin_people_journey_rows()',
      'public.admin_people_row_matches(public.admin_people_journey_row,jsonb,text)', 'public.issue_4226_guard_journey_columns()'] LOOP
    PERFORM pg_temp.t4226x_check(NOT has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'T-03 signed-in cannot execute ' || v_fn);
  END LOOP;
  SET LOCAL ROLE anon;
  PERFORM pg_temp.t4226x_as(NULL);
  FOREACH v_fn IN ARRAY ARRAY[
      'SELECT count(*) FROM public.admin_people_directory()',
      'SELECT count(*) FROM public.admin_people_filter(''{}'')',
      'SELECT public.record_signup_source(''organic'', NULL, NULL)'] LOOP
    v_raised := false; v_msg := NULL;
    BEGIN EXECUTE v_fn; EXCEPTION WHEN others THEN v_raised := true; v_msg := SQLERRM; END;
    PERFORM pg_temp.t4226x_check(v_raised AND v_msg LIKE 'permission denied%', 'T-03 anon run refused: ' || v_fn, v_msg);
  END LOOP;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4226x_as(v_u1);
  FOREACH v_fn IN ARRAY ARRAY[
      'SELECT count(*) FROM public.admin_people_directory()',
      'SELECT count(*) FROM public.admin_people_filter(''{}'')',
      'SELECT count(*) FROM public.admin_people_filter(''{"track":"internal"}'')',
      'SELECT public.admin_people_filter_counts(''{"a":{}}'')',
      'SELECT public.admin_people_facets(''{}'')',
      'SELECT public.admin_person_journey(''u:' || v_u2 || ''')',
      'SELECT public.admin_people_lookup(NULL, ''t4226x'')',
      'SELECT public.admin_people_lookup(ARRAY[''' || v_u2 || '''::uuid], NULL)',
      'SELECT public.admin_get_person(''' || v_u2 || ''')'] LOOP
    v_raised := false; v_msg := NULL;
    BEGIN EXECUTE v_fn; EXCEPTION WHEN others THEN v_raised := true; v_msg := SQLERRM; END;
    PERFORM pg_temp.t4226x_check(v_raised AND v_msg = 'not_authorized', 'T-03 non-admin refused: ' || v_fn, v_msg);
  END LOOP;
  RESET ROLE;

  ------------------------------------------------------------------------------
  -- T-04 Junk input to the tracking RPCs; never another person's row.
  ------------------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4226x_as(v_u6);
  FOR v_fn, v_msg IN SELECT * FROM (VALUES
      ('SELECT public.record_signup_source(''Paid_Ad'', NULL, ''explorer_app'')', 'invalid_source'),
      ('SELECT public.record_signup_source('' paid_ad'', NULL, ''explorer_app'')', 'invalid_source'),
      ('SELECT public.record_signup_source('''', NULL, ''explorer_app'')', 'invalid_source'),
      ('SELECT public.record_signup_source(NULL, NULL, ''explorer_app'')', 'invalid_source'),
      ('SELECT public.record_signup_source(''paid_ad''''; drop table profiles; --'', NULL, NULL)', 'invalid_source'),
      ('SELECT public.record_signup_source(''host_contact'', NULL, NULL)', 'invalid_source'),
      ('SELECT public.record_signup_source(''web_checkout'', NULL, NULL)', 'invalid_source'),
      ('SELECT public.record_signup_source(''organic'', NULL, ''tiktok'')', 'invalid_surface'),
      ('SELECT public.record_signup_source(''organic'', ''[1,2]'', NULL)', 'invalid_detail'),
      ('SELECT public.record_signup_source(''organic'', ''"text"'', NULL)', 'invalid_detail'),
      ('SELECT public.record_signup_source(''organic'', jsonb_build_object(''x'', repeat(''a'', 5000)), NULL)', 'invalid_detail'),
      ('SELECT public.record_journey_mark(NULL, 1::smallint, ''x'')', 'invalid_kind'),
      ('SELECT public.record_journey_mark(''EXPLORER_ONBOARDING'', 1::smallint, ''x'')', 'invalid_kind'),
      ('SELECT public.record_journey_mark(''explorer_onboarding'', (-1)::smallint, ''x'')', 'invalid_step'),
      ('SELECT public.record_journey_mark(''explorer_onboarding'', NULL, ''x'')', 'invalid_step'),
      ('SELECT public.record_install_attribution('''', ''consumer'', ''{}'')', 'invalid_appsflyer_id'),
      ('SELECT public.record_install_attribution(''af'', ''web'', ''{}'')', 'invalid_app'),
      ('SELECT public.record_install_attribution(''af'', ''consumer'', ''[]'')', 'invalid_payload'),
      ('SELECT public.record_install_attribution(''af'', ''consumer'', NULL)', 'invalid_payload'),
      ('SELECT public.record_install_attribution(''af'', ''consumer'', jsonb_build_object(''x'', repeat(''a'', 17000)))', 'invalid_payload')) x
  LOOP
    v_raised := false;
    DECLARE v_err text; BEGIN
      EXECUTE v_fn;
    EXCEPTION WHEN others THEN v_raised := true; v_err := SQLERRM;
      PERFORM pg_temp.t4226x_check(v_err = v_msg, 'T-04 rejects junk: ' || left(v_fn, 80), v_err);
    END;
    IF NOT v_raised THEN PERFORM pg_temp.t4226x_check(false, 'T-04 rejects junk: ' || left(v_fn, 80), 'accepted'); END IF;
  END LOOP;
  RESET ROLE;
  PERFORM pg_temp.t4226x_check(NOT EXISTS (SELECT 1 FROM public.person_journey WHERE user_id = v_u6 AND signup_source IS NOT NULL), 'T-04 nothing junk was stored');
  SET LOCAL ROLE authenticated;
  -- Another person's row, another app, another AppsFlyer id: never touched.
  PERFORM pg_temp.t4226x_as(v_u4);
  PERFORM public.record_install_attribution('af-x3', 'consumer', '{"af_status":"Non-organic","media_source":"hijack"}'::jsonb);
  PERFORM public.record_install_attribution('af-x4', 'business', '{"af_status":"Non-organic","media_source":"hijack"}'::jsonb);
  PERFORM public.record_journey_mark('host_brand_setup', 9::smallint, 'hijack');
  PERFORM pg_temp.t4226x_as(v_u3);
  PERFORM public.record_install_attribution('af-x4', 'consumer', '{"af_status":"Non-organic","media_source":"hijack"}'::jsonb);
  RESET ROLE;
  PERFORM pg_temp.t4226x_check(
    NOT EXISTS (SELECT 1 FROM public.appsflyer_devices WHERE media_source = 'hijack')
    AND (SELECT brand_setup_furthest_step IS NULL FROM public.person_journey WHERE user_id = v_u2) IS NOT TRUE,
    'T-04 an RPC never writes a row that is not the caller''s (other user, other app, no Host account)');
  -- An organic first answer may be upgraded, a media source never replaced.
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4226x_as(v_u4);
  PERFORM public.record_install_attribution('af-x4', 'consumer', '{"af_status":"Non-organic","media_source":"late_ad"}'::jsonb);
  PERFORM public.record_install_attribution('af-x4', 'consumer', '{"af_status":"Non-organic","media_source":"later_ad"}'::jsonb);
  RESET ROLE;
  PERFORM pg_temp.t4226x_check((SELECT media_source FROM public.appsflyer_devices WHERE appsflyer_uid = 'af-x4') = 'late_ad',
    'T-04 install attribution: organic upgradable once, first media source then wins');
  -- put u4 back to organic-only for T-06
  UPDATE public.appsflyer_devices SET af_status = 'Organic', media_source = NULL, campaign = NULL WHERE appsflyer_uid = 'af-x4';

  ------------------------------------------------------------------------------
  -- T-09 Another signed-in person cannot read someone's tracking data.
  ------------------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4226x_as(v_u2);
  v_msg := NULL;
  BEGIN
    SELECT concat_ws('|', p.signup_source, p.signup_source_detail::text, p.signup_surface, p.onboarding_furthest_step::text)
      INTO v_msg FROM public.person_journey p WHERE p.user_id = v_u1;
  EXCEPTION WHEN insufficient_privilege THEN v_msg := NULL;
  END;
  PERFORM pg_temp.t4226x_check(COALESCE(v_msg, '') = '',
    'T-09 another signed-in person cannot read someone''s sign-up source, its detail or onboarding step', 'read: ' || v_msg);
  RESET ROLE;

  ------------------------------------------------------------------------------
  -- Admin reads.
  ------------------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4226x_as(v_admin);

  -- T-05 PII via p_detail.
  SET LOCAL ROLE postgres;
  UPDATE public.person_journey SET signup_source = NULL WHERE user_id = v_u6;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4226x_as(v_u6);
  PERFORM public.record_signup_source('referral_link',
    jsonb_build_object('label', repeat('L', 300), 'email', 'secret.person@example.org', 'phone', '+2348000000000'), 'explorer_app');
  PERFORM pg_temp.t4226x_as(v_admin);
  SELECT f.source_detail, to_jsonb(f)::text AS whole INTO v_r FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_u6;
  PERFORM pg_temp.t4226x_check(length(v_r.source_detail) <= 120 AND v_r.whole NOT LIKE '%secret.person%' AND v_r.whole NOT LIKE '%2348000000000%',
    'T-05 the People row carries at most the 120-char label of p_detail, never other detail keys');
  PERFORM pg_temp.t4226x_check(public.admin_person_journey('u:' || v_u1)::text NOT LIKE '%tiktok_int","campaign%'
    AND public.admin_person_journey('u:' || v_u1)::text NOT LIKE '%conversion_payload%',
    'T-05 the journey does not carry the raw AppsFlyer payload');

  -- T-06 Source precedence (D3 / D10).
  SELECT f.source, f.source_confidence INTO v_r FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_u3;
  PERFORM pg_temp.t4226x_check(v_r.source = 'web_ticket_first',
    'T-06 a web ticket before sign-up stays the source when the app later records "organic" (D10)',
    'got ' || COALESCE(v_r.source, 'null') || '/' || COALESCE(v_r.source_confidence, 'null'));
  SELECT f.source, f.source_confidence INTO v_r FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_u4;
  PERFORM pg_temp.t4226x_check(v_r.source = 'host_contact',
    'T-06 a host contact before sign-up stays the source when AppsFlyer says Organic (D10)',
    'got ' || COALESCE(v_r.source, 'null') || '/' || COALESCE(v_r.source_confidence, 'null'));
  SELECT f.source, f.source_confidence INTO v_r FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_u1;
  PERFORM pg_temp.t4226x_check(v_r.source = 'friend_invite' AND v_r.source_confidence = 'known',
    'T-06 a recorded friend invite is known and outranks AppsFlyer non-organic');

  -- T-08 Case and spaces.
  PERFORM pg_temp.t4226x_check(
    (SELECT count(*) FROM public.admin_people_filter('{"country":"NG"}'::jsonb) f WHERE f.user_id = v_u3) = 1
    AND (SELECT count(*) FROM public.admin_people_filter('{"country":" ng "}'::jsonb) f WHERE f.user_id = v_u3) = 1
    AND (SELECT count(*) FROM public.admin_people_filter('{"city":"LAGOS"}'::jsonb) f WHERE f.user_id = v_u3) = 1
    AND (SELECT count(*) FROM public.admin_people_filter('{"city":"lagos"}'::jsonb) f WHERE f.user_id = v_u3) = 1,
    'T-08 country and city match in any case and with stray spaces');
  PERFORM pg_temp.t4226x_check(
    (SELECT f.city = 'lagos' AND f.city_source = 'discovery_city' AND f.country = 'NG' AND f.country_source = 'profile'
       FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_u3),
    'T-08 place values carry their source');

  -- T-10 A sign-up with no step recorded says so (spec D1 "Stopped before step 2" / not recorded), not "step 0".
  SELECT f.explorer_stage, f.explorer_stopped_step INTO v_r FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_u7;
  PERFORM pg_temp.t4226x_check(v_r.explorer_stage = 'signing_up' AND v_r.explorer_stopped_step IS NULL
      AND EXISTS (SELECT 1 FROM public.admin_people_filter('{"track":"signing_up","stopped_step":"none"}'::jsonb) f WHERE f.user_id = v_u7),
    'T-10 a sign-up with no recorded step has no stopped step and matches stopped_step=none',
    format('stage %s stopped_step %s', v_r.explorer_stage, v_r.explorer_stopped_step));

  -- T-07 Facet = filter, every option, every track incl. the trackless builder.
  FOREACH v_key IN ARRAY ARRAY['', 'explorers', 'hosts', 'both', 'signing_up', 'no_account', 'no_account_buyers',
                               'no_account_contacts', 'internal'] LOOP
    v_f := CASE WHEN v_key = '' THEN '{}'::jsonb ELSE jsonb_build_object('track', v_key) END;
    v_facets := public.admin_people_facets(v_f);
    FOR v_fn, v_opt IN SELECT fk.key, o FROM jsonb_each(v_facets -> 'facets') fk CROSS JOIN LATERAL jsonb_array_elements(fk.value) o LOOP
      SELECT count(*) INTO v_n FROM public.admin_people_filter(v_f || jsonb_build_object(v_fn, v_opt ->> 'value'));
      IF v_n <> (v_opt ->> 'count')::bigint THEN
        v_bad := v_bad || format('[track %s: %s=%s facet %s filter %s] ', COALESCE(NULLIF(v_key, ''), 'none'), v_fn, v_opt ->> 'value', v_opt ->> 'count', v_n);
      END IF;
    END LOOP;
  END LOOP;
  -- bank_connected=yes on the trackless (Email builder) filter must also equal its facet.
  v_facets := public.admin_people_facets('{}'::jsonb);
  SELECT count(*) INTO v_n FROM public.admin_people_filter('{"bank_connected":"yes"}'::jsonb);
  IF v_n <> COALESCE((SELECT (o ->> 'count')::bigint FROM jsonb_array_elements(v_facets #> '{facets,bank_connected}') o WHERE o ->> 'value' = 'yes'), 0) THEN
    v_bad := v_bad || format('[bank_connected=yes trackless: facet %s filter %s] ',
      (SELECT o ->> 'count' FROM jsonb_array_elements(v_facets #> '{facets,bank_connected}') o WHERE o ->> 'value' = 'yes'), v_n);
  END IF;
  PERFORM pg_temp.t4226x_check(v_bad = '', 'T-07 every facet option count equals its filter count', v_bad);
  RESET ROLE;

  -- The verdict, inside the transaction (the ROLLBACK below would erase the results).
  SELECT string_agg(label || COALESCE(' :: ' || detail, ''), E'\n') INTO v_msg FROM t4226x_result WHERE NOT ok;
  IF v_msg IS NOT NULL THEN
    RAISE EXCEPTION 'issue #4226 tester adversarial FAIL:%', E'\n' || v_msg;
  END IF;
  RAISE NOTICE 'issue #4226 tester adversarial: % checks PASS', (SELECT count(*) FROM t4226x_result);
END
$t$;
ROLLBACK;

