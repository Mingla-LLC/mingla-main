\set ON_ERROR_STOP on

-- Issue #4238 ads roles (20281118014238). Runs after the full migration chain
-- on PostgreSQL 17 as supabase_admin, in one rolled-back transaction.
--
--   F1  a brand admin can fund (and still launch and pause; end stays no).
--   F2  marketing without ads_spend cannot fund; with ads_spend it can.
--   W1  the owner can withdraw credit.
--   W2  an accepted finance_manager can withdraw credit.
--   W3  a brand admin cannot withdraw credit.
--   W4  marketing, a removed or unaccepted finance_manager, another brand,
--       a deleted brand and NULL inputs cannot withdraw (never NULL).
--   W5  only service_role may execute ad_can_withdraw_credit.
--
-- MINGLA-INVARIANT: I-4238-ADMIN-FUNDS | issue #4238 | A brand admin can fund Host ads (ad_can_host_action 'fund'), so an admin can hold a launch's budget and change a live ad's budget.
-- MINGLA-INVARIANT: I-4238-WITHDRAW-OWNER-FINANCE | issue #4238 | Withdrawing Host Ads credit is for the brand owner or an accepted, current finance_manager only (ad_can_withdraw_credit); ad-credit quote_withdraw and apply_withdraw use it.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.s_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4238 ads roles FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

DO $t$
DECLARE
  v_owner uuid := '42380000-7300-4000-8000-000000000001';
  v_admin uuid := '42380000-7300-4000-8000-000000000002';
  v_marketing uuid := '42380000-7300-4000-8000-000000000003';
  v_finance uuid := '42380000-7300-4000-8000-000000000004';
  v_fin_removed uuid := '42380000-7300-4000-8000-000000000005';
  v_fin_invited uuid := '42380000-7300-4000-8000-000000000006';
  v_mkt_spend uuid := '42380000-7300-4000-8000-000000000007';
  v_brand uuid := '42380000-7300-4000-8000-0000000000b1';
  v_other uuid := '42380000-7300-4000-8000-0000000000b2';
  v_deleted uuid := '42380000-7300-4000-8000-0000000000b3';
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_owner, 'roles-owner@example.test'), (v_admin, 'roles-admin@example.test'),
    (v_marketing, 'roles-marketing@example.test'), (v_finance, 'roles-finance@example.test'),
    (v_fin_removed, 'roles-fin-removed@example.test'), (v_fin_invited, 'roles-fin-invited@example.test'),
    (v_mkt_spend, 'roles-mkt-spend@example.test');
  INSERT INTO public.creator_accounts (id, email) VALUES
    (v_owner, 'roles-owner@example.test'), (v_admin, 'roles-admin@example.test'),
    (v_marketing, 'roles-marketing@example.test'), (v_finance, 'roles-finance@example.test'),
    (v_fin_removed, 'roles-fin-removed@example.test'), (v_fin_invited, 'roles-fin-invited@example.test'),
    (v_mkt_spend, 'roles-mkt-spend@example.test');
  INSERT INTO public.brands (id, account_id, name, slug, default_currency) VALUES
    (v_brand, v_owner, 'Roles brand', 'roles-brand', 'USD'),
    (v_other, v_admin, 'Roles other', 'roles-other', 'USD'),
    (v_deleted, v_owner, 'Roles deleted', 'roles-deleted', 'USD');
  UPDATE public.brands SET deleted_at = now() WHERE id = v_deleted;
  INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at, removed_at, permissions_override)
  VALUES
    (v_brand, v_admin, 'brand_admin', now(), NULL, '{}'::jsonb),
    (v_brand, v_marketing, 'marketing_manager', now(), NULL, '{}'::jsonb),
    (v_brand, v_finance, 'finance_manager', now(), NULL, '{}'::jsonb),
    (v_brand, v_fin_removed, 'finance_manager', now(), now(), '{}'::jsonb),
    (v_brand, v_fin_invited, 'finance_manager', NULL, NULL, '{}'::jsonb),
    (v_brand, v_mkt_spend, 'marketing_manager', now(), NULL, '{"ads_spend":true}'::jsonb),
    (v_deleted, v_finance, 'finance_manager', now(), NULL, '{}'::jsonb);

  -- F1
  PERFORM pg_temp.s_assert(
    public.ad_can_host_action(v_brand, v_admin, 'fund')
    AND public.ad_can_host_action(v_brand, v_admin, 'launch')
    AND public.ad_can_host_action(v_brand, v_admin, 'pause')
    AND NOT public.ad_can_host_action(v_brand, v_admin, 'end'),
    'F1 brand admin funds, launches and pauses; end stays no');
  -- F2
  PERFORM pg_temp.s_assert(
    NOT public.ad_can_host_action(v_brand, v_marketing, 'fund')
    AND public.ad_can_host_action(v_brand, v_mkt_spend, 'fund')
    AND public.ad_can_host_action(v_brand, v_finance, 'fund'),
    'F2 marketing funds only with ads_spend; finance funds');

  -- W1 / W2 / W3
  PERFORM pg_temp.s_assert(public.ad_can_withdraw_credit(v_brand, v_owner),
    'W1 owner withdraws');
  PERFORM pg_temp.s_assert(public.ad_can_withdraw_credit(v_brand, v_finance),
    'W2 accepted finance_manager withdraws');
  PERFORM pg_temp.s_assert(public.ad_can_withdraw_credit(v_brand, v_admin) IS FALSE,
    'W3 brand admin cannot withdraw');
  -- W4
  PERFORM pg_temp.s_assert(
    public.ad_can_withdraw_credit(v_brand, v_marketing) IS FALSE
    AND public.ad_can_withdraw_credit(v_brand, v_mkt_spend) IS FALSE
    AND public.ad_can_withdraw_credit(v_brand, v_fin_removed) IS FALSE
    AND public.ad_can_withdraw_credit(v_brand, v_fin_invited) IS FALSE
    AND public.ad_can_withdraw_credit(v_other, v_finance) IS FALSE
    AND public.ad_can_withdraw_credit(v_other, v_owner) IS FALSE
    AND public.ad_can_withdraw_credit(v_deleted, v_owner) IS FALSE
    AND public.ad_can_withdraw_credit(v_deleted, v_finance) IS FALSE
    AND public.ad_can_withdraw_credit(NULL, v_owner) IS FALSE
    AND public.ad_can_withdraw_credit(v_brand, NULL) IS FALSE,
    'W4 everyone else, other or deleted brands and NULLs are false');
  -- W5
  PERFORM pg_temp.s_assert(
    NOT has_function_privilege('anon', 'public.ad_can_withdraw_credit(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.ad_can_withdraw_credit(uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.ad_can_withdraw_credit(uuid,uuid)', 'EXECUTE'),
    'W5 only service_role executes ad_can_withdraw_credit');
END
$t$;

ROLLBACK;
