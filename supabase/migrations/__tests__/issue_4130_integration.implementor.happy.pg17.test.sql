\set ON_ERROR_STOP on

-- Issue #4130 (integration) — Brands and Payments agree on payment readiness.
-- Run after the full migration chain on PostgreSQL 17.
--
--   I-01  admin_brand_payment_readiness() is an internal helper: neither anon
--         nor signed-in users can call it; Wave 3's helper delegates to it.
--   I-02  A Paystack-only brand (Paystack chosen, active bank recipient, no
--         Stripe at all) is "paystack_ready" on the Brands board, and the
--         Payments facts for the same brand are exactly the facts Wave 2a's
--         rule reads as ready on Paystack. The admin node:test
--         issue_4130_integration feeds those facts to paymentReadiness.js and
--         gets the same code.
--   I-03  Wave 2a's rule, not Wave 3's old one: a Paystack brand with a
--         leftover Stripe account (cards and payouts on) but no Paystack bank is
--         NOT ready (the old rule said "stripe_ready"); a Paystack subaccount
--         without a bank needs host action; a Stripe brand with payouts off or
--         overdue details needs host action.
--   I-04  The board filters and the summary count use the same verdict.

CREATE OR REPLACE FUNCTION pg_temp.int_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4130 integration FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

BEGIN;
DO $i01$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_brand_payment_readiness(uuid)',
    'public.admin_brand_payment_readiness_w3(uuid)'
  ] LOOP
    PERFORM pg_temp.int_assert(to_regprocedure(v_fn) IS NOT NULL, 'I-01 exists ' || v_fn);
    PERFORM pg_temp.int_assert(NOT has_function_privilege('anon', v_fn, 'EXECUTE'), 'I-01 anon cannot run ' || v_fn);
    PERFORM pg_temp.int_assert(NOT has_function_privilege('authenticated', v_fn, 'EXECUTE'),
      'I-01 signed-in users cannot run ' || v_fn);
  END LOOP;
  PERFORM pg_temp.int_assert(
    (SELECT p.prosrc ~ 'admin_brand_payment_readiness\(p_brand_id\)'
       FROM pg_proc p WHERE p.oid = 'public.admin_brand_payment_readiness_w3(uuid)'::regprocedure),
    'I-01 the Wave 3 helper delegates to the shared verdict');
END
$i01$;
ROLLBACK;

