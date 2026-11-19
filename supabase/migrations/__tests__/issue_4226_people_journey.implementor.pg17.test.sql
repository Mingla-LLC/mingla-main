\set ON_ERROR_STOP on

-- Issue #4226 Phase 2 — People journey, the one shared filter, and the app
-- tracking RPCs. Run after the full migration chain on PostgreSQL 17.
--
--   J-01  Grants and guards: the tracking RPCs run for signed-in people only
--         (anon denied); the admin functions are definer + admin guard; the
--         helpers are not callable by signed-in users; the directory returns
--         the new journey columns.
--   J-02  Tracking: record_journey_mark is monotonic (a lower step is
--         ignored; the same step with a new key updates the key) and writes
--         only the caller's row; an unknown kind raises; host_brand_setup with
--         no Host account is a no-op. record_signup_source: first write wins,
--         allow-list enforced. record_install_attribution: own device row
--         only, first media source wins. A signed-in client cannot write the
--         tracking columns directly.
--   J-03  One fixture per Explorer stage (signing_up with its step,
--         onboarded, exploring, connected, going, regular).
--   J-04  One fixture per Host checklist state (create_brand ...
--         repeat_seller) plus a team-member-only host.
--   J-05  Source precedence: a recorded signup source and AppsFlyer
--         non-organic install data are known and outrank a web ticket bought
--         before sign-up (inferred); nothing at all is unknown.
--   J-06  Country is matched in any case; facets offer it upper-case.
--   J-07  Staff/test only on the internal track; seed profiles nowhere.
--   J-08  Every facet option's count equals the filter count with that option
--         chosen; filter_counts equals the rows admin_people_filter returns.
--   J-09  admin_person_journey returns dated milestones; an unknown key
--         raises not_found; a non-admin is refused.
--   J-10  admin_get_person and admin_people_lookup use the People classifier.
-- MINGLA-INVARIANT: I-4226-PEOPLE-ONE-FILTER | issue #4226 | People and the Email audience read one admin-only filter (admin_people_filter over admin_people_journey_rows); a filter's People count equals its Email matched count, and every facet option's count equals the filter count with that option chosen.

CREATE OR REPLACE FUNCTION pg_temp.t4226j_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4226 people journey FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- Act as a signed-in user (or anon) for one call.
CREATE OR REPLACE FUNCTION pg_temp.t4226j_as(p_uid uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', CASE WHEN p_uid IS NULL THEN 'anon' ELSE 'authenticated' END)::text, true);
END
$f$;

BEGIN;
DO $j01$
DECLARE
  v_fn text;
  v_col text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.record_journey_mark(text,smallint,text)',
                              'public.record_signup_source(text,jsonb,text)',
                              'public.record_install_attribution(text,text,jsonb)'] LOOP
    PERFORM pg_temp.t4226j_assert(NOT has_function_privilege('anon', v_fn, 'EXECUTE'), 'J-01 anon cannot run ' || v_fn);
    PERFORM pg_temp.t4226j_assert(has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'J-01 signed-in may run ' || v_fn);
    PERFORM pg_temp.t4226j_assert((SELECT prosecdef FROM pg_proc WHERE oid = v_fn::regprocedure), 'J-01 definer ' || v_fn);
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY['public.admin_people_directory()', 'public.admin_people_filter(jsonb)',
                              'public.admin_people_filter_counts(jsonb)', 'public.admin_people_facets(jsonb)',
                              'public.admin_person_journey(text)', 'public.admin_people_lookup(uuid[],text)',
                              'public.admin_get_person(uuid)'] LOOP
    PERFORM pg_temp.t4226j_assert(NOT has_function_privilege('anon', v_fn, 'EXECUTE'), 'J-01 anon cannot run ' || v_fn);
    PERFORM pg_temp.t4226j_assert(
      (SELECT p.prosecdef AND p.prosrc ~ 'IF NOT \(?public\.is_admin_user\(\)' FROM pg_proc p WHERE p.oid = v_fn::regprocedure),
      'J-01 definer + admin guard ' || v_fn);
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY['public.admin_people_journey_rows()',
                              'public.admin_people_row_matches(public.admin_people_journey_row,jsonb,text)'] LOOP
    PERFORM pg_temp.t4226j_assert(NOT has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'J-01 helper not callable ' || v_fn);
  END LOOP;
  PERFORM pg_temp.t4226j_assert(
    (SELECT p.prosrc !~ 'derive_user_segment' FROM pg_proc p WHERE p.oid = 'public.admin_get_person(uuid)'::regprocedure),
    'J-01 admin_get_person no longer reads derive_user_segment');
  FOREACH v_col IN ARRAY ARRAY['explorer_stage', 'explorer_stopped_step', 'host_checklist', 'host_next_step', 'source',
                               'source_confidence', 'city', 'city_source', 'country_source', 'last_active_at',
                               'activity_status', 'rsvp_count', 'experience_count', 'ticket_count', 'brand_count',
                               'first_brand_at', 'published_count', 'bank_connected', 'payout_countries',
                               'first_sale_at', 'brand_setup_furthest_step', 'person_kind', 'is_host_contact'] LOOP
    PERFORM pg_temp.t4226j_assert(
      v_col = ANY ((SELECT p.proargnames FROM pg_proc p WHERE p.oid = 'public.admin_people_directory()'::regprocedure)::text[]),
      'J-01 the directory returns ' || v_col);
  END LOOP;
END
$j01$;
ROLLBACK;

