\set ON_ERROR_STOP on
-- Issue #3660 — INDEPENDENT TESTER (tester2), rework 4. KNOWN GAPS, NOT
-- REGISTERED IN CI.
--
-- This file FAILS on the branch on purpose and no lane runs it. It records
-- two states in which private.host_account_earlier_provider_targets still
-- hands out a provider id that is in live use by ANOTHER owner. The tester
-- found no shipped flow that produces either state (Stripe accounts and
-- Paystack subaccounts are created per brand), so these are hardening gaps,
-- not reachable defects. Register the file in the migrations job if the
-- checks below are added; delete it if they are judged unnecessary.
--
--   GAP-1  The same Stripe account id is live on a different brand of a
--          different owner, while this Host's deleted brand still carries it
--          with the detach stamp. The function checks this brand's row only;
--          nothing in the schema stops two rows carrying one account id
--          (stripe_account_id has a plain index, not a unique one).
--   GAP-2  The Paystack subaccount code recorded for this Host's deleted
--          brand is now the live code of another owner's brand. The function
--          can only test this brand's state (the deletion cleared the code
--          from it); it does not look for the code on any other brand.
BEGIN;
CREATE TEMP TABLE t2g(failure text);

DO $$
DECLARE
  v_h uuid := gen_random_uuid();
  v_n uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_z uuid := gen_random_uuid();
  v_sfx text := replace(gen_random_uuid()::text, '-', '');
  v_acct text;
  v_code text;
  v_r jsonb;
BEGIN
  v_acct := 'acct_t2g_' || left(v_sfx, 10);
  v_code := 'ACCT_t2g_' || left(v_sfx, 10);
  INSERT INTO auth.users(id) VALUES (v_h), (v_n);
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_h, 't2g-h-' || v_sfx || '@example.test'), (v_n, 't2g-n-' || v_sfx || '@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, default_currency) VALUES
    (v_b, v_h, 'T2G B', 't2g-b-' || v_sfx, 'USD'),
    (v_z, v_n, 'T2G Z', 't2g-z-' || v_sfx, 'USD');
  UPDATE public.brands SET paystack_subaccount_code = v_code WHERE id = v_b;
  INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, country, default_currency)
  VALUES (v_b, v_acct, 'US', 'USD');

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  IF public.biz_delete_host_account(v_h)->>'status' IS DISTINCT FROM 'deleted' THEN
    RAISE EXCEPTION 't2g fixture: deletion did not complete';
  END IF;

  -- The same two provider ids are now live on another owner's brand.
  INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, country, default_currency)
  VALUES (v_z, v_acct, 'US', 'USD');
  SET LOCAL session_replication_role = replica;
  UPDATE public.brands SET paystack_subaccount_code = v_code WHERE id = v_z;
  SET LOCAL session_replication_role = origin;

  v_r := public.biz_delete_host_account(v_h);   -- a retry
  IF v_r->'stripe_accounts' @> jsonb_build_array(jsonb_build_object('stripe_account_id', v_acct)) THEN
    INSERT INTO t2g VALUES ('GAP-1 a retry returned a Stripe account id that is live on another owner''s brand');
  END IF;
  IF v_r->'paystack_subaccounts' @> jsonb_build_array(jsonb_build_object('subaccount_code', v_code)) THEN
    INSERT INTO t2g VALUES ('GAP-2 a retry returned a Paystack subaccount code that is live on another owner''s brand');
  END IF;
END;
$$;

DO $$
DECLARE
  v_failures text;
BEGIN
  SELECT string_agg(failure, ' || ') INTO v_failures FROM t2g;
  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'issue_3660 tester2 retest4 known gaps: %', v_failures;
  END IF;
  RAISE NOTICE 'issue_3660 host account deletion tester2 retest4 known gaps: none reproduce';
END;
$$;
ROLLBACK;