BEGIN;
DO $i02$
DECLARE
  v_admin     constant uuid := '41300000-0000-4000-a900-000000000001';
  v_owner     constant uuid := '41300000-0000-4000-a900-000000000002';
  v_ps_only   constant uuid := '41300000-0000-4000-a900-000000000100';
  v_ps_stale  constant uuid := '41300000-0000-4000-a900-000000000101';
  v_ps_sub    constant uuid := '41300000-0000-4000-a900-000000000102';
  v_st_nopay  constant uuid := '41300000-0000-4000-a900-000000000103';
  v_st_due    constant uuid := '41300000-0000-4000-a900-000000000104';
  v_st_ok     constant uuid := '41300000-0000-4000-a900-000000000105';
  v_board  jsonb;
  v_facts  jsonb;
  v_row    jsonb;
  v_before jsonb;
  v_after  jsonb;
  v_codes  jsonb;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_admin, 'int4130-admin@mingla-fixture.org'),
    (v_owner, 'int4130-owner@mingla-fixture.org');
  INSERT INTO public.profiles(id, email, display_name, has_completed_onboarding, is_seed) VALUES
    (v_owner, 'int4130-owner@mingla-fixture.org', 'Int Owner', true, false);
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'int4130-owner@mingla-fixture.org');
  INSERT INTO public.admin_users(email, role, status) VALUES ('int4130-admin@mingla-fixture.org', 'admin', 'active')
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_before := public.admin_brands_summary();
  RESET ROLE;

  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider, paystack_subaccount_code) VALUES
    (v_ps_only,  v_owner, 'Int4130 Paystack Only',   'int4130-ps-only',  'NGN', 'paystack', NULL),
    (v_ps_stale, v_owner, 'Int4130 Paystack Stale',  'int4130-ps-stale', 'NGN', 'paystack', NULL),
    (v_ps_sub,   v_owner, 'Int4130 Paystack Sub',    'int4130-ps-sub',   'NGN', 'paystack', 'ACCT_int4130'),
    (v_st_nopay, v_owner, 'Int4130 Stripe NoPayout', 'int4130-st-nopay', 'USD', 'stripe',   NULL),
    (v_st_due,   v_owner, 'Int4130 Stripe Overdue',  'int4130-st-due',   'USD', 'stripe',   NULL),
    (v_st_ok,    v_owner, 'Int4130 Stripe Ready',    'int4130-st-ok',    'USD', 'stripe',   NULL);
  INSERT INTO public.brand_paystack_recipients(brand_id, recipient_code, bank_code, account_fingerprint,
                                               account_number_masked, account_name, is_active)
  VALUES (v_ps_only, 'RCP_int4130', '058', 'hmac-sha256:' || repeat('e', 64), '••••4130', 'Int Owner', true);
  INSERT INTO public.stripe_connect_accounts (brand_id, stripe_account_id, charges_enabled, payouts_enabled,
                                              country, default_currency, requirements) VALUES
    (v_ps_stale, 'acct_int4130stale', true, true,  'US', 'usd', '{}'::jsonb),
    (v_st_nopay, 'acct_int4130nopay', true, false, 'US', 'usd', '{}'::jsonb),
    (v_st_due,   'acct_int4130due',   true, true,  'US', 'usd', '{"past_due": ["individual.id_number"]}'::jsonb),
    (v_st_ok,    'acct_int4130ok',    true, true,  'US', 'usd', '{}'::jsonb);

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  v_board := public.admin_list_brands_board('Int4130', false, NULL, 'name_asc', 100, 0);
  v_facts := public.admin_list_brand_payment_readiness('int4130-ps-only');
  v_after := public.admin_brands_summary();
  SELECT jsonb_object_agg(r ->> 'slug', r ->> 'payment_readiness') INTO v_codes
    FROM jsonb_array_elements(v_board -> 'rows') r;

  -- I-02 the Paystack-only brand.
  PERFORM pg_temp.int_assert(v_codes ->> 'int4130-ps-only' = 'paystack_ready', 'I-02 Brands: a Paystack-only brand is paystack_ready');
  PERFORM pg_temp.int_assert((v_facts ->> 'total')::int = 1, 'I-02 Payments lists the same brand');
  v_row := v_facts -> 'rows' -> 0;
  PERFORM pg_temp.int_assert(
    v_row ->> 'payment_provider' = 'paystack'
      AND (v_row ->> 'paystack_recipient_active')::boolean
      AND NOT (v_row ->> 'has_stripe_account')::boolean
      AND v_row ->> 'stripe_connect_id' IS NULL
      AND v_row ->> 'paystack_subaccount_code' IS NULL,
    'I-02 Payments facts: Paystack chosen, bank recipient active, no Stripe (paymentReadiness.js reads these as ready on Paystack)');

  -- I-03 Wave 2a's rule.
  PERFORM pg_temp.int_assert(v_codes ->> 'int4130-ps-stale' = 'paystack_no_setup',
    'I-03 a Paystack brand is judged on Paystack, not on a leftover Stripe account');
  PERFORM pg_temp.int_assert(v_codes ->> 'int4130-ps-sub' = 'paystack_needs_action', 'I-03 a Paystack subaccount without a bank needs host action');
  PERFORM pg_temp.int_assert(v_codes ->> 'int4130-st-nopay' = 'stripe_needs_action', 'I-03 Stripe with payouts off needs host action');
  PERFORM pg_temp.int_assert(v_codes ->> 'int4130-st-due' = 'stripe_needs_action', 'I-03 Stripe with overdue details needs host action');
  PERFORM pg_temp.int_assert(v_codes ->> 'int4130-st-ok' = 'stripe_ready', 'I-03 Stripe with cards and payouts on is ready');

  -- I-04 the filters and the count.
  PERFORM pg_temp.int_assert(
    (public.admin_list_brands_board('Int4130', false, 'ready', 'name_asc', 100, 0) ->> 'total')::int = 2,
    'I-04 "Ready" filter: the two ready brands');
  PERFORM pg_temp.int_assert(
    (public.admin_list_brands_board('Int4130', false, 'needs_action', 'name_asc', 100, 0) ->> 'total')::int = 3,
    'I-04 "Needs host action" filter: three brands');
  PERFORM pg_temp.int_assert(
    (public.admin_list_brands_board('Int4130', false, 'no_setup', 'name_asc', 100, 0) ->> 'total')::int = 1,
    'I-04 "No payment setup" filter: one brand');
  PERFORM pg_temp.int_assert(
    (public.admin_list_brands_board('Int4130', false, 'needs_bank', 'name_asc', 100, 0) ->> 'total')::int = 4,
    'I-04 an old "needs_bank" link still lists every brand that is not ready');
  PERFORM pg_temp.int_assert(
    (v_after ->> 'ready_to_get_paid')::int - (v_before ->> 'ready_to_get_paid')::int = 2,
    'I-04 the summary counts exactly the two ready brands');
  RESET ROLE;
END
$i02$;
ROLLBACK;
