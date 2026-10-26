\set ON_ERROR_STOP on

-- Issue #4130 (Wave 3) — People segments, the staff and test flag, and the
-- brand and offering boards. Run after the full migration chain on PostgreSQL 17.
--
--   C-01  Every new RPC: anon cannot execute; the helpers are not callable by
--         signed-in users at all.
--   C-02  Classification: explorer, host (business account), host (team role),
--         both, incomplete (deleted business account), internal (email rule);
--         seed rows are never people.
--   C-03  Internal accounts are left out of every count: segment counts move by
--         exactly the fixtures, and `people` does not include internal.
--   C-04  The RPCs are admin-only: a signed-in non-admin is refused.
--   C-05  Mark / unmark internal is admin-only, needs a reason, and every
--         change writes admin_audit_log; unmarking overrides the email rule.
--   C-06  Brands: readiness reads Stripe Connect AND Paystack recipients;
--         staff/test and deleted brands are hidden unless asked for.
--   C-07  Offerings: a staff/test brand's offering is hidden unless asked for;
--         one state per row.
-- MINGLA-INVARIANT: I-4130-PEOPLE-SEGMENTS-ADMIN-ONLY | issue #4130 | People segments, brand and offering boards are admin-only aggregates; staff and test accounts are counted only as internal; marking an account internal is admin-only, needs a reason and writes admin_audit_log.

CREATE OR REPLACE FUNCTION pg_temp.w3_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4130 wave 3 FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

-- Ids of the fixture people in one segment's list.
CREATE OR REPLACE FUNCTION pg_temp.w3_ids(p_segment text)
RETURNS uuid[] LANGUAGE sql AS $a$
  SELECT COALESCE(array_agg((r ->> 'id')::uuid), '{}')
    FROM jsonb_array_elements((public.admin_list_people(p_segment, NULL, NULL, NULL, 1000, 0, 'joined_desc')) -> 'rows') r
$a$;

