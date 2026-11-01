\set ON_ERROR_STOP on

-- Issue #4226 — ticket buyers in Mingla Admin. Run after the full migration
-- chain on PostgreSQL 17.
--
--   C-01  admin_people_directory() is admin-only (definer + guard; anon cannot
--         run it; a signed-in non-admin is refused; the service role used by
--         admin-send-email may read it). The helpers are not callable by
--         signed-in users.
--   C-02  A buyer with no account appears once, as "ticket buyer, no app",
--         with event city, country from the phone, tickets, spend and consent,
--         and is listed on the People "Ticket buyers, no app" tab.
--   C-03  A buyer who later signs up (email in other case and spacing) appears
--         ONCE: folded into their account row, keeping app status incomplete
--         AND listed on the ticket-buyer tab.
--   C-04  A buyer of a brand whose owner is staff (admin_brand_is_internal is
--         true) is still a real ticket buyer.
--   C-05  A test-style buyer email and a staff account are left out of the
--         ticket-buyer segment and its list.
--   C-06  A ticket holder / transferee (holder_email on someone else's order)
--         is a ticket person with tickets but no orders.
--   C-07  A buyer who finished Explorer onboarding is a ticket holder but not
--         in the no-app segment; Explorer rows on People show ticket facts.
--   C-08  Marketing consent: checkout opt-out is 'no'; an unsubscribe beats an
--         opt-in ('unsubscribed'); the latest consent record wins.
--   C-09  The Explorer audience (app status explorer or both, not staff/test)
--         no longer includes an incomplete sign-up or a staff account.
--   C-10  admin_country_from_e164: NG, US, GB, GH, ZA, KE; unknown is NULL.
--   C-11  Counts: the ticket-buyer count moves by exactly the fixtures; the
--         account 'people' count does not include no-account buyers.
--   C-12  Data room: buyers, buyers with no app, no account, and buyer→app
--         conversion move by exactly the fixtures.
-- MINGLA-INVARIANT: I-4226-TICKET-PEOPLE-ONE-LIST | issue #4226 | People, the Email audiences and the Data room read one admin-only list of people (profiles plus ticket people with no account, one row per normalised email); the ticket-buyer segment excludes staff and test only by account or email, never by brand.

CREATE OR REPLACE FUNCTION pg_temp.t4226_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4226 FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

BEGIN;
DO $c01$
DECLARE
  v_fn text;
BEGIN
  v_fn := 'public.admin_people_directory()';
  PERFORM pg_temp.t4226_assert(to_regprocedure(v_fn) IS NOT NULL, 'C-01 exists ' || v_fn);
  PERFORM pg_temp.t4226_assert(NOT has_function_privilege('anon', v_fn, 'EXECUTE'), 'C-01 anon cannot run ' || v_fn);
  PERFORM pg_temp.t4226_assert(has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'C-01 signed-in may call ' || v_fn);
  PERFORM pg_temp.t4226_assert(has_function_privilege('service_role', v_fn, 'EXECUTE'), 'C-01 service role may call ' || v_fn);
  PERFORM pg_temp.t4226_assert(
    (SELECT p.prosecdef AND p.prosrc ~ 'is_admin_user\(\)' FROM pg_proc p WHERE p.oid = v_fn::regprocedure),
    'C-01 definer + admin guard ' || v_fn);
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_people_directory_rows()',
    'public.admin_people_app_status()',
    'public.admin_country_from_e164(text)'
  ] LOOP
    PERFORM pg_temp.t4226_assert(NOT has_function_privilege('authenticated', v_fn, 'EXECUTE'),
      'C-01 helper not callable by signed-in users ' || v_fn);
  END LOOP;
END
$c01$;
ROLLBACK;