BEGIN;
DO $j02$
DECLARE
  v_admin  constant uuid := '42262000-0000-4000-a000-000000000001';
  -- Explorer stages.
  v_e_onb  constant uuid := '42262000-0000-4000-a000-000000000010';
  v_e_exp  constant uuid := '42262000-0000-4000-a000-000000000011';
  v_e_con  constant uuid := '42262000-0000-4000-a000-000000000012';
  v_e_go   constant uuid := '42262000-0000-4000-a000-000000000013';
  v_e_reg  constant uuid := '42262000-0000-4000-a000-000000000014';
  v_e_sign constant uuid := '42262000-0000-4000-a000-000000000015';
  v_e_test constant uuid := '42262000-0000-4000-a000-000000000016';
  v_e_seed constant uuid := '42262000-0000-4000-a000-000000000017';
  v_e_src2 constant uuid := '42262000-0000-4000-a000-000000000018';
  v_e_src3 constant uuid := '42262000-0000-4000-a000-000000000019';
  v_e_nostep constant uuid := '42262000-0000-4000-a000-00000000001a';
  -- Host checklist states.
  v_h1 constant uuid := '42262000-0000-4000-a000-000000000021';
  v_h2 constant uuid := '42262000-0000-4000-a000-000000000022';
  v_h3 constant uuid := '42262000-0000-4000-a000-000000000023';
  v_h4 constant uuid := '42262000-0000-4000-a000-000000000024';
  v_h5 constant uuid := '42262000-0000-4000-a000-000000000025';
  v_h6 constant uuid := '42262000-0000-4000-a000-000000000026';
  v_h7 constant uuid := '42262000-0000-4000-a000-000000000027';
  v_h8 constant uuid := '42262000-0000-4000-a000-000000000028';
  v_team constant uuid := '42262000-0000-4000-a000-000000000029';
  v_b2 constant uuid := '42262000-0000-4000-a000-000000000102';
  v_b3 constant uuid := '42262000-0000-4000-a000-000000000103';
  v_b4 constant uuid := '42262000-0000-4000-a000-000000000104';
  v_b5 constant uuid := '42262000-0000-4000-a000-000000000105';
  v_b6 constant uuid := '42262000-0000-4000-a000-000000000106';
  v_b7 constant uuid := '42262000-0000-4000-a000-000000000107';
  v_b8 constant uuid := '42262000-0000-4000-a000-000000000108';
  v_ev4  constant uuid := '42262000-0000-4000-a000-000000000204';
  v_ev5  constant uuid := '42262000-0000-4000-a000-000000000205';
  v_ev6  constant uuid := '42262000-0000-4000-a000-000000000206';
  v_ev7  constant uuid := '42262000-0000-4000-a000-000000000207';
  v_ev8a constant uuid := '42262000-0000-4000-a000-000000000208';
  v_ev8b constant uuid := '42262000-0000-4000-a000-000000000209';
  v_r        record;
  v_n        bigint;
  v_m        bigint;
  v_f        jsonb;
  v_facets   jsonb;
  v_key      text;
  v_opt      jsonb;
  v_track    text;
  v_checked  integer := 0;
  v_raised   boolean;
  v_j        jsonb;
  v_fn       text;