BEGIN;
DO $c01$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_people_segments()',
    'public.admin_list_people(text,text,text,timestamptz,integer,integer,text)',
    'public.admin_get_person_activity(uuid)',
    'public.admin_set_internal_account(uuid,boolean,text)',
    'public.admin_brands_summary()',
    'public.admin_list_brands_board(text,boolean,text,text,integer,integer)',
    'public.admin_offerings_summary()',
    'public.admin_list_offerings_board(text,text,text,uuid,boolean,text,integer,integer)'
  ] LOOP
    PERFORM pg_temp.w3_assert(to_regprocedure(v_fn) IS NOT NULL, 'C-01 exists ' || v_fn);
    PERFORM pg_temp.w3_assert(NOT has_function_privilege('anon', v_fn, 'EXECUTE'), 'C-01 anon cannot run ' || v_fn);
    PERFORM pg_temp.w3_assert(has_function_privilege('authenticated', v_fn, 'EXECUTE'), 'C-01 signed-in may call ' || v_fn);
    PERFORM pg_temp.w3_assert(
      (SELECT p.prosecdef AND p.prosrc ~ 'is_admin_user\(\)' FROM pg_proc p WHERE p.oid = v_fn::regprocedure),
      'C-01 definer + admin guard ' || v_fn);
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_people_classified()',
    'public.admin_account_is_internal(uuid)',
    'public.admin_brand_payment_readiness_w3(uuid)',
    'public.admin_internal_email_rule(text)'
  ] LOOP
    PERFORM pg_temp.w3_assert(NOT has_function_privilege('authenticated', v_fn, 'EXECUTE'),
      'C-01 helper not callable by signed-in users ' || v_fn);
  END LOOP;
  PERFORM pg_temp.w3_assert(
    (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.admin_internal_accounts'::regclass),
    'C-01 admin_internal_accounts has RLS on');
  PERFORM pg_temp.w3_assert(
    NOT has_table_privilege('authenticated', 'public.admin_internal_accounts', 'SELECT'),
    'C-01 signed-in users cannot read admin_internal_accounts');
END
$c01$;
ROLLBACK;

BEGIN;
DO $c02$
DECLARE
  v_admin      constant uuid := '41300000-0000-4000-a300-000000000001';
  v_outsider   constant uuid := '41300000-0000-4000-a300-000000000002';
  v_explorer   constant uuid := '41300000-0000-4000-a300-000000000010';
  v_host       constant uuid := '41300000-0000-4000-a300-000000000011';
  v_both       constant uuid := '41300000-0000-4000-a300-000000000012';
  v_incomplete constant uuid := '41300000-0000-4000-a300-000000000013';
  v_staff      constant uuid := '41300000-0000-4000-a300-000000000014';
  v_marked     constant uuid := '41300000-0000-4000-a300-000000000015';
  v_seed       constant uuid := '41300000-0000-4000-a300-000000000016';
  v_brand_ps   constant uuid := '41300000-0000-4000-a300-000000000100';
  v_brand_st   constant uuid := '41300000-0000-4000-a300-000000000101';
  v_brand_none constant uuid := '41300000-0000-4000-a300-000000000102';
  v_brand_staff constant uuid := '41300000-0000-4000-a300-000000000103';
  v_brand_gone constant uuid := '41300000-0000-4000-a300-000000000104';
  v_event_ok   constant uuid := '41300000-0000-4000-a300-000000000200';
  v_event_staff constant uuid := '41300000-0000-4000-a300-000000000201';
  v_before jsonb;
  v_after  jsonb;
  v jsonb;
  v_state text;
  v_audits bigint;
  v_row jsonb;
BEGIN
  -- Everyone signs in; only the admin is on the admin team.
  INSERT INTO auth.users(id, email) VALUES
    (v_admin,      'w3-admin@mingla-fixture.org'),
    (v_outsider,   'w3-outsider@mingla-fixture.org'),
    (v_explorer,   'w3-explorer@mingla-fixture.org'),
    (v_host,       'w3-host@mingla-fixture.org'),
    (v_both,       'w3-both@mingla-fixture.org'),
    (v_incomplete, 'w3-incomplete@mingla-fixture.org'),
    (v_staff,      'w3-staff@usemingla.com'),
    (v_marked,     'w3-marked@mingla-fixture.org'),
    (v_seed,       'w3-seed@mingla-fixture.org');
  INSERT INTO public.admin_users(email, role, status) VALUES ('w3-admin@mingla-fixture.org', 'admin', 'active');

  -- Counts before any fixture person exists (other suites may have left rows).
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_before := public.admin_people_segments();
  RESET ROLE;

  INSERT INTO public.profiles(id, email, display_name, has_completed_onboarding, is_seed, country) VALUES
    (v_explorer,   'w3-explorer@mingla-fixture.org',   'W3 Explorer',   true,  false, 'Nigeria'),
    (v_host,       'w3-host@mingla-fixture.org',       'W3 Host',       false, false, 'United States'),
    (v_both,       'w3-both@mingla-fixture.org',       'W3 Both',       true,  false, NULL),
    (v_incomplete, 'w3-incomplete@mingla-fixture.org', 'W3 Incomplete', false, false, NULL),
    (v_staff,      'w3-staff@usemingla.com',           'W3 Staff',      true,  false, NULL),
    (v_marked,     'w3-marked@mingla-fixture.org',     'W3 Marked',     true,  false, NULL),
    (v_seed,       'w3-seed@mingla-fixture.org',       'W3 Seed',       true,  true,  NULL);

  -- Host by business account; incomplete has only a deleted one; staff hosts a brand.
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_host, 'w3-host@mingla-fixture.org'),
    (v_staff, 'w3-staff@usemingla.com');
  INSERT INTO public.creator_accounts(id, email, deleted_at) VALUES
    (v_incomplete, 'w3-incomplete@mingla-fixture.org', now() - interval '1 day');

  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider) VALUES
    (v_brand_ps,    v_host,  'W3 Paystack Brand', 'w3-paystack-' || v_brand_ps,  'NGN', 'paystack'),
    (v_brand_st,    v_host,  'W3 Stripe Brand',   'w3-stripe-' || v_brand_st,    'USD', 'stripe'),
    (v_brand_none,  v_host,  'W3 No Bank Brand',  'w3-nobank-' || v_brand_none,  'NGN', 'paystack'),
    (v_brand_staff, v_staff, 'W3 Staff Brand',    'w3-staff-' || v_brand_staff,  'USD', 'stripe');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, deleted_at) VALUES
    (v_brand_gone, v_host, 'W3 Deleted Brand', 'w3-gone-' || v_brand_gone, 'USD', now());
  UPDATE public.brands SET stripe_connect_id = 'acct_w3fixture', stripe_charges_enabled = true,
         stripe_payouts_enabled = true WHERE id = v_brand_st;
  -- #4130 (integration): readiness is Wave 2a's rule, which reads the Stripe
  -- Connect account row (stripe_connect_accounts), as the Payments page does.
  INSERT INTO public.stripe_connect_accounts (brand_id, stripe_account_id, charges_enabled,
    payouts_enabled, country, default_currency)
  VALUES (v_brand_st, 'acct_w3fixture', true, true, 'US', 'usd');
  INSERT INTO public.brand_paystack_recipients(brand_id, recipient_code, bank_code, account_fingerprint,
                                               account_number_masked, account_name, is_active)
  VALUES (v_brand_ps, 'RCP_w3fixture', '058', 'hmac-sha256:' || repeat('a', 64), '••••1234', 'W3 Host', true);

  -- Host by an accepted team role (no business account of their own).
  INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at)
  VALUES (v_brand_ps, v_both, 'brand_admin', now() - interval '2 days', now() - interval '1 day');

  -- C-02 classification, as the admin.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM pg_temp.w3_assert(v_explorer = ANY (pg_temp.w3_ids('explorer')), 'C-02 finished Explorer onboarding is an explorer');
  PERFORM pg_temp.w3_assert(v_marked = ANY (pg_temp.w3_ids('explorer')), 'C-02 an unmarked explorer is an explorer');
  PERFORM pg_temp.w3_assert(v_host = ANY (pg_temp.w3_ids('host')), 'C-02 a live business account is a host');
  PERFORM pg_temp.w3_assert(v_both = ANY (pg_temp.w3_ids('both')), 'C-02 an accepted team role plus onboarding is both');
  PERFORM pg_temp.w3_assert(v_incomplete = ANY (pg_temp.w3_ids('incomplete')), 'C-02 a deleted business account alone is incomplete');
  PERFORM pg_temp.w3_assert(v_staff = ANY (pg_temp.w3_ids('internal')), 'C-02 a company email is internal');
  PERFORM pg_temp.w3_assert(NOT (v_staff = ANY (pg_temp.w3_ids('both'))), 'C-02 internal wins over both');
  PERFORM pg_temp.w3_assert(
    NOT (v_seed = ANY (pg_temp.w3_ids('explorer') || pg_temp.w3_ids('host') || pg_temp.w3_ids('both')
                       || pg_temp.w3_ids('incomplete') || pg_temp.w3_ids('internal'))),
    'C-02 a seed row is in no segment');

  -- Row content for the host: brands, readiness, owner role.
  SELECT r INTO v_row
    FROM jsonb_array_elements(public.admin_list_people('host', 'W3 Host', NULL, NULL, 10, 0, NULL) -> 'rows') r
   WHERE (r ->> 'id')::uuid = v_host;
  PERFORM pg_temp.w3_assert(jsonb_array_length(v_row -> 'brands') = 3, 'C-02 host row lists the three live brands, not the deleted one');
  PERFORM pg_temp.w3_assert(
    (SELECT bool_and(b ->> 'role' = 'brand_owner') FROM jsonb_array_elements(v_row -> 'brands') b),
    'C-02 host row shows the owner role');

  -- C-03 counts: exactly the fixtures moved, internal left out of people.
  v_after := public.admin_people_segments();
  RESET ROLE;
  PERFORM pg_temp.w3_assert((v_after ->> 'explorer')::int - (v_before ->> 'explorer')::int = 2, 'C-03 explorer +2');
  PERFORM pg_temp.w3_assert((v_after ->> 'host')::int - (v_before ->> 'host')::int = 1, 'C-03 host +1');
  PERFORM pg_temp.w3_assert((v_after ->> 'both')::int - (v_before ->> 'both')::int = 1, 'C-03 both +1');
  PERFORM pg_temp.w3_assert((v_after ->> 'incomplete')::int - (v_before ->> 'incomplete')::int = 1, 'C-03 incomplete +1');
  PERFORM pg_temp.w3_assert((v_after ->> 'internal')::int - (v_before ->> 'internal')::int = 1, 'C-03 internal +1');
  PERFORM pg_temp.w3_assert((v_after ->> 'people')::int - (v_before ->> 'people')::int = 5,
    'C-03 people counts the five non-internal fixtures, not staff or seed');
  PERFORM pg_temp.w3_assert(
    (v_after ->> 'people')::int = (v_after ->> 'explorer')::int + (v_after ->> 'host')::int
      + (v_after ->> 'both')::int + (v_after ->> 'incomplete')::int,
    'C-03 people is exactly explorer + host + both + incomplete');

  -- C-04 admin-only: a signed-in non-admin is refused everywhere.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  BEGIN PERFORM public.admin_people_segments(); v_state := 'ran';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
  PERFORM pg_temp.w3_assert(v_state = 'not_authorized', 'C-04 segments refused for a non-admin');
  BEGIN PERFORM public.admin_list_people('explorer'); v_state := 'ran';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
  PERFORM pg_temp.w3_assert(v_state = 'not_authorized', 'C-04 list refused for a non-admin');
  BEGIN PERFORM public.admin_get_person_activity(v_explorer); v_state := 'ran';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
  PERFORM pg_temp.w3_assert(v_state = 'not_authorized', 'C-04 person activity refused for a non-admin');
  BEGIN PERFORM public.admin_brands_summary(); v_state := 'ran';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
  PERFORM pg_temp.w3_assert(v_state = 'not_authorized', 'C-04 brands summary refused for a non-admin');
  BEGIN PERFORM public.admin_list_brands_board(); v_state := 'ran';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
  PERFORM pg_temp.w3_assert(v_state = 'not_authorized', 'C-04 brands board refused for a non-admin');
  BEGIN PERFORM public.admin_offerings_summary(); v_state := 'ran';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
  PERFORM pg_temp.w3_assert(v_state = 'not_authorized', 'C-04 offerings summary refused for a non-admin');
  BEGIN PERFORM public.admin_list_offerings_board(); v_state := 'ran';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
  PERFORM pg_temp.w3_assert(v_state = 'not_authorized', 'C-04 offerings board refused for a non-admin');

  -- C-05 mark / unmark: a non-admin changes nothing.
  BEGIN PERFORM public.admin_set_internal_account(v_marked, true, 'not allowed'); v_state := 'ran';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
  RESET ROLE;
  PERFORM pg_temp.w3_assert(v_state = 'not_authorized', 'C-05 a non-admin cannot mark internal');
  PERFORM pg_temp.w3_assert(NOT EXISTS (SELECT 1 FROM public.admin_internal_accounts WHERE user_id = v_marked),
    'C-05 the refused mark wrote nothing');
  PERFORM pg_temp.w3_assert(NOT EXISTS (SELECT 1 FROM public.admin_audit_log WHERE target_id = v_marked::text),
    'C-05 the refused mark wrote no audit row');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  BEGIN PERFORM public.admin_set_internal_account(v_marked, true, '   '); v_state := 'ran';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
  PERFORM pg_temp.w3_assert(v_state = 'reason_required', 'C-05 marking needs a reason');

  v := public.admin_set_internal_account(v_marked, true, 'Team phone used for demos');
  PERFORM pg_temp.w3_assert((v ->> 'is_internal')::boolean, 'C-05 marked internal');
  PERFORM pg_temp.w3_assert(v_marked = ANY (pg_temp.w3_ids('internal')), 'C-05 marked person moves to internal');
  PERFORM pg_temp.w3_assert(NOT (v_marked = ANY (pg_temp.w3_ids('explorer'))), 'C-05 and leaves explorers');
  v := public.admin_set_internal_account(v_marked, false, 'Real customer after all');
  PERFORM pg_temp.w3_assert(v_marked = ANY (pg_temp.w3_ids('explorer')), 'C-05 unmarked person returns to explorers');
  v := public.admin_set_internal_account(v_staff, false, 'Founder also uses the app as a guest');
  PERFORM pg_temp.w3_assert(v_staff = ANY (pg_temp.w3_ids('both')), 'C-05 unmarking overrides the email rule');
  RESET ROLE;

  SELECT count(*) INTO v_audits FROM public.admin_audit_log
   WHERE target_type = 'user' AND target_id IN (v_marked::text, v_staff::text)
     AND action IN ('person.mark_internal', 'person.unmark_internal')
     AND admin_email = 'w3-admin@mingla-fixture.org'
     AND metadata ? 'before' AND metadata ? 'after';
  PERFORM pg_temp.w3_assert(v_audits = 3, 'C-05 each of the three changes wrote an audit row with before and after');
  PERFORM pg_temp.w3_assert(
    (SELECT marked_by FROM public.admin_internal_accounts WHERE user_id = v_marked) = 'w3-admin@mingla-fixture.org',
    'C-05 the row records who marked it');

  -- Put staff back to internal for the board checks below.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM public.admin_set_internal_account(v_staff, true, 'Back to staff');

  -- C-06 brands.
  SELECT r INTO v_row FROM jsonb_array_elements(public.admin_list_brands_board('W3 Paystack', false) -> 'rows') r;
  PERFORM pg_temp.w3_assert(v_row ->> 'payment_readiness' = 'paystack_ready', 'C-06 Paystack recipient means ready');
  PERFORM pg_temp.w3_assert(v_row ->> 'owner_name' = 'W3 Host', 'C-06 owner shows a real name');
  SELECT r INTO v_row FROM jsonb_array_elements(public.admin_list_brands_board('W3 Stripe', false) -> 'rows') r;
  PERFORM pg_temp.w3_assert(v_row ->> 'payment_readiness' = 'stripe_ready', 'C-06 Stripe Connect with payouts means ready');
  SELECT r INTO v_row FROM jsonb_array_elements(public.admin_list_brands_board('W3 No Bank', false) -> 'rows') r;
  PERFORM pg_temp.w3_assert(v_row ->> 'payment_readiness' = 'paystack_no_setup', 'C-06 no setup is not ready (#4130 integration: Wave 2a code)');
  PERFORM pg_temp.w3_assert(
    (public.admin_list_brands_board('W3 Staff Brand', false) ->> 'total')::int = 0,
    'C-06 a staff brand is hidden by default');
  PERFORM pg_temp.w3_assert(
    (public.admin_list_brands_board('W3 Staff Brand', true) ->> 'total')::int = 1,
    'C-06 and shown when asked for');
  PERFORM pg_temp.w3_assert(
    (public.admin_list_brands_board('W3 Deleted Brand', false) ->> 'total')::int = 0,
    'C-06 a deleted brand is hidden by default');

  -- C-07 offerings: one draft on a real brand, one on the staff brand.
  PERFORM set_config('request.jwt.claim.sub', v_host::text, true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency, theme)
  VALUES (v_event_ok, v_brand_ps, v_host, 'W3 Real Draft', 'w3-real-' || v_event_ok, 'event', 'draft', 'draft', 'UTC', 'NGN', '{}'::jsonb);
  PERFORM set_config('request.jwt.claim.sub', v_staff::text, true);
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone, currency, theme)
  VALUES (v_event_staff, v_brand_staff, v_staff, 'W3 Staff Draft', 'w3-staff-' || v_event_staff, 'event', 'draft', 'draft', 'UTC', 'USD', '{}'::jsonb);
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);

  v := public.admin_list_offerings_board('drafts', 'W3 ', NULL, NULL, false);
  PERFORM pg_temp.w3_assert((v ->> 'total')::int = 1, 'C-07 the staff brand draft is hidden by default');
  PERFORM pg_temp.w3_assert((v -> 'rows' -> 0 ->> 'state') = 'draft', 'C-07 one state per row (draft)');
  v := public.admin_list_offerings_board('drafts', 'W3 ', NULL, NULL, true);
  PERFORM pg_temp.w3_assert((v ->> 'total')::int = 2, 'C-07 and shown when asked for');
  v := public.admin_list_offerings_board('on_sale', 'W3 ', NULL, NULL, true);
  PERFORM pg_temp.w3_assert((v ->> 'total')::int = 0, 'C-07 drafts are not on sale');
  BEGIN PERFORM public.admin_list_offerings_board('everything'); v_state := 'ran';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
  PERFORM pg_temp.w3_assert(v_state = 'invalid_view', 'C-07 an unknown view is refused');
  RESET ROLE;
END
$c02$;
ROLLBACK;