BEGIN;
DO $c02$
DECLARE
  v_admin      constant uuid := '42260000-0000-4000-a000-000000000001';
  v_outsider   constant uuid := '42260000-0000-4000-a000-000000000002';
  v_later      constant uuid := '42260000-0000-4000-a000-000000000010';
  v_explorer   constant uuid := '42260000-0000-4000-a000-000000000011';
  v_staff      constant uuid := '42260000-0000-4000-a000-000000000012';
  v_incomplete constant uuid := '42260000-0000-4000-a000-000000000013';
  v_host       constant uuid := '42260000-0000-4000-a000-000000000014';
  v_brand      constant uuid := '42260000-0000-4000-a000-000000000100';
  v_brand_st   constant uuid := '42260000-0000-4000-a000-000000000101';
  v_event      constant uuid := '42260000-0000-4000-a000-000000000200';
  v_event_st   constant uuid := '42260000-0000-4000-a000-000000000201';
  v_type       constant uuid := '42260000-0000-4000-a000-000000000300';
  v_type_st    constant uuid := '42260000-0000-4000-a000-000000000301';
  v_o_noacct   constant uuid := '42260000-0000-4000-a000-000000000400';
  v_o_later    constant uuid := '42260000-0000-4000-a000-000000000401';
  v_o_wga      constant uuid := '42260000-0000-4000-a000-000000000402';
  v_o_test     constant uuid := '42260000-0000-4000-a000-000000000403';
  v_o_gift     constant uuid := '42260000-0000-4000-a000-000000000404';
  v_o_explorer constant uuid := '42260000-0000-4000-a000-000000000405';
  v_o_optout   constant uuid := '42260000-0000-4000-a000-000000000406';
  v_o_unsub    constant uuid := '42260000-0000-4000-a000-000000000407';
  v_o_staff    constant uuid := '42260000-0000-4000-a000-000000000408';
  v_seg_before jsonb;
  v_seg_after  jsonb;
  v_dr_before  jsonb;
  v_dr_after   jsonb;
  v_row        record;
  v_list       jsonb;
  v_state      text;
  v_n          bigint;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_admin,      't4226-admin@mingla-fixture.org'),
    (v_outsider,   't4226-outsider@mingla-fixture.org'),
    (v_later,      't4226-later@mingla-fixture.org'),
    (v_explorer,   't4226-explorer@mingla-fixture.org'),
    (v_staff,      't4226-staff@usemingla.com'),
    (v_incomplete, 't4226-incomplete@mingla-fixture.org'),
    (v_host,       't4226-host@mingla-fixture.org');
  INSERT INTO public.admin_users(email, role, status) VALUES ('t4226-admin@mingla-fixture.org', 'admin', 'active');

  -- Counts before any fixture person exists (other suites may have left rows).
  v_dr_before := public.analytics_dr_users();
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_seg_before := public.admin_people_segments();
  RESET ROLE;

  INSERT INTO public.profiles(id, email, display_name, has_completed_onboarding, is_seed, country, created_at) VALUES
    (v_admin,      't4226-admin@mingla-fixture.org',      'T Admin',      true,  true,  NULL, now()),
    (v_outsider,   't4226-outsider@mingla-fixture.org',   'T Outsider',   true,  true,  NULL, now()),
    -- Signs up after buying on the web, never finishes Explorer onboarding.
    (v_later,      't4226-later@mingla-fixture.org',      'T Later',      false, false, NULL, now()),
    (v_explorer,   't4226-explorer@mingla-fixture.org',   'T Explorer',   true,  false, 'GB', now() - interval '90 days'),
    (v_staff,      't4226-staff@usemingla.com',           'T Staff',      true,  false, NULL, now() - interval '90 days'),
    (v_incomplete, 't4226-incomplete@mingla-fixture.org', 'T Incomplete', false, false, NULL, now() - interval '90 days'),
    (v_host,       't4226-host@mingla-fixture.org',       'T Host',       false, false, 'NG', now() - interval '90 days');
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_staff, 't4226-staff@usemingla.com'), (v_host, 't4226-host@mingla-fixture.org');

  -- A real brand, and a brand owned by the staff account (reads as internal).
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
    (v_brand,    v_host,     'T4226 Real Brand',  't4226-real-' || v_brand,  'NGN'),
    (v_brand_st, v_staff,    'T4226 We Go Again', 't4226-wga-' || v_brand_st, 'NGN');
  PERFORM pg_temp.t4226_assert(public.admin_brand_is_internal(v_brand_st), 'C-04 fixture: the staff-owned brand reads as internal');
  INSERT INTO public.events(id, brand_id, title, slug, status, currency, created_by, city) VALUES
    (v_event,    v_brand,    'T4226 Night',      't4226-night-' || v_event,   'draft', 'NGN', v_host,     'Lagos'),
    (v_event_st, v_brand_st, 'T4226 Exhibition', 't4226-exh-' || v_event_st,  'draft', 'NGN', v_staff,    'Abuja');
  INSERT INTO public.ticket_types(id, event_id, name) VALUES
    (v_type, v_event, 'T4226 General'), (v_type_st, v_event_st, 'T4226 Entry');

  INSERT INTO public.orders(id, event_id, buyer_email, buyer_name, buyer_phone_e164, total_cents, buyer_total_cents,
      net_subtotal_cents, currency, payment_status, payment_method, source, created_at, confirmed_at,
      list_subtotal_cents, discount_cents, buyer_fees_cents, tax_cents, pricing_source, metadata, buyer_user_id)
  VALUES
    (v_o_noacct,   v_event,    't4226-noacct@mingla-fixture.org', 'Ada NoAccount', '+2348030000001', 104500, 104500, 100000,
      'NGN', 'paid', 'online_card', 'legacy', now() - interval '20 days', now() - interval '20 days',
      100000, 0, 4500, 0, 'computed_at_checkout', '{"marketing_opt_in": true}', NULL),
    -- Bought before the account existed; email in another case with spaces.
    (v_o_later,    v_event,    '  T4226-Later@Mingla-Fixture.org ', 'Tolu Later', '+12025550101', 52250, 52250, 50000,
      'NGN', 'paid', 'online_card', 'legacy', now() - interval '10 days', now() - interval '10 days',
      50000, 0, 2250, 0, 'computed_at_checkout', '{"marketing_opt_in": true}', NULL),
    (v_o_wga,      v_event_st, 't4226-wga-buyer@mingla-fixture.org', 'Wale Exhibition', '+2348030000003', 0, 0, 0,
      NULL, 'paid', 'online_card', 'legacy', now() - interval '5 days', now() - interval '5 days',
      0, 0, 0, 0, 'computed_at_checkout', '{"marketing_opt_in": true}', NULL),
    (v_o_test,     v_event,    'test.buyer@mingla-fixture.org', 'Test Buyer', '+2348030000004', 0, 0, 0,
      NULL, 'paid', 'online_card', 'legacy', now() - interval '5 days', now() - interval '5 days',
      0, 0, 0, 0, 'computed_at_checkout', '{"marketing_opt_in": true}', NULL),
    (v_o_gift,     v_event,    't4226-giver@mingla-fixture.org', 'Gina Giver', '+447700900001', 0, 0, 0,
      NULL, 'paid', 'online_card', 'legacy', now() - interval '4 days', now() - interval '4 days',
      0, 0, 0, 0, 'computed_at_checkout', '{"marketing_opt_in": true}', NULL),
    (v_o_explorer, v_event,    't4226-explorer@mingla-fixture.org', 'T Explorer', '+447700900002', 0, 0, 0,
      NULL, 'paid', 'online_card', 'legacy', now() - interval '3 days', now() - interval '3 days',
      0, 0, 0, 0, 'computed_at_checkout', '{"marketing_opt_in": true}', v_explorer),
    (v_o_optout,   v_event,    't4226-optout@mingla-fixture.org', 'Obi OptOut', '+233200000001', 0, 0, 0,
      NULL, 'paid', 'online_card', 'legacy', now() - interval '3 days', now() - interval '3 days',
      0, 0, 0, 0, 'computed_at_checkout', '{"marketing_opt_in": false}', NULL),
    (v_o_unsub,    v_event,    't4226-unsub@mingla-fixture.org', 'Uche Unsub', '+27820000001', 0, 0, 0,
      NULL, 'paid', 'online_card', 'legacy', now() - interval '3 days', now() - interval '3 days',
      0, 0, 0, 0, 'computed_at_checkout', '{"marketing_opt_in": true}', NULL),
    (v_o_staff,    v_event,    't4226-staff@usemingla.com', 'T Staff', '+254700000001', 0, 0, 0,
      NULL, 'paid', 'online_card', 'legacy', now() - interval '3 days', now() - interval '3 days',
      0, 0, 0, 0, 'computed_at_checkout', '{"marketing_opt_in": true}', v_staff);

  INSERT INTO public.tickets(order_id, ticket_type_id, event_id, qr_code, status, holder_email) VALUES
    (v_o_noacct,   v_type,    v_event,    't4226-qr-1', 'valid', NULL),
    (v_o_noacct,   v_type,    v_event,    't4226-qr-2', 'valid', NULL),
    (v_o_later,    v_type,    v_event,    't4226-qr-3', 'valid', NULL),
    (v_o_wga,      v_type_st, v_event_st, 't4226-qr-4', 'valid', NULL),
    (v_o_test,     v_type,    v_event,    't4226-qr-5', 'valid', NULL),
    -- Given to a friend: the holder is someone else.
    (v_o_gift,     v_type,    v_event,    't4226-qr-6', 'valid', 't4226-holder@mingla-fixture.org'),
    (v_o_explorer, v_type,    v_event,    't4226-qr-7', 'valid', NULL),
    (v_o_optout,   v_type,    v_event,    't4226-qr-8', 'valid', NULL),
    (v_o_unsub,    v_type,    v_event,    't4226-qr-9', 'valid', NULL),
    (v_o_staff,    v_type,    v_event,    't4226-qr-10', 'valid', NULL),
    -- A void ticket names a holder who must not appear.
    (v_o_gift,     v_type,    v_event,    't4226-qr-11', 'void', 't4226-void@mingla-fixture.org');

  INSERT INTO public.marketing_unsubscribes(contact_email, channel, scope, reason)
  VALUES ('t4226-unsub@mingla-fixture.org', 'email', 'global', 'one_click_unsubscribe_link');

  -- ── C-01 guard ─────────────────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  BEGIN PERFORM count(*) FROM public.admin_people_directory(); v_state := 'ran';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
  PERFORM pg_temp.t4226_assert(v_state = 'not_authorized', 'C-01 directory refused for a signed-in non-admin');
  BEGIN PERFORM public.admin_list_people('ticket_buyer_no_app'); v_state := 'ran';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
  PERFORM pg_temp.t4226_assert(v_state = 'not_authorized', 'C-01 ticket-buyer list refused for a signed-in non-admin');
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  SELECT count(*) INTO v_n FROM public.admin_people_directory() d WHERE d.email LIKE 't4226-%' OR d.email LIKE 'test.buyer@%';
  PERFORM pg_temp.t4226_assert(v_n > 0, 'C-01 an admin reads the directory');
  RESET ROLE;
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT count(*) INTO v_n FROM public.admin_people_directory() d WHERE d.email LIKE 't4226-%';
  PERFORM pg_temp.t4226_assert(v_n > 0, 'C-01 the service role (admin-send-email) reads the directory');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- ── C-02 a buyer with no account ───────────────────────────────────────────
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.email = 't4226-noacct@mingla-fixture.org';
  PERFORM pg_temp.t4226_assert(v_row.person_key IS NOT NULL, 'C-02 the no-account buyer is a person');
  PERFORM pg_temp.t4226_assert(v_row.user_id IS NULL AND v_row.app_status = 'ticket_buyer_no_app'
    AND v_row.segment = 'ticket_buyer_no_app', 'C-02 app status is "ticket buyer, no app"');
  PERFORM pg_temp.t4226_assert(v_row.in_ticket_buyer_segment, 'C-02 in the ticket-buyer segment');
  PERFORM pg_temp.t4226_assert(v_row.name = 'Ada NoAccount', 'C-02 name from the order');
  PERFORM pg_temp.t4226_assert(v_row.country = 'NG', 'C-02 country from the +234 phone');
  PERFORM pg_temp.t4226_assert(v_row.last_event_city = 'Lagos', 'C-02 event city');
  PERFORM pg_temp.t4226_assert(v_row.tickets_count = 2 AND v_row.orders_count = 1, 'C-02 two tickets on one order');
  PERFORM pg_temp.t4226_assert(v_row.spent = '{"NGN": 104500}'::jsonb AND v_row.last_spent_cents = 104500
    AND v_row.last_currency = 'NGN', 'C-02 spend per currency');
  PERFORM pg_temp.t4226_assert(v_row.marketing_consent = 'yes', 'C-02 checkout opt-in is consent');
  PERFORM pg_temp.t4226_assert(v_row.brand_ids = ARRAY[v_brand], 'C-02 brand bought from');
  SELECT count(*) INTO v_n FROM public.admin_people_directory_rows() d WHERE d.email = 't4226-noacct@mingla-fixture.org';
  PERFORM pg_temp.t4226_assert(v_n = 1, 'C-02 exactly one row');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_list := public.admin_list_people('ticket_buyer_no_app', 't4226-', NULL, NULL, 100, 0, 'joined_desc');
  PERFORM pg_temp.t4226_assert(
    EXISTS (SELECT 1 FROM jsonb_array_elements(v_list -> 'rows') r
             WHERE r ->> 'email' = 't4226-noacct@mingla-fixture.org' AND r ->> 'id' IS NULL
               AND r ->> 'event_city' = 'Lagos' AND r ->> 'country' = 'NG' AND (r ->> 'tickets')::int = 2
               AND r ->> 'marketing_consent' = 'yes' AND r -> 'spent' = '{"NGN": 104500}'::jsonb),
    'C-02 listed on the People ticket-buyer tab with its facts');
  v_list := public.admin_list_people('ticket_buyer_no_app', 't4226-noacct', 'NG', NULL, 100, 0, NULL);
  PERFORM pg_temp.t4226_assert((v_list ->> 'total')::int = 1, 'C-02 country filter keeps them');
  v_list := public.admin_list_people('ticket_buyer_no_app', 't4226-noacct', 'US', NULL, 100, 0, NULL);
  PERFORM pg_temp.t4226_assert((v_list ->> 'total')::int = 0, 'C-02 another country filters them out');
  RESET ROLE;

  -- ── C-03 a buyer who later signed up appears once ─────────────────────────
  SELECT count(*) INTO v_n FROM public.admin_people_directory_rows() d WHERE d.email = 't4226-later@mingla-fixture.org';
  PERFORM pg_temp.t4226_assert(v_n = 1, 'C-03 a buyer who later signed up is one row, not two');
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.email = 't4226-later@mingla-fixture.org';
  PERFORM pg_temp.t4226_assert(v_row.user_id = v_later AND v_row.app_status = 'incomplete'
    AND v_row.segment = 'incomplete', 'C-03 the row is their account and keeps app status incomplete');
  PERFORM pg_temp.t4226_assert(v_row.is_ticket_holder AND v_row.in_ticket_buyer_segment AND v_row.tickets_count = 1,
    'C-03 and carries the ticket bought before the account');
  PERFORM pg_temp.t4226_assert(v_row.country = 'US', 'C-03 no profile country: country from the +1 phone');
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM pg_temp.t4226_assert(
    EXISTS (SELECT 1 FROM jsonb_array_elements(
              public.admin_list_people('ticket_buyer_no_app', 't4226-later', NULL, NULL, 10, 0, NULL) -> 'rows') r
             WHERE (r ->> 'id')::uuid = v_later AND r ->> 'app_status' = 'incomplete'),
    'C-03 listed on the ticket-buyer tab with their account id');
  PERFORM pg_temp.t4226_assert(
    EXISTS (SELECT 1 FROM jsonb_array_elements(
              public.admin_list_people('incomplete', 't4226-later', NULL, NULL, 10, 0, NULL) -> 'rows') r
             WHERE (r ->> 'id')::uuid = v_later AND (r ->> 'in_ticket_buyer_segment')::boolean),
    'C-03 and still on "Didn''t finish sign-up", marked as a ticket buyer');
  RESET ROLE;

  -- ── C-04 brand-internal buyer still counts ────────────────────────────────
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.email = 't4226-wga-buyer@mingla-fixture.org';
  PERFORM pg_temp.t4226_assert(v_row.in_ticket_buyer_segment AND NOT v_row.is_internal,
    'C-04 a buyer of a staff-owned brand is a real ticket buyer');
  PERFORM pg_temp.t4226_assert(v_row.last_event_city = 'Abuja' AND v_row.spent = '{}'::jsonb,
    'C-04 free ticket: no spend, event city kept');

  -- ── C-05 test email and staff account left out ────────────────────────────
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.email = 'test.buyer@mingla-fixture.org';
  PERFORM pg_temp.t4226_assert(v_row.is_internal AND v_row.segment = 'internal' AND NOT v_row.in_ticket_buyer_segment,
    'C-05 a test-style buyer email is staff/test, not a ticket buyer');
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.user_id = v_staff;
  PERFORM pg_temp.t4226_assert(v_row.is_internal AND v_row.is_ticket_holder AND NOT v_row.in_ticket_buyer_segment,
    'C-05 a staff account with a ticket is not a ticket buyer');
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_list := public.admin_list_people('ticket_buyer_no_app', 'test.buyer', NULL, NULL, 10, 0, NULL);
  PERFORM pg_temp.t4226_assert((v_list ->> 'total')::int = 0, 'C-05 the test buyer is not listed');
  RESET ROLE;

  -- ── C-06 holder / transferee ──────────────────────────────────────────────
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.email = 't4226-holder@mingla-fixture.org';
  PERFORM pg_temp.t4226_assert(v_row.in_ticket_buyer_segment AND v_row.tickets_count = 1 AND v_row.orders_count = 0,
    'C-06 the holder of a gifted ticket is a ticket person with no orders');
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.email = 't4226-giver@mingla-fixture.org';
  PERFORM pg_temp.t4226_assert(v_row.in_ticket_buyer_segment AND v_row.tickets_count = 0 AND v_row.orders_count = 1,
    'C-06 the giver bought one order and holds no ticket');
  SELECT count(*) INTO v_n FROM public.admin_people_directory_rows() d WHERE d.email = 't4226-void@mingla-fixture.org';
  PERFORM pg_temp.t4226_assert(v_n = 0, 'C-06 a void ticket''s holder is nobody');

  -- ── C-07 an Explorer who bought ───────────────────────────────────────────
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.user_id = v_explorer;
  PERFORM pg_temp.t4226_assert(v_row.app_status = 'explorer', 'C-07 the Explorer keeps their app status');
  PERFORM pg_temp.t4226_assert(v_row.is_ticket_holder AND NOT v_row.in_ticket_buyer_segment,
    'C-07 a ticket holder with the Explorer app is not in the no-app segment');
  PERFORM pg_temp.t4226_assert(v_row.country = 'GB', 'C-07 profile country wins');

  -- ── C-08 consent ───────────────────────────────────────────────────────────
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.email = 't4226-optout@mingla-fixture.org';
  PERFORM pg_temp.t4226_assert(v_row.marketing_consent = 'no', 'C-08 checkout opt-out is no consent');
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.email = 't4226-unsub@mingla-fixture.org';
  PERFORM pg_temp.t4226_assert(v_row.marketing_consent = 'unsubscribed', 'C-08 an unsubscribe beats an opt-in');
  INSERT INTO public.consent_records(contact, channel, scope, action, source, created_at)
  VALUES ('t4226-optout@mingla-fixture.org', 'email', 'marketing', 'granted', 'prefs_ui', now() - interval '1 day');
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.email = 't4226-optout@mingla-fixture.org';
  PERFORM pg_temp.t4226_assert(v_row.marketing_consent = 'yes', 'C-08 a later consent record wins');
  INSERT INTO public.consent_records(contact, channel, scope, action, source, created_at)
  VALUES ('t4226-optout@mingla-fixture.org', 'email', 'marketing', 'revoked', 'prefs_ui', now());
  SELECT * INTO v_row FROM public.admin_people_directory_rows() d WHERE d.email = 't4226-optout@mingla-fixture.org';
  PERFORM pg_temp.t4226_assert(v_row.marketing_consent = 'no', 'C-08 a later revoke wins');
  SELECT count(*) INTO v_n FROM public.admin_people_directory_rows() d
   WHERE d.email LIKE 't4226-%' AND d.in_ticket_buyer_segment AND d.marketing_consent = 'yes';
  -- Agreed: noacct, later, wga, giver. Not: the gift holder (never asked), the
  -- opt-out (revoked) and the unsubscribed buyer.
  PERFORM pg_temp.t4226_assert(v_n = 4,
    'C-08 the marketing audience of fixture ticket buyers is the four who agreed (not the holder, opt-out or unsubscribed)');

  -- ── C-09 Explorer audience ────────────────────────────────────────────────
  PERFORM pg_temp.t4226_assert(
    NOT EXISTS (SELECT 1 FROM public.admin_people_directory_rows() d
                 WHERE d.app_status IN ('explorer', 'both') AND NOT d.is_internal
                   AND d.user_id IN (v_incomplete, v_later, v_staff)),
    'C-09 the Explorer audience leaves out incomplete sign-ups and staff');
  PERFORM pg_temp.t4226_assert(
    EXISTS (SELECT 1 FROM public.admin_people_directory_rows() d
             WHERE d.app_status IN ('explorer', 'both') AND NOT d.is_internal AND d.user_id = v_explorer),
    'C-09 and keeps a real Explorer');

  -- ── C-10 calling codes ────────────────────────────────────────────────────
  PERFORM pg_temp.t4226_assert(public.admin_country_from_e164('+2348031234567') = 'NG', 'C-10 +234 NG');
  PERFORM pg_temp.t4226_assert(public.admin_country_from_e164('+1 (202) 555-0101') = 'US', 'C-10 +1 US');
  PERFORM pg_temp.t4226_assert(public.admin_country_from_e164('+447700900001') = 'GB', 'C-10 +44 GB');
  PERFORM pg_temp.t4226_assert(public.admin_country_from_e164('00233200000001') = 'GH', 'C-10 00233 GH');
  PERFORM pg_temp.t4226_assert(public.admin_country_from_e164('+27820000001') = 'ZA', 'C-10 +27 ZA');
  PERFORM pg_temp.t4226_assert(public.admin_country_from_e164('+254700000001') = 'KE', 'C-10 +254 KE');
  PERFORM pg_temp.t4226_assert(public.admin_country_from_e164('+8613800000000') IS NULL, 'C-10 unknown code is NULL');
  PERFORM pg_temp.t4226_assert(public.admin_country_from_e164('08031234567') IS NULL, 'C-10 a local number is NULL');
  PERFORM pg_temp.t4226_assert(public.admin_country_from_e164(NULL) IS NULL, 'C-10 no phone is NULL');

  -- ── C-11 counts ───────────────────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_seg_after := public.admin_people_segments();
  RESET ROLE;
  -- Ticket buyers with no app: noacct, later, wga, giver, holder, optout, unsub = 7.
  PERFORM pg_temp.t4226_assert(
    (v_seg_after ->> 'ticket_buyer_no_app')::int - (v_seg_before ->> 'ticket_buyer_no_app')::int = 7,
    'C-11 the ticket-buyer count moved by exactly the seven fixtures');
  -- Accounts: later (incomplete), explorer, incomplete, host; staff is internal.
  PERFORM pg_temp.t4226_assert(
    (v_seg_after ->> 'people')::int - (v_seg_before ->> 'people')::int = 4,
    'C-11 "people" counts accounts only, not the no-account buyers');
  PERFORM pg_temp.t4226_assert(
    (v_seg_after ->> 'ticket_people_no_account')::int - (v_seg_before ->> 'ticket_people_no_account')::int = 6,
    'C-11 six real ticket people have no account');
  PERFORM pg_temp.t4226_assert(v_seg_after -> 'countries' ? 'NG' AND v_seg_after -> 'countries' ? 'ZA',
    'C-11 derived countries are offered as filters');

  -- ── C-12 Data room ────────────────────────────────────────────────────────
  v_dr_after := public.analytics_dr_users();
  PERFORM pg_temp.t4226_assert(
    (v_dr_after #>> '{ticket_buyers,buyers}')::int - COALESCE((v_dr_before #>> '{ticket_buyers,buyers}')::int, 0) = 8,
    'C-12 buyers: the seven no-app buyers plus the Explorer');
  PERFORM pg_temp.t4226_assert(
    (v_dr_after #>> '{ticket_buyers,no_app}')::int - COALESCE((v_dr_before #>> '{ticket_buyers,no_app}')::int, 0) = 7,
    'C-12 buyers with no app');
  PERFORM pg_temp.t4226_assert(
    (v_dr_after #>> '{ticket_buyers,with_app}')::int - COALESCE((v_dr_before #>> '{ticket_buyers,with_app}')::int, 0) = 1,
    'C-12 buyers with the app');
  -- Bought before an account: six with none + later (account made after) = 7;
  -- the Explorer's account is older than their ticket. None converted yet.
  PERFORM pg_temp.t4226_assert(
    (v_dr_after #>> '{ticket_buyers,bought_before_account}')::int
      - COALESCE((v_dr_before #>> '{ticket_buyers,bought_before_account}')::int, 0) = 7,
    'C-12 bought on the web before having an account');
  UPDATE public.profiles SET has_completed_onboarding = true WHERE id = v_later;
  v_dr_after := public.analytics_dr_users();
  PERFORM pg_temp.t4226_assert(
    (v_dr_after #>> '{ticket_buyers,converted}')::int - COALESCE((v_dr_before #>> '{ticket_buyers,converted}')::int, 0) = 1,
    'C-12 a web buyer who then finished Explorer onboarding is a conversion');
  PERFORM pg_temp.t4226_assert(
    (v_dr_after #>> '{ticket_buyers,no_app}')::int - COALESCE((v_dr_before #>> '{ticket_buyers,no_app}')::int, 0) = 6,
    'C-12 and leaves the no-app count');
END
$c02$;
ROLLBACK;