BEGIN
  -- Everyone in auth.users first (profiles reference it).
  INSERT INTO auth.users(id, email, created_at)
  SELECT x.id, x.email, now() - interval '60 days' FROM (VALUES
    (v_admin, 't4226j-admin@mingla-fixture.org'),
    (v_e_onb, 't4226j-onb@mingla-fixture.org'), (v_e_exp, 't4226j-exp@mingla-fixture.org'),
    (v_e_con, 't4226j-con@mingla-fixture.org'), (v_e_go, 't4226j-go@mingla-fixture.org'),
    (v_e_reg, 't4226j-reg@mingla-fixture.org'), (v_e_sign, 't4226j-sign@mingla-fixture.org'),
    (v_e_test, 'test.t4226j@mingla-fixture.org'), (v_e_seed, 't4226j-seed@mingla-fixture.org'),
    (v_e_src2, 't4226j-src2@mingla-fixture.org'), (v_e_src3, 't4226j-src3@mingla-fixture.org'),
    (v_e_nostep, 't4226j-nostep@mingla-fixture.org'),
    (v_h1, 't4226j-h1@mingla-fixture.org'), (v_h2, 't4226j-h2@mingla-fixture.org'),
    (v_h3, 't4226j-h3@mingla-fixture.org'), (v_h4, 't4226j-h4@mingla-fixture.org'),
    (v_h5, 't4226j-h5@mingla-fixture.org'), (v_h6, 't4226j-h6@mingla-fixture.org'),
    (v_h7, 't4226j-h7@mingla-fixture.org'), (v_h8, 't4226j-h8@mingla-fixture.org'),
    (v_team, 't4226j-team@mingla-fixture.org')) x(id, email);
  INSERT INTO public.admin_users(email, role, status) VALUES ('t4226j-admin@mingla-fixture.org', 'admin', 'active');

  INSERT INTO public.profiles(id, email, display_name, has_completed_onboarding, is_seed, country, created_at, onboarding_step) VALUES
    (v_admin,  't4226j-admin@mingla-fixture.org', 'J Admin', true, true, NULL, now(), NULL),
    -- J-06: a lower-case profile country.
    (v_e_onb,  't4226j-onb@mingla-fixture.org',  'J Onboarded',  true,  false, 'zz', now() - interval '50 days', NULL),
    (v_e_exp,  't4226j-exp@mingla-fixture.org',  'J Exploring',  true,  false, 'ZZ', now() - interval '50 days', NULL),
    (v_e_con,  't4226j-con@mingla-fixture.org',  'J Connected',  true,  false, NULL, now() - interval '50 days', NULL),
    (v_e_go,   't4226j-go@mingla-fixture.org',   'J Going',      true,  false, NULL, now() - interval '50 days', NULL),
    (v_e_reg,  't4226j-reg@mingla-fixture.org',  'J Regular',    true,  false, NULL, now() - interval '50 days', NULL),
    (v_e_sign, 't4226j-sign@mingla-fixture.org', 'J Signing',    false, false, NULL, now() - interval '50 days', 1),
    (v_e_test, 'test.t4226j@mingla-fixture.org', 'J Test',       true,  false, NULL, now() - interval '50 days', NULL),
    (v_e_seed, 't4226j-seed@mingla-fixture.org', 'J Seed',       true,  true,  NULL, now() - interval '50 days', NULL),
    (v_e_src2, 't4226j-src2@mingla-fixture.org', 'J Src2',       true,  false, NULL, now() - interval '10 days', NULL),
    (v_e_src3, 't4226j-src3@mingla-fixture.org', 'J Src3',       true,  false, NULL, now() - interval '10 days', NULL),
    (v_e_nostep, 't4226j-nostep@mingla-fixture.org', 'J No Step', false, false, NULL, now() - interval '5 days', NULL),
    (v_h1, 't4226j-h1@mingla-fixture.org', 'J H1', false, false, NULL, now() - interval '50 days', NULL),
    (v_h2, 't4226j-h2@mingla-fixture.org', 'J H2', false, false, NULL, now() - interval '50 days', NULL),
    (v_h3, 't4226j-h3@mingla-fixture.org', 'J H3', false, false, NULL, now() - interval '50 days', NULL),
    (v_h4, 't4226j-h4@mingla-fixture.org', 'J H4', false, false, NULL, now() - interval '50 days', NULL),
    (v_h5, 't4226j-h5@mingla-fixture.org', 'J H5', false, false, NULL, now() - interval '50 days', NULL),
    (v_h6, 't4226j-h6@mingla-fixture.org', 'J H6', false, false, NULL, now() - interval '50 days', NULL),
    (v_h7, 't4226j-h7@mingla-fixture.org', 'J H7', false, false, NULL, now() - interval '50 days', NULL),
    (v_h8, 't4226j-h8@mingla-fixture.org', 'J H8', false, false, NULL, now() - interval '50 days', NULL),
    (v_team, 't4226j-team@mingla-fixture.org', 'J Team', false, false, NULL, now() - interval '50 days', NULL);

  INSERT INTO public.creator_accounts(id, email, created_at)
  SELECT x, 'ca-' || x::text || '@mingla-fixture.org', now() - interval '45 days'
    FROM unnest(ARRAY[v_h1, v_h2, v_h3, v_h4, v_h5, v_h6, v_h7, v_h8]) x;
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payout_country, city, created_at) VALUES
    (v_b2, v_h2, 'J Brand 2', 'j-brand-2-' || v_b2, 'NGN', NULL, 'Lagos', now() - interval '40 days'),
    (v_b3, v_h3, 'J Brand 3', 'j-brand-3-' || v_b3, 'NGN', 'NG', 'Lagos', now() - interval '40 days'),
    (v_b4, v_h4, 'J Brand 4', 'j-brand-4-' || v_b4, 'NGN', 'NG', 'Lagos', now() - interval '40 days'),
    (v_b5, v_h5, 'J Brand 5', 'j-brand-5-' || v_b5, 'NGN', 'NG', 'Lagos', now() - interval '40 days'),
    (v_b6, v_h6, 'J Brand 6', 'j-brand-6-' || v_b6, 'NGN', 'NG', 'Lagos', now() - interval '40 days'),
    (v_b7, v_h7, 'J Brand 7', 'j-brand-7-' || v_b7, 'NGN', 'NG', 'Abuja', now() - interval '40 days'),
    (v_b8, v_h8, 'J Brand 8', 'j-brand-8-' || v_b8, 'GBP', 'GB', 'London', now() - interval '40 days');
  INSERT INTO public.brand_team_members(brand_id, user_id, role, accepted_at) VALUES (v_b2, v_team, 'event_manager', now() - interval '30 days');

  INSERT INTO public.events(id, brand_id, title, slug, status, currency, created_by, city, event_type, published_at, created_at) VALUES
    (v_ev4,  v_b4, 'J Draft',  'j-draft-' || v_ev4,  'draft',     'NGN', v_h4, 'Lagos',  'event', NULL, now() - interval '35 days'),
    (v_ev5,  v_b5, 'J Pub 5',  'j-pub5-' || v_ev5,   'scheduled', 'NGN', v_h5, 'Lagos',  'event', now() - interval '30 days', now() - interval '35 days'),
    (v_ev6,  v_b6, 'J Pub 6',  'j-pub6-' || v_ev6,   'scheduled', 'NGN', v_h6, 'Lagos',  'rsvp',  now() - interval '30 days', now() - interval '35 days'),
    (v_ev7,  v_b7, 'J Pub 7',  'j-pub7-' || v_ev7,   'scheduled', 'NGN', v_h7, 'Abuja',  'event', now() - interval '30 days', now() - interval '35 days'),
    (v_ev8a, v_b8, 'J Pub 8a', 'j-pub8a-' || v_ev8a, 'scheduled', 'GBP', v_h8, 'London', 'event', now() - interval '30 days', now() - interval '35 days'),
    (v_ev8b, v_b8, 'J Pub 8b', 'j-pub8b-' || v_ev8b, 'scheduled', 'GBP', v_h8, 'London', 'experience', now() - interval '30 days', now() - interval '35 days');
  -- Banks: H6 (Paystack), H7, H8.
  INSERT INTO public.brand_paystack_recipients(brand_id, recipient_code, bank_code, account_fingerprint, account_number_masked, account_name, is_active)
  SELECT b, 'RCP_' || left(b::text, 8), '058', 'hmac-sha256:' || repeat('c', 64), '••••1234', 'J Account', true
    FROM unnest(ARRAY[v_b6, v_b7, v_b8]) b;
  -- Sales: H7 one offering; H8 two offerings. Buyers are the Explorer fixtures.
  INSERT INTO public.orders(event_id, buyer_email, buyer_name, total_cents, buyer_total_cents,
      net_subtotal_cents, currency, payment_status, payment_method, source, created_at, confirmed_at,
      list_subtotal_cents, discount_cents, buyer_fees_cents, tax_cents, pricing_source, metadata, buyer_user_id)
  VALUES
    (v_ev7,  't4226j-go@mingla-fixture.org',  'J Going',   1000, 1000, 1000, 'NGN', 'paid', 'online_card', 'legacy',
       now() - interval '20 days', now() - interval '20 days', 1000, 0, 0, 0, 'computed_at_checkout', '{}'::jsonb, v_e_go),
    (v_ev8a, 't4226j-reg@mingla-fixture.org', 'J Regular', 1000, 1000, 1000, 'GBP', 'paid', 'online_card', 'legacy',
       now() - interval '20 days', now() - interval '20 days', 1000, 0, 0, 0, 'computed_at_checkout', '{}'::jsonb, v_e_reg),
    (v_ev8b, 't4226j-reg@mingla-fixture.org', 'J Regular', 1000, 1000, 1000, 'GBP', 'paid', 'online_card', 'legacy',
       now() - interval '15 days', now() - interval '15 days', 1000, 0, 0, 0, 'computed_at_checkout', '{}'::jsonb, v_e_reg),
    -- J-05: web tickets bought before these two signed up (no account yet: no buyer_user_id).
    (v_ev7, 't4226j-src2@mingla-fixture.org', 'J Src2', 1000, 1000, 1000, 'NGN', 'paid', 'online_card', 'legacy',
       now() - interval '30 days', now() - interval '30 days', 1000, 0, 0, 0, 'computed_at_checkout', '{}'::jsonb, NULL),
    (v_ev7, 't4226j-src3@mingla-fixture.org', 'J Src3', 1000, 1000, 1000, 'NGN', 'paid', 'online_card', 'legacy',
       now() - interval '30 days', now() - interval '30 days', 1000, 0, 0, 0, 'computed_at_checkout', '{}'::jsonb, NULL);
  -- One ticket per paid order (the buyer holds it).
  INSERT INTO public.ticket_types(id, event_id, name)
  SELECT gen_random_uuid(), e, 'J General' FROM unnest(ARRAY[v_ev7, v_ev8a, v_ev8b]) e;
  INSERT INTO public.tickets(order_id, ticket_type_id, event_id, qr_code, status)
  SELECT o.id, (SELECT tt.id FROM public.ticket_types tt WHERE tt.event_id = o.event_id LIMIT 1), o.event_id,
         't4226j-qr-' || o.id::text, 'valid'
    FROM public.orders o WHERE o.buyer_email LIKE 't4226j-%@mingla-fixture.org';

  -- Explorer behaviour.
  INSERT INTO public.saved_card(profile_id, experience_id, title, category, card_data, created_at)
  VALUES (v_e_exp, 'j-card-1', 'J Card', 'test', '{}'::jsonb, now() - interval '2 days');
  INSERT INTO public.friends(user_id, friend_user_id, status) VALUES (v_e_con, v_e_seed, 'accepted');
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, guest_email, rsvp_status, approval_status, plus_count)
  VALUES (v_ev6, v_e_reg, 'J Regular', 't4226j-reg@mingla-fixture.org', 'going', 'approved', 0);

  ------------------------------------------------------------------------------
  -- J-02 tracking RPCs, as each person.
  ------------------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4226j_as(v_e_sign);
  PERFORM public.record_journey_mark('explorer_onboarding', 3::smallint, 'interests');
  PERFORM public.record_journey_mark('explorer_onboarding', 2::smallint, 'phone');
  RESET ROLE;
  SELECT onboarding_furthest_step AS s, onboarding_furthest_step_key AS k INTO v_r FROM public.person_journey WHERE user_id = v_e_sign;
  PERFORM pg_temp.t4226j_assert(v_r.s = 3 AND v_r.k = 'interests', 'J-02 a lower step does not lower the furthest step');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4226j_as(v_e_sign);
  PERFORM public.record_journey_mark('explorer_onboarding', 3::smallint, 'interests_v2');
  RESET ROLE;
  PERFORM pg_temp.t4226j_assert((SELECT onboarding_furthest_step_key FROM public.person_journey WHERE user_id = v_e_sign) = 'interests_v2',
    'J-02 the same step with a new key updates the key');
  PERFORM pg_temp.t4226j_assert((SELECT onboarding_furthest_step FROM public.person_journey WHERE user_id = v_e_onb) IS NULL,
    'J-02 another person''s row is untouched');

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4226j_as(v_e_sign);
  v_raised := false;
  BEGIN
    PERFORM public.record_journey_mark('nonsense', 1::smallint, 'x');
  EXCEPTION WHEN others THEN v_raised := SQLERRM = 'invalid_kind';
  END;
  PERFORM pg_temp.t4226j_assert(v_raised, 'J-02 an unknown kind raises invalid_kind');
  -- No Host account: a no-op.
  PERFORM public.record_journey_mark('host_brand_setup', 2::smallint, 'brand_name');
  PERFORM pg_temp.t4226j_as(v_h1);
  PERFORM public.record_journey_mark('host_brand_setup', 2::smallint, 'brand_name');
  PERFORM public.record_journey_mark('host_brand_setup', 1::smallint, 'welcome');
  RESET ROLE;
  PERFORM pg_temp.t4226j_assert(
    (SELECT brand_setup_furthest_step = 2 AND brand_setup_furthest_step_key = 'brand_name' FROM public.person_journey WHERE user_id = v_h1),
    'J-02 brand setup step is monotonic on the caller''s Host account');
  PERFORM pg_temp.t4226j_assert(
    (SELECT brand_setup_furthest_step IS NULL FROM public.person_journey WHERE user_id = v_e_sign) IS NOT FALSE,
    'J-02 a person with no Host account records no brand setup step');

  -- Signup source: first write wins; allow-list.
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4226j_as(v_e_src3);
  v_raised := false;
  BEGIN
    PERFORM public.record_signup_source('made_up', NULL, 'explorer_app');
  EXCEPTION WHEN others THEN v_raised := SQLERRM = 'invalid_source';
  END;
  PERFORM pg_temp.t4226j_assert(v_raised, 'J-02 a source outside the allow-list raises');
  PERFORM pg_temp.t4226j_as(v_e_onb);
  PERFORM public.record_signup_source('friend_invite', '{"label":"from Ada"}'::jsonb, 'explorer_app');
  PERFORM public.record_signup_source('paid_ad', NULL, 'web');
  RESET ROLE;
  PERFORM pg_temp.t4226j_assert(
    (SELECT signup_source = 'friend_invite' AND signup_surface = 'explorer_app' FROM public.person_journey WHERE user_id = v_e_onb),
    'J-02 the first signup source wins');

  -- Install attribution: own row only, first media source wins.
  INSERT INTO public.appsflyer_devices(user_id, appsflyer_uid, platform, app_id, app) VALUES
    (v_e_src2, 'af-src2', 'ios', 'id1', 'consumer'),
    (v_e_src3, 'af-src3', 'ios', 'id1', 'consumer');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4226j_as(v_e_src2);
  PERFORM public.record_install_attribution('af-src3', 'consumer', '{"af_status":"Non-organic","media_source":"tiktok_int"}'::jsonb);
  PERFORM public.record_install_attribution('af-src2', 'consumer',
    '{"af_status":"Non-organic","media_source":"Facebook Ads","campaign":"Lagos weekends","install_time":"2026-11-01 10:00:00.000"}'::jsonb);
  PERFORM public.record_install_attribution('af-src2', 'consumer', '{"af_status":"Non-organic","media_source":"googleadwords_int"}'::jsonb);
  RESET ROLE;
  PERFORM pg_temp.t4226j_assert(
    (SELECT media_source IS NULL FROM public.appsflyer_devices WHERE appsflyer_uid = 'af-src3'),
    'J-02 install attribution never writes another person''s device');
  SELECT media_source, campaign, install_time INTO v_r FROM public.appsflyer_devices WHERE appsflyer_uid = 'af-src2';
  PERFORM pg_temp.t4226j_assert(v_r.media_source = 'Facebook Ads' AND v_r.campaign = 'Lagos weekends' AND v_r.install_time IS NOT NULL,
    'J-02 the first media source wins and the payload fields are stored');

  -- Return value, device row created when missing, foreign ids refused.
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4226j_as(v_e_src3);
  PERFORM pg_temp.t4226j_assert(
    public.record_install_attribution('af-src3', 'consumer', '{"af_status":"Non-organic","media_source":"tiktok_int"}'::jsonb) IS TRUE,
    'J-02 install attribution returns true when it wrote the row');
  PERFORM pg_temp.t4226j_assert(
    public.record_install_attribution('af-src3', 'consumer', '{"af_status":"Non-organic","media_source":"later_ad"}'::jsonb) IS FALSE,
    'J-02 install attribution returns false once the first write happened');
  PERFORM pg_temp.t4226j_as(v_e_exp);
  PERFORM pg_temp.t4226j_assert(
    public.record_install_attribution('af-new-con', 'consumer',
      '{"af_status":"Non-organic","media_source":"Facebook Ads","platform":"ios","app_id":"id123"}'::jsonb) IS TRUE,
    'J-02 install attribution creates the device row when the app has not registered it yet');
  v_raised := false;
  BEGIN
    PERFORM public.record_install_attribution('af-new-con2', 'consumer', '{"af_status":"Organic"}'::jsonb);
  EXCEPTION WHEN others THEN v_raised := SQLERRM = 'invalid_platform';
  END;
  PERFORM pg_temp.t4226j_assert(v_raised, 'J-02 creating a device row needs the platform in the payload (no invented data)');
  PERFORM pg_temp.t4226j_assert(
    public.record_install_attribution('af-src2', 'consumer', '{"af_status":"Non-organic","media_source":"x","platform":"ios","app_id":"id1"}'::jsonb) IS FALSE,
    'J-02 another person''s AppsFlyer id is never written (false, no row)');
  RESET ROLE;
  PERFORM pg_temp.t4226j_assert(
    (SELECT count(*) FROM public.appsflyer_devices WHERE user_id = v_e_exp) = 1
    AND (SELECT platform = 'ios' AND app_id = 'id123' AND media_source = 'Facebook Ads' FROM public.appsflyer_devices WHERE appsflyer_uid = 'af-new-con'),
    'J-02 the created device row carries the payload''s platform and app id and the attribution');
  -- The app's own registration upsert afterwards keeps the stored attribution.
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4226j_as(v_e_exp);
  INSERT INTO public.appsflyer_devices(user_id, appsflyer_uid, platform, app_id, app, updated_at)
  VALUES (v_e_exp, 'af-new-con', 'ios', 'id123', 'consumer', now())
  ON CONFLICT (user_id, app, appsflyer_uid) DO UPDATE SET platform = EXCLUDED.platform, app_id = EXCLUDED.app_id, updated_at = EXCLUDED.updated_at;
  RESET ROLE;
  PERFORM pg_temp.t4226j_assert(
    (SELECT media_source FROM public.appsflyer_devices WHERE appsflyer_uid = 'af-new-con') = 'Facebook Ads',
    'J-02 registering the device afterwards keeps the attribution');

  -- Direct writes by a signed-in client are refused.
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4226j_as(v_e_src3);
  v_raised := false;
  BEGIN
    UPDATE public.appsflyer_devices SET media_source = 'forged' WHERE user_id = v_e_src3;
  EXCEPTION WHEN others THEN v_raised := SQLERRM = 'journey_fields_server_owned';
  END;
  PERFORM pg_temp.t4226j_assert(v_raised, 'J-02 a signed-in client cannot write the AppsFlyer attribution columns directly');
  FOREACH v_fn IN ARRAY ARRAY['SELECT count(*) FROM public.person_journey',
      'UPDATE public.person_journey SET signup_source = ''paid_ad''',
      'INSERT INTO public.person_journey(user_id, signup_source) VALUES (''' || v_e_src3 || ''', ''paid_ad'')',
      'DELETE FROM public.person_journey'] LOOP
    v_raised := false;
    BEGIN
      EXECUTE v_fn;
    EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
    END;
    PERFORM pg_temp.t4226j_assert(v_raised, 'J-02 a signed-in client has no access to person_journey: ' || left(v_fn, 50));
  END LOOP;
  RESET ROLE;
  SET LOCAL ROLE anon;
  v_raised := false;
  BEGIN
    PERFORM count(*) FROM public.person_journey;
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  RESET ROLE;
  PERFORM pg_temp.t4226j_assert(v_raised, 'J-02 anon has no access to person_journey');
  PERFORM pg_temp.t4226j_assert(
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.person_journey'::regclass)
    AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'person_journey')
    AND NOT has_table_privilege('authenticated', 'public.person_journey', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.person_journey', 'SELECT')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name IN ('profiles', 'creator_accounts')
                       AND column_name IN ('signup_source', 'signup_source_detail', 'signup_surface', 'onboarding_furthest_step',
                                           'brand_setup_furthest_step')),
    'J-02 the tracking values are a private table (RLS on, no policy, no grants), not columns of profiles or creator_accounts');
  PERFORM pg_temp.t4226j_assert(
    (SELECT confdeltype FROM pg_constraint WHERE conrelid = 'public.person_journey'::regclass AND contype = 'f') = 'c',
    'J-02 a person''s journey row is deleted with their account (ON DELETE CASCADE)');
  -- The set-based classifier keeps admin_account_is_internal()'s rule and the
  -- old per-person host test, for every profile (this runs as the table owner).
  PERFORM pg_temp.t4226j_assert(
    NOT EXISTS (SELECT 1 FROM public.admin_people_app_status() s
                 WHERE s.is_internal IS DISTINCT FROM public.admin_account_is_internal(s.user_id)
                    OR s.is_host IS DISTINCT FROM (
                         EXISTS (SELECT 1 FROM public.creator_accounts ca WHERE ca.id = s.user_id AND ca.deleted_at IS NULL)
                         OR EXISTS (SELECT 1 FROM public.brand_team_members m
                                     WHERE m.user_id = s.user_id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL))),
    'J-07 the set-based classifier equals admin_account_is_internal and the per-person host test for every profile');
  -- The set-based filter (one failed-filter mask per person) equals the one
  -- predicate for every filter key, as the facets and counts read it.
  PERFORM pg_temp.t4226j_assert(
    NOT EXISTS (
      SELECT 1 FROM public.admin_people_journey_rows() r
       CROSS JOIN (VALUES ('{}'::jsonb), ('{"track":"hosts"}'), ('{"track":"explorers","explorer_stage":"going"}'),
                          ('{"search":"j brand"}'), ('{"track":"hosts","bank_connected":"yes"}'),
                          ('{"country":"zz","city":"lagos"}'), ('{"stopped_step":"none"}')) f(v)
       CROSS JOIN LATERAL (SELECT * FROM unnest(ARRAY['explorer_stage','host_next_step','stopped_step','source',
            'activity_status','country','city','payout_country','bank_connected','brand_id','emails_ok']) k) sk
      WHERE (public.admin_people_row_fails(r, f.v) & ~(CASE sk.k WHEN 'explorer_stage' THEN 2 WHEN 'host_next_step' THEN 4
              WHEN 'stopped_step' THEN 8 WHEN 'source' THEN 16 WHEN 'activity_status' THEN 32 WHEN 'country' THEN 64
              WHEN 'city' THEN 128 WHEN 'payout_country' THEN 256 WHEN 'bank_connected' THEN 512 WHEN 'brand_id' THEN 2048
              ELSE 4096 END) = 0) IS DISTINCT FROM public.admin_people_row_matches(r, f.v, sk.k)),
    'J-08 the failed-filter mask and the skip-one predicate agree for every key');

  ------------------------------------------------------------------------------
  -- Read the journey as the admin.
  ------------------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.t4226j_as(v_admin);

  -- J-03 Explorer stages.
  FOR v_r IN
    SELECT * FROM (VALUES
      (v_e_onb, 'onboarded'), (v_e_exp, 'exploring'), (v_e_con, 'connected'),
      (v_e_go, 'going'), (v_e_reg, 'regular'), (v_e_sign, 'signing_up')) x(uid, stage)
  LOOP
    PERFORM pg_temp.t4226j_assert(
      (SELECT f.explorer_stage FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_r.uid) = v_r.stage,
      'J-03 Explorer stage ' || v_r.stage);
  END LOOP;
  PERFORM pg_temp.t4226j_assert(
    (SELECT f.explorer_stopped_step = 3 AND f.explorer_stopped_step_key = 'interests_v2' AND f.person_kind = 'signing_up'
       FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_e_sign),
    'J-03 signing up says the furthest step reached');
  PERFORM pg_temp.t4226j_assert(
    (SELECT f.explorer_stage = 'signing_up' AND f.explorer_stopped_step IS NULL FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_e_nostep)
    AND EXISTS (SELECT 1 FROM public.admin_people_filter('{"track":"signing_up","stopped_step":"none"}'::jsonb) f WHERE f.user_id = v_e_nostep)
    AND (SELECT (o ->> 'count')::int FROM jsonb_array_elements(public.admin_people_facets('{"track":"signing_up"}'::jsonb) #> '{facets,stopped_step}') o
          WHERE o ->> 'value' = 'none') >= 1,
    'J-03 a sign-up with no recorded step has no stopped step, matches stopped_step=none and is counted in the facet');
  PERFORM pg_temp.t4226j_assert(
    (SELECT abs(extract(epoch FROM (public.admin_person_journey('u:' || v_e_onb) #>> '{person,joined_at}')::timestamptz - (m ->> 'at')::timestamptz)) < 1
       FROM jsonb_array_elements(public.admin_person_journey('u:' || v_e_onb) -> 'milestones') m WHERE m ->> 'kind' = 'signed_up'),
    'J-03 Joined and the Signed up milestone are the same date (the auth sign-up)');
  PERFORM pg_temp.t4226j_assert(
    (SELECT f.ticket_count = 1 AND f.rsvp_count = 0 FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_e_go),
    'J-03 going: one ticket');
  PERFORM pg_temp.t4226j_assert(
    (SELECT f.ticket_count = 1 AND f.experience_count = 1 AND f.rsvp_count = 1 FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_e_reg),
    'J-03 regular: ticket, experience and RSVP counted separately');
  PERFORM pg_temp.t4226j_assert(
    (SELECT count(*) FROM public.admin_people_filter('{"track":"explorers","explorer_stage":"going"}'::jsonb) f
      WHERE f.user_id IN (v_e_onb, v_e_exp, v_e_con, v_e_go, v_e_reg, v_e_sign)) = 1,
    'J-03 the stage filter narrows to that stage');

  -- J-04 Host checklist.
  FOR v_r IN
    SELECT * FROM (VALUES
      (v_h1, 'create_brand'), (v_h2, 'set_payout_country'), (v_h3, 'draft_offering'), (v_h4, 'publish'),
      (v_h5, 'connect_bank'), (v_h6, 'first_sale'), (v_h7, 'repeat_sale'), (v_h8, 'repeat_seller'),
      (v_team, 'team_member')) x(uid, step)
  LOOP
    PERFORM pg_temp.t4226j_assert(
      (SELECT f.host_next_step FROM public.admin_people_filter('{"track":"hosts"}'::jsonb) f WHERE f.user_id = v_r.uid) = v_r.step,
      'J-04 Host next step ' || v_r.step);
  END LOOP;
  PERFORM pg_temp.t4226j_assert(
    (SELECT f.explorer_stage IS NULL AND f.host_checklist IS NOT NULL
       AND jsonb_array_length(f.host_checklist -> 'items') = 8
       AND f.payout_countries = ARRAY['NG'] AND f.bank_connected AND f.brand_count = 1
       FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_h6),
    'J-04 a host-only person has a checklist and no Explorer stage');
  PERFORM pg_temp.t4226j_assert(
    (SELECT f.host_checklist -> 'team_brands' -> 0 ->> 'name' = 'J Brand 2' FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_team),
    'J-04 a team member names their brand');
  PERFORM pg_temp.t4226j_assert(
    (SELECT f.host_checklist IS NULL AND f.host_next_step IS NULL FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_e_go),
    'J-04 a non-host has no checklist');
  PERFORM pg_temp.t4226j_assert(
    (SELECT f.brand_setup_furthest_step = 2 FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_h1),
    'J-04 the brand setup step reaches the directory');

  -- J-05 Source precedence.
  SELECT f.source, f.source_confidence INTO v_r FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_e_onb;
  PERFORM pg_temp.t4226j_assert(v_r.source = 'friend_invite' AND v_r.source_confidence = 'known', 'J-05 a recorded signup source is known');
  SELECT f.source, f.source_confidence, f.source_detail INTO v_r FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_e_src2;
  PERFORM pg_temp.t4226j_assert(v_r.source = 'web_ticket_first' AND v_r.source_confidence = 'inferred',
    'J-05 a web ticket before sign-up (strong evidence) outranks AppsFlyer non-organic install data (campaign evidence)');
  SELECT f.source, f.source_confidence INTO v_r FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_e_src3;
  PERFORM pg_temp.t4226j_assert(v_r.source = 'web_ticket_first' AND v_r.source_confidence = 'inferred',
    'J-05 a web ticket before sign-up is inferred');
  SELECT f.source, f.source_confidence INTO v_r FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_e_con;
  PERFORM pg_temp.t4226j_assert(v_r.source = 'unknown' AND v_r.source_confidence = 'unknown', 'J-05 nothing known stays unknown');

  -- J-06 Country in any case.
  SELECT count(*) INTO v_n FROM public.admin_people_filter('{"country":"ZZ"}'::jsonb) f WHERE f.user_id IN (v_e_onb, v_e_exp);
  SELECT count(*) INTO v_m FROM public.admin_people_filter('{"country":"zz"}'::jsonb) f WHERE f.user_id IN (v_e_onb, v_e_exp);
  PERFORM pg_temp.t4226j_assert(v_n = 2 AND v_m = 2, 'J-06 country matches in any case');
  PERFORM pg_temp.t4226j_assert(
    (SELECT f.country = 'ZZ' AND f.country_source = 'profile' FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_e_onb),
    'J-06 country is upper-cased and says its source');
  v_facets := public.admin_people_facets('{"track":"explorers"}'::jsonb);
  PERFORM pg_temp.t4226j_assert(
    EXISTS (SELECT 1 FROM jsonb_array_elements(v_facets #> '{facets,country}') o WHERE o ->> 'value' = 'ZZ' AND (o ->> 'count')::int >= 2)
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_facets #> '{facets,country}') o WHERE o ->> 'value' = 'zz'),
    'J-06 the facet offers the country once, upper-case');
  PERFORM pg_temp.t4226j_assert(
    (SELECT count(*) FROM public.admin_people_filter('{"track":"hosts","payout_country":"ng"}'::jsonb) f WHERE f.user_id = v_h6) = 1,
    'J-06 payout country matches in any case');

  -- J-07 Staff/test and seed.
  PERFORM pg_temp.t4226j_assert(
    NOT EXISTS (SELECT 1 FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id = v_e_test)
    AND NOT EXISTS (SELECT 1 FROM public.admin_people_filter('{"track":"explorers"}'::jsonb) f WHERE f.user_id = v_e_test)
    AND EXISTS (SELECT 1 FROM public.admin_people_filter('{"track":"internal"}'::jsonb) f WHERE f.user_id = v_e_test AND f.person_kind = 'internal'),
    'J-07 staff/test is only on the internal track');
  PERFORM pg_temp.t4226j_assert(
    NOT EXISTS (SELECT 1 FROM public.admin_people_filter('{"track":"internal"}'::jsonb) f WHERE f.user_id IN (v_e_seed, v_admin))
    AND NOT EXISTS (SELECT 1 FROM public.admin_people_filter('{}'::jsonb) f WHERE f.user_id IN (v_e_seed, v_admin)),
    'J-07 seed profiles are nowhere');
  PERFORM pg_temp.t4226j_assert(
    NOT (SELECT f.emails_ok FROM public.admin_people_filter('{"track":"internal"}'::jsonb) f WHERE f.user_id = v_e_test),
    'J-07 staff/test is never Emails OK');

  -- J-08 Facet counts equal filter counts, for every option of every key,
  -- on every track; and filter_counts equals the rows the filter returns.
  FOREACH v_track IN ARRAY ARRAY['explorers', 'hosts', 'both', 'signing_up', 'no_account', 'internal', ''] LOOP
    v_f := CASE WHEN v_track = '' THEN '{}'::jsonb ELSE jsonb_build_object('track', v_track) END;
    v_facets := public.admin_people_facets(v_f);
    SELECT count(*) INTO v_n FROM public.admin_people_filter(v_f);
    PERFORM pg_temp.t4226j_assert((v_facets ->> 'total')::bigint = v_n, 'J-08 facet total = filter count, track ' || v_track);
    FOR v_key, v_opt IN
      SELECT fk.key, o FROM jsonb_each(v_facets -> 'facets') fk CROSS JOIN LATERAL jsonb_array_elements(fk.value) o
    LOOP
      PERFORM pg_temp.t4226j_assert((v_opt ->> 'count')::int > 0, 'J-08 no zero option ' || v_key);
      SELECT count(*) INTO v_n FROM public.admin_people_filter(v_f || jsonb_build_object(v_key, v_opt ->> 'value'));
      IF v_n <> (v_opt ->> 'count')::bigint THEN
        RAISE EXCEPTION 'issue #4226 people journey FAIL: J-08 facet % = % says %, filter gives %', v_key, v_opt ->> 'value', v_opt ->> 'count', v_n;
      END IF;
      v_checked := v_checked + 1;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.t4226j_assert(v_checked >= 20, 'J-08 facet options checked: ' || v_checked);
  v_j := public.admin_people_filter_counts(jsonb_build_object(
    'nobank', '{"track":"hosts","host_next_step":"connect_bank"}'::jsonb,
    'stuck', '{"track":"signing_up"}'::jsonb,
    'all', '{}'::jsonb));
  PERFORM pg_temp.t4226j_assert(
    (v_j ->> 'nobank')::bigint = (SELECT count(*) FROM public.admin_people_filter('{"track":"hosts","host_next_step":"connect_bank"}'::jsonb))
    AND (v_j ->> 'stuck')::bigint = (SELECT count(*) FROM public.admin_people_filter('{"track":"signing_up"}'::jsonb))
    AND (v_j ->> 'all')::bigint = (SELECT count(*) FROM public.admin_people_filter('{}'::jsonb)),
    'J-08 filter_counts equals the rows the filter returns (People = Email)');
  v_raised := false;
  BEGIN
    PERFORM count(*) FROM public.admin_people_filter('{"colour":"red"}'::jsonb);
  EXCEPTION WHEN others THEN v_raised := SQLERRM = 'invalid_filter:colour';
  END;
  PERFORM pg_temp.t4226j_assert(v_raised, 'J-08 an unknown filter key raises');

  -- J-09 Journey timeline.
  v_j := public.admin_person_journey('u:' || v_e_reg);
  PERFORM pg_temp.t4226j_assert(
    (v_j #>> '{person,explorer_stage}') = 'regular'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_j -> 'milestones') m WHERE m ->> 'kind' = 'experience')
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_j -> 'milestones') m WHERE m ->> 'kind' = 'rsvp')
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_j -> 'milestones') m WHERE m ->> 'kind' = 'signed_up'),
    'J-09 milestones list sign-up, an RSVP and an experience');
  v_j := public.admin_person_journey('u:' || v_h8);
  PERFORM pg_temp.t4226j_assert(
    EXISTS (SELECT 1 FROM jsonb_array_elements(v_j -> 'milestones') m WHERE m ->> 'kind' = 'brand_created')
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_j -> 'milestones') m WHERE m ->> 'kind' = 'first_sale'),
    'J-09 host milestones: brand created, first sale');
  PERFORM pg_temp.t4226j_assert(
    (v_j #>> '{brands,0,name}') = 'J Brand 8' AND (v_j #>> '{brands,0,payout_country}') = 'GB'
    AND (v_j #>> '{brands,0,published}')::int = 2 AND (v_j #>> '{brands,0,paystack_bank}')::boolean
    AND (v_j #>> '{brands,0,first_sale_at}') IS NOT NULL AND (v_j #>> '{counts,friends}') IS NOT NULL,
    'J-09 each owned brand carries payout country, bank, published count and first sale');
  v_raised := false;
  BEGIN
    PERFORM public.admin_person_journey('e:nobody-t4226j@mingla-fixture.org');
  EXCEPTION WHEN others THEN v_raised := SQLERRM = 'not_found';
  END;
  PERFORM pg_temp.t4226j_assert(v_raised, 'J-09 an unknown person raises not_found');

  -- J-10 One owner.
  PERFORM pg_temp.t4226j_assert(
    (public.admin_get_person(v_team) #>> '{person,segment}') = 'host'
    AND (public.admin_get_person(v_team) #>> '{person,is_host}')::boolean
    AND (public.admin_get_person(v_e_sign) #>> '{person,segment}') = 'incomplete'
    AND NOT (public.admin_get_person(v_e_sign) #>> '{person,is_host}')::boolean,
    'J-10 the full record uses the People classifier');
  PERFORM pg_temp.t4226j_assert(
    (SELECT o ->> 'segment' FROM jsonb_array_elements(public.admin_people_lookup(ARRAY[v_e_go], NULL)) o) = 'explorer'
    AND jsonb_array_length(public.admin_people_lookup(NULL, 't4226j-h')) BETWEEN 1 AND 8,
    'J-10 the Support desk lookup uses the People classifier');

  -- A signed-in non-admin is refused.
  PERFORM pg_temp.t4226j_as(v_e_go);
  v_raised := false;
  BEGIN
    PERFORM public.admin_people_facets('{}'::jsonb);
  EXCEPTION WHEN others THEN v_raised := SQLERRM = 'not_authorized';
  END;
  PERFORM pg_temp.t4226j_assert(v_raised, 'J-09 a non-admin cannot read facets');
  v_raised := false;
  BEGIN
    PERFORM public.admin_person_journey('u:' || v_e_go);
  EXCEPTION WHEN others THEN v_raised := SQLERRM = 'not_authorized';
  END;
  PERFORM pg_temp.t4226j_assert(v_raised, 'J-09 a non-admin cannot read a journey');
  RESET ROLE;
END
$j02$;
ROLLBACK;
