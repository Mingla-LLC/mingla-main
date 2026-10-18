-- MINGLA-INVARIANT: I-3697-ARI-ADS-ACTION-AUTHORITY | issue #3697 | Ari authorizes Host Ads with the canonical independent read/plan/fund/launch/pause/end matrix and can never accept a client-supplied actor id.

\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_owner constant uuid := '36972000-0000-4000-8000-000000000001';
  v_marketing constant uuid := '36972000-0000-4000-8000-000000000002';
  v_finance constant uuid := '36972000-0000-4000-8000-000000000003';
  v_brand constant uuid := '36972000-0000-4000-8000-000000000011';
BEGIN
  INSERT INTO auth.users (id, email)
  VALUES
    (v_owner, 'issue-3697-ari-owner@example.test'),
    (v_marketing, 'issue-3697-ari-marketing@example.test'),
    (v_finance, 'issue-3697-ari-finance@example.test');

  INSERT INTO public.creator_accounts (id, email)
  VALUES
    (v_owner, 'issue-3697-ari-owner@example.test'),
    (v_marketing, 'issue-3697-ari-marketing@example.test'),
    (v_finance, 'issue-3697-ari-finance@example.test');

  INSERT INTO public.brands (
    id, account_id, name, slug, default_currency,
    payment_provider, payment_country, paystack_subaccount_code
  ) VALUES (
    v_brand, v_owner, 'Ari Ads Auth', 'issue-3697-ari-ads-auth',
    'NGN', 'paystack', 'NG', 'TEST'
  );

  INSERT INTO public.brand_team_members (
    brand_id, user_id, role, accepted_at, permissions_override
  ) VALUES
    (v_brand, v_marketing, 'marketing_manager', now(),
      '{"ads_spend":true}'::jsonb),
    (v_brand, v_finance, 'finance_manager', now(), '{}'::jsonb);

  PERFORM set_config('request.jwt.claim.sub', v_marketing::text, true);
  IF NOT public.ad_can_host_action_for_caller(v_brand, 'plan')
     OR NOT public.ad_can_host_action_for_caller(v_brand, 'fund')
     OR NOT public.ad_can_host_action_for_caller(v_brand, 'launch')
     OR NOT public.ad_can_host_action_for_caller(v_brand, 'pause')
     OR public.ad_can_host_action_for_caller(v_brand, 'end') THEN
    RAISE EXCEPTION 'marketing ads_spend action matrix drift';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_finance::text, true);
  IF NOT public.ad_can_host_action_for_caller(v_brand, 'fund')
     OR public.ad_can_host_action_for_caller(v_brand, 'plan')
     OR public.ad_can_host_action_for_caller(v_brand, 'launch')
     OR public.ad_can_host_action_for_caller(v_brand, 'pause')
     OR public.ad_can_host_action_for_caller(v_brand, 'end') THEN
    RAISE EXCEPTION 'finance action matrix drift';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  IF NOT public.ad_can_host_action_for_caller(v_brand, 'read')
     OR NOT public.ad_can_host_action_for_caller(v_brand, 'plan')
     OR NOT public.ad_can_host_action_for_caller(v_brand, 'fund')
     OR NOT public.ad_can_host_action_for_caller(v_brand, 'launch')
     OR NOT public.ad_can_host_action_for_caller(v_brand, 'pause')
     OR NOT public.ad_can_host_action_for_caller(v_brand, 'end') THEN
    RAISE EXCEPTION 'owner action matrix drift';
  END IF;
END;
$test$;

ROLLBACK;
