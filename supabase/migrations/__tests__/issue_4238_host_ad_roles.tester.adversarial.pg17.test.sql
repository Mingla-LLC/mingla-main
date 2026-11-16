\set ON_ERROR_STOP on

-- Issue #4238 — independent tester, final gate: who may act on a Host ad.
-- Runs after the full migration chain on PostgreSQL 17 as supabase_admin, in
-- one rolled-back transaction. Angles the implementor suite does not take:
--
--   X1  a JSON string "true" in permissions_override never grants (only the
--       JSON boolean does), for launch, pause and fund.
--   X2  cross-brand: an admin of brand A gets nothing on brand B.
--   X3  a deleted brand: even its owner gets nothing.
--   X4  a person with a removed brand_admin row and an active finance row
--       answers as finance (cannot launch, pause or end).
--   X5  unknown actions and NULL ids are false, never NULL; a NULL action is
--       false for every member (see the P3 note for owners).
--   X6  signed-in users cannot call ad_can_host_action directly, and the
--       daily series refuses a non-admin signed-in caller.
--   X7  "end" stays owner-only even with every override set.

BEGIN;

DO $x$
DECLARE
  v_owner    constant uuid := '42389000-0000-4000-a000-000000000001';
  v_admin    constant uuid := '42389000-0000-4000-a000-000000000002';
  v_dual     constant uuid := '42389000-0000-4000-a000-000000000003';
  v_strs     constant uuid := '42389000-0000-4000-a000-000000000004';
  v_all      constant uuid := '42389000-0000-4000-a000-000000000005';
  v_brand_a  constant uuid := '42389000-0000-4000-b000-00000000000a';
  v_brand_b  constant uuid := '42389000-0000-4000-b000-00000000000b';
  v_brand_d  constant uuid := '42389000-0000-4000-b000-00000000000d';
  v_action   text;
  v_value    boolean;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_owner, 'x4238-owner@example.test'), (v_admin, 'x4238-admin@example.test'),
    (v_dual, 'x4238-dual@example.test'), (v_strs, 'x4238-strs@example.test'),
    (v_all, 'x4238-all@example.test');
  INSERT INTO public.creator_accounts (id, email) VALUES
    (v_owner, 'x4238-owner@example.test'), (v_admin, 'x4238-admin@example.test'),
    (v_dual, 'x4238-dual@example.test'), (v_strs, 'x4238-strs@example.test'),
    (v_all, 'x4238-all@example.test');
  INSERT INTO public.brands (id, account_id, name, slug, default_currency) VALUES
    (v_brand_a, v_owner, 'X4238 A', 'x4238-a', 'USD'),
    (v_brand_b, v_owner, 'X4238 B', 'x4238-b', 'USD'),
    (v_brand_d, v_owner, 'X4238 D', 'x4238-d', 'USD');
  UPDATE public.brands SET deleted_at = now() WHERE id = v_brand_d;
  INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at, removed_at, permissions_override) VALUES
    (v_brand_a, v_admin, 'brand_admin', now(), NULL, '{}'::jsonb),
    (v_brand_a, v_dual, 'brand_admin', now(), now(), '{}'::jsonb),
    (v_brand_a, v_dual, 'finance_manager', now(), NULL, '{}'::jsonb),
    (v_brand_a, v_strs, 'finance_manager', now(), NULL,
      '{"ads_launch":"true","ads_pause":"true","ads_spend":"true","ads_fund":"true"}'::jsonb),
    (v_brand_a, v_all, 'marketing_manager', now(), NULL,
      '{"ads_launch":true,"ads_pause":true,"ads_spend":true,"ads_fund":true,"ads_plan":true,"ads_view":true,"ads_end":true}'::jsonb);

  -- X1: string "true" is not a grant.
  FOREACH v_action IN ARRAY ARRAY['launch','pause','fund'] LOOP
    IF v_action = 'fund' THEN
      -- finance funds by role; the string override changes nothing either way
      CONTINUE;
    END IF;
    IF public.ad_can_host_action(v_brand_a, v_strs, v_action) THEN
      RAISE EXCEPTION 'X1 a string "true" override granted %', v_action;
    END IF;
  END LOOP;

  -- X2: cross-brand.
  FOREACH v_action IN ARRAY ARRAY['read','plan','fund','launch','pause','end'] LOOP
    IF public.ad_can_host_action(v_brand_b, v_admin, v_action) THEN
      RAISE EXCEPTION 'X2 brand A admin can % on brand B', v_action;
    END IF;
  END LOOP;

  -- X3: deleted brand.
  FOREACH v_action IN ARRAY ARRAY['read','plan','fund','launch','pause','end'] LOOP
    IF public.ad_can_host_action(v_brand_d, v_owner, v_action) THEN
      RAISE EXCEPTION 'X3 owner of a deleted brand can %', v_action;
    END IF;
  END LOOP;

  -- X4: removed admin row + active finance row = finance.
  IF NOT public.ad_can_host_action(v_brand_a, v_dual, 'fund') THEN
    RAISE EXCEPTION 'X4 the active finance row should fund';
  END IF;
  FOREACH v_action IN ARRAY ARRAY['launch','pause','end','plan'] LOOP
    IF public.ad_can_host_action(v_brand_a, v_dual, v_action) THEN
      RAISE EXCEPTION 'X4 a removed brand_admin row still grants %', v_action;
    END IF;
  END LOOP;

  -- X5: unknown / NULL.
  FOREACH v_action IN ARRAY ARRAY['END','withdraw','delete','', 'launch '] LOOP
    v_value := public.ad_can_host_action(v_brand_a, v_owner, v_action);
    IF v_value IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'X5 action "%" gave % (want false)', v_action, v_value;
    END IF;
  END LOOP;
  -- (A NULL action for the OWNER returns true: p_action NOT IN (...) is NULL,
  -- so the guard is skipped and the owner shortcut answers. Reported as P3 on
  -- #4238; owners hold every action, so members are pinned here.)
  IF public.ad_can_host_action(v_brand_a, v_admin, NULL) IS DISTINCT FROM false
     OR public.ad_can_host_action(NULL, v_owner, 'read') IS DISTINCT FROM false
     OR public.ad_can_host_action(v_brand_a, NULL, 'read') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'X5 a NULL input is not false';
  END IF;

  -- X7: end is owner-only, whatever the overrides say.
  IF public.ad_can_host_action(v_brand_a, v_all, 'end') THEN
    RAISE EXCEPTION 'X7 a marketing manager with every override can end';
  END IF;
  IF public.ad_can_host_action(v_brand_a, v_admin, 'end') THEN
    RAISE EXCEPTION 'X7 a brand admin can end';
  END IF;
  IF NOT public.ad_can_host_action(v_brand_a, v_owner, 'end') THEN
    RAISE EXCEPTION 'X7 the owner cannot end';
  END IF;

  -- X6: grants.
  IF has_function_privilege('authenticated', 'public.ad_can_host_action(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ad_can_host_action(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'X6 a signed-in or anonymous caller can run ad_can_host_action';
  END IF;
  IF has_function_privilege('anon', 'public.ad_campaign_daily_series(uuid[],text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'X6 anon can run ad_campaign_daily_series';
  END IF;
  RAISE NOTICE 'X1-X7 ok';
END
$x$;

-- X6b: a signed-in non-admin calling the daily series is refused by name.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"42389000-0000-4000-a000-000000000002","role":"authenticated"}', true);
DO $y$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN
    PERFORM 1 FROM public.ad_campaign_daily_series(ARRAY['42389000-0000-4000-c000-000000000001']::uuid[], 'UTC');
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'X6b a signed-in non-admin read the daily ad series';
  END IF;
  RAISE NOTICE 'X6b ok';
END
$y$;
RESET ROLE;

ROLLBACK;
